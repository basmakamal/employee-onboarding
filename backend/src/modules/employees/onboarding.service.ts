import type { Employee, Prisma } from '../../generated/prisma/client.js';
import type { Actor, Workflow } from '../../workflow/engine.js';
import type { UnitOfWork } from '../../common/prisma.js';
import { compact } from '../../common/http.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { EmployeeRepository, CreateOnboardingData } from './employee.repository.js';
import type { OnboardingDocumentRepository } from './onboarding-document.repository.js';
import type { ContractRepository } from './contract.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';
import type { NotificationService } from '../../notifications/notification.service.js';
import { REQUIRED_DOCUMENT_TYPES, type DataFormInput } from './data-form.schema.js';

/** What a signed link may see of the record — no ids, no internals. */
function publicEmployee(e: Employee) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    nationalId: e.nationalId,
    birthDate: e.birthDate,
    department: e.department,
    // Shown read-only on the data form: HR sets it when creating the record,
    // so asking the employee to retype it would only invite a mismatch.
    project: e.project,
    jobTitle: e.jobTitle,
    status: e.status,
  };
}

/**
 * Everything a single onboarding unit of work may touch. All members are
 * bound to ONE transaction — a crash mid-way rolls the whole step back
 * (transition + audit + stamps + link consumption together).
 */
export interface OnboardingTxScope {
  employees: EmployeeRepository;
  documents: OnboardingDocumentRepository;
  contracts: ContractRepository;
  audit: AuditLogRepository;
  workflow: Workflow<Employee>;
  /** Single-use stamp for the link consumed by this unit of work. */
  markLinkUsed: (tokenId: string, at: Date) => Promise<unknown>;
}

/**
 * The onboarding pipeline (BRD stage 1) on the unified employee record:
 * intake → data form → document review → contract → e-approval, which
 * activates the employee (number allocated, Stage-2 tracks opened).
 *
 * Transaction boundaries: state changes run inside `transact`; emails and
 * link issuance stay OUTSIDE — an SMTP hiccup must never roll back (or hold
 * open) a database transaction.
 */
export class OnboardingService {
  constructor(
    private readonly repos: {
      employees: EmployeeRepository;
      documents: OnboardingDocumentRepository;
      contracts: ContractRepository;
      audit: AuditLogRepository;
    },
    private readonly workflow: Workflow<Employee>,
    private readonly links: LinkTokenService,
    private readonly notifications: NotificationService,
    private readonly transact: UnitOfWork<OnboardingTxScope>,
  ) {}

  async create(input: CreateOnboardingData, actor: Actor) {
    return this.transact(async (s) => {
      const employee = await s.employees.createOnboarding(input);
      await s.audit.append({
        entity: 'EMPLOYEE',
        entityId: employee.id,
        action: 'CREATE',
        toStatus: employee.status,
        actorType: actor.type,
        ...(actor.id ? { actorId: actor.id } : {}),
        employeeId: employee.id,
      });
      return employee;
    });
  }

  async sendForm(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    await this.transact((s) => s.workflow.transition(employee, 'SEND_FORM', actor));
    return this.sendDataFormLink(employee, actor);
  }

  async requestMissing(id: string, actor: Actor, notes?: string) {
    const employee = await this.mustFind(id);
    await this.transact((s) =>
      s.workflow.transition(employee, 'REQUEST_MISSING', actor, notes ? { notes } : undefined),
    );
    return this.sendDataFormLink(employee, actor);
  }

  async acceptDocuments(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    return this.transact((s) => s.workflow.transition(employee, 'ACCEPT_DOCUMENTS', actor));
  }

  /** Contract details may only change while the record sits in CONTRACT_CREATION. */
  async upsertContract(id: string, details: Prisma.InputJsonValue, actor: Actor) {
    const employee = await this.mustFind(id);
    if (employee.status !== 'CONTRACT_CREATION') {
      throw new GuardFailedError(
        'WRONG_STATUS',
        'the contract can only be edited during contract creation',
      );
    }
    const existing = await this.repos.contracts.findByEmployee(id);
    if (existing) return this.repos.contracts.updateDetails(existing.id, details);
    return this.repos.contracts.create({ employeeId: id, createdById: actor.id ?? '', details });
  }

  async sendContract(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    await this.transact(async (s) => {
      await s.workflow.transition(employee, 'SEND_CONTRACT', actor);
      const contract = await s.contracts.findByEmployee(id);
      if (contract) await s.contracts.markSent(contract.id, new Date());
    });

    const link = await this.links.issue('CONTRACT_APPROVAL', { employeeId: id });
    await this.notifications.notifyExternal(
      employee.email,
      'employee.contract_approval_reminder',
      { name: `${employee.firstName} ${employee.lastName}`, linkUrl: link.url },
      { entity: 'EMPLOYEE', entityId: id },
    );
    await this.auditLinkSent(id, 'CONTRACT_APPROVAL', actor);
    return { url: link.url, expiresAt: link.expiresAt };
  }

  /** BRD: reopen resumes from the last completed stage. */
  async reopen(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    const result = await this.transact((s) => s.workflow.transition(employee, 'REOPEN', actor));

    if (result.to === 'AWAITING_FORM') {
      await this.sendDataFormLink(employee, actor);
    } else if (result.to === 'AWAITING_CONTRACT_APPROVAL') {
      const link = await this.links.issue('CONTRACT_APPROVAL', { employeeId: id });
      await this.notifications.notifyExternal(
        employee.email,
        'employee.contract_approval_reminder',
        { name: `${employee.firstName} ${employee.lastName}`, linkUrl: link.url },
        { entity: 'EMPLOYEE', entityId: id },
      );
      await this.auditLinkSent(id, 'CONTRACT_APPROVAL', actor);
    }
    return result;
  }

  async getDocument(employeeId: string, docId: string) {
    const docs = await this.repos.documents.listByEmployee(employeeId);
    const doc = docs.find((d) => d.id === docId);
    if (!doc?.storageKey) throw new NotFoundError('document', docId);
    return doc;
  }

  // ------------------------------------------------------------ signed links

  /** Page context for the public form / approval pages. */
  async linkContext(rawToken: string) {
    const token = await this.links.verify(rawToken);

    if (token.purpose === 'DATA_FORM' && token.employee) {
      const documents = await this.repos.documents.listByEmployee(token.employee.id);
      return {
        purpose: token.purpose,
        employee: publicEmployee(token.employee),
        documents: documents.map((d) => ({
          id: d.id,
          type: d.type,
          label: d.label,
          required: d.required,
          uploaded: d.storageKey !== null,
        })),
      };
    }

    if (token.purpose === 'CONTRACT_APPROVAL' && token.employee) {
      const contract = await this.repos.contracts.findByEmployee(token.employee.id);
      return {
        purpose: token.purpose,
        employee: publicEmployee(token.employee),
        contract: contract ? { details: contract.details, sentAt: contract.sentAt } : null,
      };
    }

    throw new NotFoundError('link', 'unsupported purpose');
  }

  /**
   * The new hire submits the data form through the signed link.
   *
   * Validation happens BEFORE any write: a submission missing a required
   * attachment changes nothing. The caller receives `orphanedKeys` — files
   * now unreferenced (replaced uploads + unknown field names) — to remove
   * from disk; they are deliberately not part of the public response.
   */
  async submitForm(
    rawToken: string,
    fields: Partial<DataFormInput>,
    uploads: Array<{ documentId: string; storageKey: string; mimeType: string; sizeBytes: number }>,
  ) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'DATA_FORM' || !token.employee) {
      throw new NotFoundError('link', 'not a data-form link');
    }
    const employee = token.employee;
    const checklist = await this.repos.documents.listByEmployee(employee.id);
    const now = new Date();

    const known = uploads.filter((u) => checklist.some((d) => d.id === u.documentId));
    const unknown = uploads.filter((u) => !checklist.some((d) => d.id === u.documentId));

    // HR requires both attachments for the contract, so refuse a submission
    // that would move the record forward without them — before touching the
    // database at all.
    //
    // A type counts as satisfied when it already had a file (a resubmission
    // that only fixes a text field) or when this request just supplied one.
    const uploadedIds = new Set(known.map((u) => u.documentId));
    const missing = REQUIRED_DOCUMENT_TYPES.filter(
      (type) =>
        !checklist.some(
          (d) => d.type === type && (d.storageKey !== null || uploadedIds.has(d.id)),
        ),
    );
    if (missing.length > 0) {
      throw new GuardFailedError(
        'MISSING_DOCUMENTS',
        `required attachments missing: ${missing.join(', ')}`,
      );
    }

    // Files being replaced by this submission — orphaned once the tx commits.
    const replacedKeys = checklist
      .filter((d) => d.storageKey !== null && uploadedIds.has(d.id))
      .map((d) => d.storageKey as string);

    const result = await this.transact(async (s) => {
      for (const upload of known) {
        await s.documents.attachUpload(
          upload.documentId,
          { storageKey: upload.storageKey, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes },
          now,
        );
      }
      await s.employees.updatePersonal(employee.id, compact(fields));
      const r = await s.workflow.transition(employee, 'SUBMIT_FORM', {
        type: 'LINK',
        id: token.id,
      });
      await s.markLinkUsed(token.id, now);
      return r;
    });

    return { ...result, orphanedKeys: [...replacedKeys, ...unknown.map((u) => u.storageKey)] };
  }

  /**
   * E-approval activates the employee. The transition, contract approval
   * stamp, number allocation, activation, audit entry and link consumption
   * are ONE transaction — a crash anywhere leaves no half-activated record.
   */
  async approveContract(rawToken: string) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'CONTRACT_APPROVAL' || !token.employee) {
      throw new NotFoundError('link', 'not a contract-approval link');
    }
    const employee = token.employee;
    const now = new Date();

    const { result, employeeNo } = await this.transact(async (s) => {
      const r = await s.workflow.transition(employee, 'APPROVE_CONTRACT', {
        type: 'LINK',
        id: token.id,
      });

      const contract = await s.contracts.findByEmployee(employee.id);
      if (contract) await s.contracts.markApproved(contract.id, now);

      const employeeNo = await s.employees.allocateEmployeeNo();
      await s.employees.completeActivation(employee.id, employeeNo, now);

      await s.audit.append({
        entity: 'EMPLOYEE',
        entityId: employee.id,
        action: 'ACTIVATED',
        actorType: 'SYSTEM',
        employeeId: employee.id,
        metadata: { employeeNo, from: 'contract-approval' },
      });

      await s.markLinkUsed(token.id, now);
      return { result: r, employeeNo };
    });

    await this.notifications.notifyHr(
      'hr.contract_approved',
      { name: `${employee.firstName} ${employee.lastName}` },
      { entity: 'EMPLOYEE', entityId: employee.id },
    );

    return { ...result, employeeId: employee.id, employeeNo };
  }

  // ------------------------------------------------------------------ private

  private async mustFind(id: string): Promise<Employee> {
    const employee = await this.repos.employees.findById(id);
    if (!employee) throw new NotFoundError('employee', id);
    return employee;
  }

  private async sendDataFormLink(employee: Employee, actor: Actor) {
    const link = await this.links.issue('DATA_FORM', { employeeId: employee.id });
    await this.notifications.notifyExternal(
      employee.email,
      // First send welcomes; the SLA watcher uses 'employee.form_reminder' to chase.
      'employee.form_invite',
      { name: `${employee.firstName} ${employee.lastName}`, linkUrl: link.url },
      { entity: 'EMPLOYEE', entityId: employee.id },
    );
    await this.auditLinkSent(employee.id, 'DATA_FORM', actor);
    return { url: link.url, expiresAt: link.expiresAt };
  }

  private auditLinkSent(employeeId: string, purpose: string, actor: Actor) {
    return this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: employeeId,
      action: 'LINK_SENT',
      actorType: actor.type,
      ...(actor.id && actor.type === 'USER' ? { actorId: actor.id } : {}),
      employeeId,
      metadata: { purpose },
    });
  }
}
