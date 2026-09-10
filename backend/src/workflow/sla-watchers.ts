import type { Employee } from '../generated/prisma/client.js';
import type { EmployeeStatus } from '../generated/prisma/enums.js';
import type { Workflow } from './engine.js';
import type { SlaWatcher, WatchedRecord } from './sla-scheduler.js';
import type { EmployeeRepository } from '../modules/employees/employee.repository.js';
import type { ContractRepository } from '../modules/employees/contract.repository.js';
import type { OffboardingRepository } from '../modules/offboarding/offboarding.repository.js';
import type { GosiRepository } from '../modules/processes/gosi.repository.js';
import type { MedicalInsuranceRepository } from '../modules/processes/medical-insurance.repository.js';
import type { EmployeeDocumentRepository } from '../modules/employees/employee-document.repository.js';
import { localeOf } from '../notifications/locale.js';
import { contractParams } from '../notifications/contract-params.js';

/**
 * Emails the new hire themselves receives. The contract is approved on an
 * external platform, so that message is informational: it carries the terms
 * HR recorded and a link to the contract page.
 */
const ONBOARDING_SUBJECT_TEMPLATES: Record<string, string> = {
  AWAITING_FORM: 'employee.form_reminder',
};

/** Which signed link (if any) the subject's email for a status needs. */
const LINK_FOR_STATUS: Record<string, 'DATA_FORM' | 'CONTRACT_APPROVAL'> = {
  AWAITING_FORM: 'DATA_FORM',
  FORM_RECEIVED: 'DATA_FORM',
  CONTRACT_CREATION: 'CONTRACT_APPROVAL',
  AWAITING_CONTRACT_APPROVAL: 'CONTRACT_APPROVAL',
};

/** The onboarding pipeline — subject emails and EXPIRE support. */
export function onboardingWatcher(
  employees: EmployeeRepository,
  workflow: Workflow<Employee>,
  contracts?: ContractRepository,
  /** Issues the link the reminder carries; without it the mail is text only. */
  links?: {
    issue(
      purpose: 'DATA_FORM' | 'CONTRACT_APPROVAL',
      anchors: { employeeId: string },
    ): Promise<{ url: string }>;
  },
): SlaWatcher {
  return {
    processKey: 'EMPLOYEE',
    async listInStatusSince(status, threshold, limit): Promise<WatchedRecord[]> {
      const rows = await employees.listInStatusSince(status as EmployeeStatus, threshold, limit);
      return rows.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        email: e.email,
        locale: localeOf(e),
        anchorAt: e.statusChangedAt,
        employeeId: e.id,
      }));
    },
    subjectTemplate: (status) => ONBOARDING_SUBJECT_TEMPLATES[status],
    /**
     * The terms HR recorded, plus a working link. Each reminder issues a new
     * token (only its hash is stored, so an existing link cannot be rebuilt),
     * which means the newest email is the one that opens.
     */
    async subjectParams(record, status) {
      const extra: Record<string, string | number> = {};
      const employeeId = record.employeeId ?? record.id;

      if (contracts) {
        const contract = await contracts.findByEmployee(employeeId);
        for (const [key, value] of Object.entries(contractParams(contract))) {
          if (value !== undefined) extra[key] = value as string | number;
        }
      }

      const purpose = LINK_FOR_STATUS[status];
      if (links && purpose) {
        const { url } = await links.issue(purpose, { employeeId });
        extra['linkUrl'] = url;
        extra[purpose === 'DATA_FORM' ? 'formLink' : 'contractLink'] = url;
      }
      return extra;
    },
    async expire(record, ruleId) {
      const employee = await employees.findById(record.id);
      if (!employee) return;
      await workflow.transition(employee, 'EXPIRE', { type: 'SYSTEM' }, { rule: ruleId });
      // The contract card mirrors the outcome: "expired without approval".
      if (employee.status === 'AWAITING_CONTRACT_APPROVAL' && contracts) {
        await contracts.setStatusByEmployee(employee.id, 'EXPIRED');
      }
    },
  };
}

/** Stage 3 — offboardings stalled mid-flow (staff reminders only). */
export function offboardingWatcher(offboardings: OffboardingRepository): SlaWatcher {
  return {
    processKey: 'OFFBOARDING',
    async listInStatusSince(status, threshold, limit): Promise<WatchedRecord[]> {
      const rows = await offboardings.listInStatusSince(status, threshold, limit);
      return rows.map((o) => ({
        id: o.id,
        name: o.employee ? `${o.employee.firstName} ${o.employee.lastName}` : o.id,
        anchorAt: o.updatedAt,
        employeeId: o.employeeId,
      }));
    },
  };
}

/**
 * Document expiry — DEADLINE semantics: rules fire `afterValue` days
 * BEFORE expiryDate (and keep the record due after it passes, until the
 * document is renewed). rule.status filters by document type ('ANY' = all).
 */
export function documentExpiryWatcher(documents: EmployeeDocumentRepository): SlaWatcher {
  return {
    processKey: 'DOCUMENT_EXPIRY',
    // Unused for deadline watchers, but part of the contract.
    listInStatusSince: () => Promise.resolve([]),
    async listDue(rule, now, limit): Promise<WatchedRecord[]> {
      const rows = await documents.listExpiring(rule.afterValue, rule.status, now, limit);
      return rows.map((doc) => {
        const daysLeft = Math.ceil((doc.expiryDate.getTime() - now.getTime()) / 86_400_000);
        return {
          id: doc.id,
          name: `${doc.employee.firstName} ${doc.employee.lastName} (${doc.employee.employeeNo})`,
          anchorAt: doc.expiryDate,
          employeeId: doc.employeeId,
          meta: {
            docType: doc.type,
            daysLeft,
            expiryDate: doc.expiryDate.toISOString().slice(0, 10),
            ...(doc.number ? { docNumber: doc.number } : {}),
          },
        };
      });
    },
    templates: {
      stalled: 'staff.document_expiring',
      escalation: 'staff.document_expiry_escalation',
    },
  };
}

/** Stage 2 — GOSI / medical cards stuck ON_HOLD (or PENDING) too long. */
export function processWatcher(
  processKey: 'GOSI' | 'MEDICAL_INSURANCE',
  repo: GosiRepository | MedicalInsuranceRepository,
): SlaWatcher {
  return {
    processKey,
    async listInStatusSince(status, threshold, limit): Promise<WatchedRecord[]> {
      const rows = await repo.listInStatusSince(status, threshold, limit);
      return rows.map((p) => ({
        id: p.id,
        name: p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : p.id,
        anchorAt: p.updatedAt,
        employeeId: p.employeeId,
      }));
    },
  };
}
