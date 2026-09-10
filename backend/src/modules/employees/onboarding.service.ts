import type { Employee, Prisma } from '../../generated/prisma/client.js';
import type { ContractStatus } from '../../generated/prisma/enums.js';
import type { Actor, Workflow } from '../../workflow/engine.js';
import type { UnitOfWork } from '../../common/prisma.js';
import { compact } from '../../common/http.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { OpenWorkHalter } from '../../workflow/halt-open-work.js';
import type { EmployeeRepository, CreateOnboardingData } from './employee.repository.js';
import type { OnboardingDocumentRepository } from './onboarding-document.repository.js';
import type { ContractRepository } from './contract.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';
import type { NotificationService } from '../../notifications/notification.service.js';
import { REQUIRED_DOCUMENT_TYPES, type DataFormInput } from './data-form.schema.js';
import { languageFromLocale, localeOf } from '../../notifications/locale.js';

/** What a signed link may see of the record — no ids, no internals. */
/**
 * What the signed-link pages may see. This is the person's own record, and
 * HR can send the form back for corrections at any point, so everything the
 * form collects is returned: the page reopens fully filled and fully
 * editable rather than making someone retype a submission to fix one field.
 */
function publicEmployee(e: Employee) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    nationalId: e.nationalId,
    birthDate: e.birthDate,
    gender: e.gender,
    nationality: e.nationality,
    maritalStatus: e.maritalStatus,
    splAddress: e.splAddress,
    iban: e.iban,
    qualification: e.qualification,
    major: e.major,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    department: e.department,
    // Shown read-only on the data form: HR sets it when creating the record,
    // so asking the employee to retype it would only invite a mismatch.
    project: e.project,
    jobTitle: e.jobTitle,
    status: e.status,
    preferredLanguage: e.preferredLanguage,
  };
}

/** The contract states HR can set by hand (DRAFT is the starting point). */
export type ManualContractStatus = Exclude<ContractStatus, 'DRAFT'>;

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
 * intake → data form → document review → contract.
 *
 * The contract is created and approved on an external platform, so HR
 * records its status here (Pending Approval / Active / Rejected / Expired).
 * Recording ACTIVE is the conversion: number allocated, Stage-2 tracks
 * opened. A trainee can be withdrawn at any stage before that; everything
 * open on their file is then stopped, nothing deleted.
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
    /** Stops links / custody forms / process cards when a trainee withdraws. */
    private readonly halter?: OpenWorkHalter,
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
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
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
  async upsertContract(
    id: string,
    details: Prisma.InputJsonValue,
    actor: Actor,
    externalRef?: string | null,
  ) {
    const employee = await this.mustFind(id);
    if (employee.status !== 'CONTRACT_CREATION') {
      throw new GuardFailedError(
        'WRONG_STATUS',
        'the contract can only be edited during contract creation',
      );
    }
    const existing = await this.repos.contracts.findByEmployee(id);
    if (existing) return this.repos.contracts.updateDetails(existing.id, details, externalRef);
    return this.repos.contracts.create({
      employeeId: id,
      createdById: actor.id ?? '',
      details,
      ...(externalRef !== undefined ? { externalRef } : {}),
    });
  }

  /**
   * Attach the contract itself (scan, photo or PDF). Typed terms are optional:
   * a contract may consist of nothing but the uploaded document. Returns the
   * previous file key so the caller can delete it from storage.
   */
  async setContractFile(id: string, storageKey: string, actor: Actor) {
    const employee = await this.mustFind(id);
    if (employee.status !== 'CONTRACT_CREATION') {
      throw new GuardFailedError(
        'WRONG_STATUS',
        'the contract can only be edited during contract creation',
      );
    }
    const existing = await this.repos.contracts.findByEmployee(id);
    if (existing) {
      const contract = await this.repos.contracts.setStorageKey(existing.id, storageKey);
      return { contract, previousKey: existing.storageKey ?? null };
    }
    const contract = await this.repos.contracts.create({
      employeeId: id,
      createdById: actor.id ?? '',
      details: {},
      storageKey,
    });
    return { contract, previousKey: null };
  }

  /** Storage key of the uploaded contract document, if any. */
  async contractFileKey(id: string): Promise<string> {
    const contract = await this.repos.contracts.findByEmployee(id);
    if (!contract?.storageKey) throw new NotFoundError('contract file', id);
    return contract.storageKey;
  }

  /**
   * HR records what happened to the contract on the external platform.
   *
   *   PENDING_APPROVAL  submitted for approval     → AWAITING_CONTRACT_APPROVAL
   *   ACTIVE            approved & in force        → ACTIVE (the conversion)
   *   REJECTED          sent back                  → CONTRACT_CREATION (fix, resubmit)
   *   EXPIRED           approval window ran out    → EXPIRED (HR may reopen)
   *
   * The employee transition and the contract stamp are one transaction, so
   * the two can never disagree.
   */
  async setContractStatus(
    id: string,
    status: ManualContractStatus,
    actor: Actor,
    opts: { reason?: string } = {},
  ) {
    const employee = await this.mustFind(id);
    const contract = await this.repos.contracts.findByEmployee(id);
    if (!contract) {
      throw new GuardFailedError('CONTRACT_MISSING', 'enter the contract details first');
    }
    const now = new Date();

    if (status === 'ACTIVE') {
      const { result, employeeNo } = await this.transact(async (s) => {
        const r = await s.workflow.transition(employee, 'APPROVE_CONTRACT', actor);
        await s.contracts.setStatus(contract.id, 'ACTIVE', { approvedAt: now, rejectReason: null });

        // Trainee → employee: number allocated, Stage-2 tracks opened.
        const employeeNo = await s.employees.allocateEmployeeNo();
        await s.employees.completeActivation(employee.id, employeeNo, now);
        await s.audit.append({
          entity: 'EMPLOYEE',
          entityId: employee.id,
          action: 'ACTIVATED',
          actorType: actor.type,
          ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
          employeeId: employee.id,
          metadata: { employeeNo, from: 'contract-active' },
        });
        return { result: r, employeeNo };
      });
      return { ...result, contractStatus: status, employeeNo };
    }

    const result = await this.transact(async (s) => {
      if (status === 'PENDING_APPROVAL') {
        const r = await s.workflow.transition(employee, 'SUBMIT_CONTRACT', actor);
        await s.contracts.setStatus(contract.id, status, { sentAt: now, rejectReason: null });
        return r;
      }
      if (status === 'REJECTED') {
        const r = await s.workflow.transition(
          employee,
          'REJECT_CONTRACT',
          actor,
          opts.reason ? { reason: opts.reason } : undefined,
        );
        await s.contracts.setStatus(contract.id, status, { rejectReason: opts.reason ?? null });
        return r;
      }
      // EXPIRED — "the approval window closed without a decision".
      const r = await s.workflow.transition(
        employee,
        'EXPIRE',
        actor,
        opts.reason ? { reason: opts.reason } : undefined,
      );
      await s.contracts.setStatus(contract.id, status);
      return r;
    });
    return { ...result, contractStatus: status };
  }

  /** BRD: reopen resumes from the last completed stage. */
  async reopen(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    const result = await this.transact(async (s) => {
      const r = await s.workflow.transition(employee, 'REOPEN', actor);
      // Back to waiting on the platform — the contract card says so again.
      if (r.to === 'AWAITING_CONTRACT_APPROVAL') {
        await s.contracts.setStatusByEmployee(id, 'PENDING_APPROVAL');
      }
      return r;
    });

    if (result.to === 'AWAITING_FORM') {
      await this.sendDataFormLink(employee, actor);
    }
    return result;
  }

  /**
   * The trainee withdrew (or the hire was dropped) before activation.
   * Business rule: every open action on the file stops — links, custody
   * forms, process cards — and everything already recorded stays in the
   * history. The status move commits first; the sweep runs in its own
   * transaction right after, so a failed sweep can be retried without the
   * withdrawal itself being in doubt.
   */
  async withdraw(id: string, actor: Actor, reason: string) {
    const employee = await this.mustFind(id);
    const result = await this.transact((s) =>
      s.workflow.transition(employee, 'WITHDRAW', actor, { reason }),
    );
    const halted = this.halter ? await this.halter.halt(id, 'WITHDRAWN', actor) : null;
    return { ...result, halted };
  }

  async getDocument(employeeId: string, docId: string) {
    const docs = await this.repos.documents.listByEmployee(employeeId);
    const doc = docs.find((d) => d.id === docId);
    if (!doc?.storageKey) throw new NotFoundError('document', docId);
    return doc;
  }

  // ------------------------------------------------------------ signed links

  /** Page context for the public data-form page. */
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
      if (!contract) throw new NotFoundError('contract', token.employee.id);
      const details = (contract.details ?? {}) as Record<string, unknown>;
      return {
        purpose: token.purpose,
        employee: publicEmployee(token.employee),
        contract: {
          status: contract.status,
          externalRef: contract.externalRef,
          salary: details['salary'] ?? null,
          durationMonths: details['durationMonths'] ?? null,
          startDate: details['startDate'] ?? null,
          terms: details['terms'] ?? null,
          // The document itself is fetched through the same token, never inlined here.
          hasDocument: contract.storageKey !== null,
        },
      };
    }

    throw new NotFoundError('link', 'unsupported purpose');
  }

  /**
   * The new hire's own decision, straight from the contract link.
   *
   * It runs through setContractStatus, the same path HR uses by hand, so an
   * e-approval and an HR approval leave the record in exactly the same state
   * (number allocated, Stage-2 tracks opened, everything audited) — with the
   * actor recorded as the link rather than a staff member. The link is spent
   * on the way out, so the decision cannot be replayed.
   */
  async decideContract(rawToken: string, decision: 'APPROVE' | 'REJECT', rejectReason?: string) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'CONTRACT_APPROVAL' || !token.employee) {
      throw new NotFoundError('link', 'not a contract link');
    }
    const employee = token.employee;
    const result = await this.setContractStatus(
      employee.id,
      decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED',
      { type: 'LINK', id: token.id },
      rejectReason ? { reason: rejectReason } : {},
    );
    await this.links.markUsed(token.id);

    const employeeNo = 'employeeNo' in result ? (result.employeeNo as string) : null;
    await this.notifications.notifyHr(
      decision === 'APPROVE' ? 'hr.contract_approved' : 'hr.contract_rejected',
      {
        name: `${employee.firstName} ${employee.lastName}`,
        ...(employeeNo ? { employeeNo } : {}),
        ...(rejectReason ? { rejectReason } : {}),
      },
      { entity: 'EMPLOYEE', entityId: employee.id },
    );
    return { decision, employeeNo };
  }

  /** The uploaded contract document, addressed by the employee's signed link. */
  async contractFileKeyByToken(rawToken: string): Promise<string> {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'CONTRACT_APPROVAL' || !token.employee) {
      throw new NotFoundError('link', 'not a contract link');
    }
    const contract = await this.repos.contracts.findByEmployee(token.employee.id);
    if (!contract?.storageKey) throw new NotFoundError('contract file', token.employee.id);
    return contract.storageKey;
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
    /** UI language the person filled the form in — becomes their email language. */
    locale?: string,
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
      const language = languageFromLocale(locale);
      await s.employees.updatePersonal(employee.id, {
        ...compact(fields),
        ...(language ? { preferredLanguage: language } : {}),
      });
      const r = await s.workflow.transition(employee, 'SUBMIT_FORM', {
        type: 'LINK',
        id: token.id,
      });
      await s.markLinkUsed(token.id, now);
      return r;
    });

    return { ...result, orphanedKeys: [...replacedKeys, ...unknown.map((u) => u.storageKey)] };
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
      localeOf(employee),
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
