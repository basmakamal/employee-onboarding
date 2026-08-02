import type { Prisma } from '../../generated/prisma/client.js';
import type { Trainee } from '../../generated/prisma/client.js';
import type { Actor, Workflow } from '../../workflow/engine.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { TraineeRepository, CreateTraineeData } from './trainee.repository.js';
import type { TraineeDocumentRepository } from './trainee-document.repository.js';
import type { ContractRepository } from './contract.repository.js';
import type { EmployeeRepository } from '../employees/employee.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';
import type { NotificationService } from '../../notifications/notification.service.js';

/**
 * Stage 1 orchestration. Every status change goes through the workflow
 * (guarded + audited); this service adds the side effects around it:
 * signed links, notifications, contract stamps, and — on approval — the
 * automatic employee-profile creation the BRD requires.
 */
export class TraineeService {
  constructor(
    private readonly repos: {
      trainees: TraineeRepository;
      documents: TraineeDocumentRepository;
      contracts: ContractRepository;
      employees: EmployeeRepository;
      audit: AuditLogRepository;
    },
    private readonly workflow: Workflow<Trainee>,
    private readonly links: LinkTokenService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------- HR side

  async create(input: CreateTraineeData, actor: Actor) {
    const trainee = await this.repos.trainees.create(input);
    await this.repos.audit.append({
      entity: 'TRAINEE',
      entityId: trainee.id,
      action: 'CREATE',
      toStatus: trainee.status,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      traineeId: trainee.id,
    });
    return trainee;
  }

  list() {
    return this.repos.trainees.list();
  }

  async get(id: string, actor: Actor) {
    const trainee = await this.repos.trainees.findWithDetails(id);
    if (!trainee) throw new NotFoundError('trainee', id);
    return {
      ...trainee,
      availableActions: this.workflow.availableActions(trainee.status, actor.type),
    };
  }

  /** SEND_FORM: transition, then email the signed data-form link. */
  async sendForm(id: string, actor: Actor) {
    const trainee = await this.mustFind(id);
    await this.workflow.transition(trainee, 'SEND_FORM', actor);
    return this.sendDataFormLink(trainee, actor);
  }

  /** REQUEST_MISSING: back to the trainee with a fresh link (BRD loop). */
  async requestMissing(id: string, actor: Actor, notes?: string) {
    const trainee = await this.mustFind(id);
    await this.workflow.transition(trainee, 'REQUEST_MISSING', actor, notes ? { notes } : undefined);
    return this.sendDataFormLink(trainee, actor);
  }

  async acceptDocuments(id: string, actor: Actor) {
    const trainee = await this.mustFind(id);
    return this.workflow.transition(trainee, 'ACCEPT_DOCUMENTS', actor);
  }

  /** Create or update the contract while in CONTRACT_CREATION. */
  async upsertContract(id: string, details: Prisma.InputJsonValue, actor: Actor) {
    const trainee = await this.mustFind(id);
    if (trainee.status !== 'CONTRACT_CREATION') {
      throw new GuardFailedError(
        'WRONG_STATUS',
        'the contract can only be edited during contract creation',
      );
    }
    const existing = await this.repos.contracts.findByTrainee(id);
    if (existing) return this.repos.contracts.updateDetails(existing.id, details);
    return this.repos.contracts.create({
      traineeId: id,
      createdById: actor.id ?? '',
      details,
    });
  }

  /** SEND_CONTRACT: transition (guards docs+contract), stamp, link, email. */
  async sendContract(id: string, actor: Actor) {
    const trainee = await this.mustFind(id);
    await this.workflow.transition(trainee, 'SEND_CONTRACT', actor);

    const contract = await this.repos.contracts.findByTrainee(id);
    if (contract) await this.repos.contracts.markSent(contract.id, new Date());

    const link = await this.links.issue('CONTRACT_APPROVAL', { traineeId: id });
    await this.notifications.notifyExternal(
      trainee.email,
      'trainee.contract_approval_reminder',
      { name: `${trainee.firstName} ${trainee.lastName}`, linkUrl: link.url },
      { entity: 'TRAINEE', entityId: id },
    );
    await this.auditLinkSent(id, 'CONTRACT_APPROVAL', actor);
    return { url: link.url, expiresAt: link.expiresAt };
  }

  /** REOPEN: resume where it left off; re-send the matching link. */
  async reopen(id: string, actor: Actor) {
    const trainee = await this.mustFind(id);
    const result = await this.workflow.transition(trainee, 'REOPEN', actor);
    if (result.to === 'AWAITING_FORM') await this.sendDataFormLink(trainee, actor);
    if (result.to === 'AWAITING_CONTRACT_APPROVAL') {
      const link = await this.links.issue('CONTRACT_APPROVAL', { traineeId: id });
      await this.notifications.notifyExternal(
        trainee.email,
        'trainee.contract_approval_reminder',
        { name: `${trainee.firstName} ${trainee.lastName}`, linkUrl: link.url },
        { entity: 'TRAINEE', entityId: id },
      );
      await this.auditLinkSent(id, 'CONTRACT_APPROVAL', actor);
    }
    return result;
  }

  async getDocument(traineeId: string, docId: string) {
    const docs = await this.repos.documents.listByTrainee(traineeId);
    const doc = docs.find((d) => d.id === docId);
    if (!doc || !doc.storageKey) throw new NotFoundError('document', docId);
    return doc;
  }

  // -------------------------------------------------------- signed-link side

  /** What the public page renders, per purpose. */
  async linkContext(rawToken: string) {
    const token = await this.links.verify(rawToken);

    if (token.purpose === 'DATA_FORM' && token.trainee) {
      const documents = await this.repos.documents.listByTrainee(token.trainee.id);
      return {
        purpose: token.purpose,
        trainee: publicTrainee(token.trainee),
        documents: documents.map((d) => ({
          id: d.id,
          type: d.type,
          label: d.label,
          required: d.required,
          uploaded: d.storageKey !== null,
        })),
      };
    }

    if (token.purpose === 'CONTRACT_APPROVAL' && token.trainee) {
      const contract = await this.repos.contracts.findByTrainee(token.trainee.id);
      return {
        purpose: token.purpose,
        trainee: publicTrainee(token.trainee),
        contract: contract ? { details: contract.details, sentAt: contract.sentAt } : null,
      };
    }

    throw new NotFoundError('link', 'unsupported purpose');
  }

  /** Trainee submits the data form: fields + uploaded files, then SUBMIT_FORM. */
  async submitForm(
    rawToken: string,
    fields: { phone?: string; nationalId?: string; birthDate?: Date },
    uploads: Array<{ documentId: string; storageKey: string; mimeType: string; sizeBytes: number }>,
  ) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'DATA_FORM' || !token.trainee) {
      throw new NotFoundError('link', 'not a data-form link');
    }
    const trainee = token.trainee;

    const checklist = await this.repos.documents.listByTrainee(trainee.id);
    const now = new Date();
    for (const upload of uploads) {
      const row = checklist.find((d) => d.id === upload.documentId);
      if (!row) continue; // ignore files for unknown checklist rows
      await this.repos.documents.attachUpload(
        row.id,
        { storageKey: upload.storageKey, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes },
        now,
      );
    }
    await this.repos.trainees.updatePersonal(trainee.id, fields);

    const result = await this.workflow.transition(trainee, 'SUBMIT_FORM', {
      type: 'LINK',
      id: token.id,
    });
    await this.links.markUsed(token.id, now);
    return result;
  }

  /**
   * Trainee approves the contract → EMPLOYEE_CREATED, and the BRD's
   * automatic employee-profile creation with full data transfer.
   */
  async approveContract(rawToken: string) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'CONTRACT_APPROVAL' || !token.trainee) {
      throw new NotFoundError('link', 'not a contract-approval link');
    }
    const trainee = token.trainee;

    // Race-safe gate: only one approval can win this transition.
    const result = await this.workflow.transition(trainee, 'APPROVE_CONTRACT', {
      type: 'LINK',
      id: token.id,
    });

    const now = new Date();
    const contract = await this.repos.contracts.findByTrainee(trainee.id);
    if (contract) await this.repos.contracts.markApproved(contract.id, now);

    const employeeNo = `EMP-${String((await this.repos.employees.count()) + 1).padStart(4, '0')}`;
    const employee = await this.repos.employees.create({
      employeeNo,
      firstName: trainee.firstName,
      lastName: trainee.lastName,
      email: trainee.email,
      ...(trainee.phone ? { phone: trainee.phone } : {}),
      ...(trainee.nationalId ? { nationalId: trainee.nationalId } : {}),
      ...(trainee.birthDate ? { birthDate: trainee.birthDate } : {}),
      ...(trainee.department ? { department: trainee.department } : {}),
      ...(trainee.jobTitle ? { jobTitle: trainee.jobTitle } : {}),
      hireDate: now,
      traineeId: trainee.id,
    });

    await this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: employee.id,
      action: 'CREATE',
      toStatus: 'ACTIVE',
      actorType: 'SYSTEM',
      traineeId: trainee.id,
      employeeId: employee.id,
      metadata: { employeeNo, from: 'contract-approval' },
    });
    await this.links.markUsed(token.id, now);
    await this.notifications.notifyHr(
      'hr.contract_approved',
      { name: `${trainee.firstName} ${trainee.lastName}` },
      { entity: 'EMPLOYEE', entityId: employee.id },
    );

    return { ...result, employeeId: employee.id, employeeNo };
  }

  // ------------------------------------------------------------------ private

  private async mustFind(id: string) {
    const trainee = await this.repos.trainees.findById(id);
    if (!trainee) throw new NotFoundError('trainee', id);
    return trainee;
  }

  private async sendDataFormLink(trainee: Trainee, actor: Actor) {
    const link = await this.links.issue('DATA_FORM', { traineeId: trainee.id });
    await this.notifications.notifyExternal(
      trainee.email,
      'trainee.form_reminder',
      { name: `${trainee.firstName} ${trainee.lastName}`, linkUrl: link.url },
      { entity: 'TRAINEE', entityId: trainee.id },
    );
    await this.auditLinkSent(trainee.id, 'DATA_FORM', actor);
    return { url: link.url, expiresAt: link.expiresAt };
  }

  private auditLinkSent(traineeId: string, purpose: string, actor: Actor) {
    return this.repos.audit.append({
      entity: 'TRAINEE',
      entityId: traineeId,
      action: 'LINK_SENT',
      actorType: actor.type,
      ...(actor.id && actor.type === 'USER' ? { actorId: actor.id } : {}),
      traineeId,
      metadata: { purpose },
    });
  }
}

function publicTrainee(t: Trainee) {
  return {
    firstName: t.firstName,
    lastName: t.lastName,
    email: t.email,
    phone: t.phone,
    nationalId: t.nationalId,
    birthDate: t.birthDate,
    department: t.department,
    jobTitle: t.jobTitle,
    status: t.status,
  };
}
