import type { Employee, Prisma } from '../../generated/prisma/client.js';
import type { Actor, Workflow } from '../../workflow/engine.js';
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
    jobTitle: e.jobTitle,
    status: e.status,
  };
}

/**
 * The onboarding pipeline (BRD stage 1) on the unified employee record:
 * intake → data form → document review → contract → e-approval, which
 * activates the employee (number allocated, Stage-2 tracks opened).
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
  ) {}

  async create(input: CreateOnboardingData, actor: Actor) {
    const employee = await this.repos.employees.createOnboarding(input);
    await this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: employee.id,
      action: 'CREATE',
      toStatus: employee.status,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId: employee.id,
    });
    return employee;
  }

  async sendForm(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    await this.workflow.transition(employee, 'SEND_FORM', actor);
    return this.sendDataFormLink(employee, actor);
  }

  async requestMissing(id: string, actor: Actor, notes?: string) {
    const employee = await this.mustFind(id);
    await this.workflow.transition(employee, 'REQUEST_MISSING', actor, notes ? { notes } : undefined);
    return this.sendDataFormLink(employee, actor);
  }

  async acceptDocuments(id: string, actor: Actor) {
    const employee = await this.mustFind(id);
    return this.workflow.transition(employee, 'ACCEPT_DOCUMENTS', actor);
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
    await this.workflow.transition(employee, 'SEND_CONTRACT', actor);

    const contract = await this.repos.contracts.findByEmployee(id);
    if (contract) await this.repos.contracts.markSent(contract.id, new Date());

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
    const result = await this.workflow.transition(employee, 'REOPEN', actor);

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

  /** The new hire submits the data form through the signed link. */
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

    for (const upload of uploads) {
      const row = checklist.find((d) => d.id === upload.documentId);
      if (!row) continue; // unknown field names are ignored, not fatal
      await this.repos.documents.attachUpload(
        row.id,
        { storageKey: upload.storageKey, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes },
        now,
      );
    }

    // HR requires both attachments for the contract, so refuse a submission
    // that would move the record forward without them.
    //
    // A type counts as satisfied when it already had a file (a resubmission
    // that only fixes a text field) or when this request just supplied one.
    // Derived from what we have rather than re-reading the checklist: the
    // second query would be a round trip purely to observe our own writes.
    const uploadedIds = new Set(uploads.map((u) => u.documentId));
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

    await this.repos.employees.updatePersonal(employee.id, fields);
    const result = await this.workflow.transition(employee, 'SUBMIT_FORM', {
      type: 'LINK',
      id: token.id,
    });
    await this.links.markUsed(token.id, now);
    return result;
  }

  /**
   * E-approval activates the employee: the guarded ACTIVE transition wins
   * the race, then the number is allocated and the Stage-2 tracks open.
   */
  async approveContract(rawToken: string) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'CONTRACT_APPROVAL' || !token.employee) {
      throw new NotFoundError('link', 'not a contract-approval link');
    }
    const employee = token.employee;

    const result = await this.workflow.transition(employee, 'APPROVE_CONTRACT', {
      type: 'LINK',
      id: token.id,
    });

    const now = new Date();
    const contract = await this.repos.contracts.findByEmployee(employee.id);
    if (contract) await this.repos.contracts.markApproved(contract.id, now);

    const employeeNo = await this.repos.employees.nextEmployeeNo();
    await this.repos.employees.completeActivation(employee.id, employeeNo, now);

    await this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: employee.id,
      action: 'ACTIVATED',
      actorType: 'SYSTEM',
      employeeId: employee.id,
      metadata: { employeeNo, from: 'contract-approval' },
    });

    await this.links.markUsed(token.id, now);
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
