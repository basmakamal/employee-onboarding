import type { Actor, OwnershipLookup } from '../../workflow/engine.js';
import { Workflow } from '../../workflow/engine.js';
import {
  employeeProcessMachine,
  criminalRecordMachine,
} from '../../workflow/machines/employee-process.machine.js';
import { NotFoundError } from '../../workflow/errors.js';
import { actorScope } from '../../auth/authz/authorize.js';
import { resolvePlacement, type PlacementInput } from './org-placement.js';
import type { Employee, Prisma } from '../../generated/prisma/client.js';
import type { UnitOfWork } from '../../common/prisma.js';
import type {
  EmployeeListQuery,
  EmployeeRepository,
  UpdateEmployeeData,
} from './employee.repository.js';
import type { EmployeeRequestRepository, RequestDocument } from './employee-request.repository.js';
import type { GosiRepository } from '../processes/gosi.repository.js';
import type { MedicalInsuranceRepository } from '../processes/medical-insurance.repository.js';
import type { CriminalRecordRepository } from '../processes/criminal-record.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type {
  ProcessStatus,
  GosiHoldReason,
  MedicalHoldReason,
  CriminalRecordStatus,
  EmployeeRequestType,
} from '../../generated/prisma/enums.js';
import type { EmploymentEventRepository } from './employment-event.repository.js';
import type { EmploymentHistoryService } from './employment-history.service.js';
import { fieldCrypto, maskIban } from '../../common/field-crypto.js';

export type ProcessKind = 'gosi' | 'medical' | 'criminal';

export interface ProcessActionInput {
  holdReason?: string;
  holdNote?: string;
  certificateStorageKey?: string;
}

interface ProcessRow {
  id: string;
  employeeId: string;
  status: string;
}

/** One employee-file unit of work — all repositories share one transaction. */
export interface EmployeeTxScope {
  employees: EmployeeRepository;
  /** Employment history rows written with the edit that caused them. */
  history?: Pick<EmploymentEventRepository, 'createMany'>;
  requests: EmployeeRequestRepository;
  gosi: GosiRepository;
  medical: MedicalInsuranceRepository;
  criminal: CriminalRecordRepository;
  audit: AuditLogRepository;
}

/**
 * The employee file. The three Stage-2 processes are independent by BRD
 * design: each has its own machine, and nothing here blocks anything else.
 * Hold reasons/certificates travel alongside the guarded status move.
 * Every write pairs with its audit row inside one transaction.
 */
/** The dropdown lists: options to offer, and a way to remember a value staff typed. */
interface ListsLike {
  codes(companyId: string, key: string): Promise<string[]>;
  ensureValue(companyId: string | null | undefined, key: string, value: string | null | undefined): Promise<void>;
}

/** Identity and bank numbers never enter the audit trail — only the fact that they changed. */
const MASKED_FIELDS = new Set(['nationalId', 'iban', 'passwordHash']);

/** { field: { from, to } } for the fields an edit actually changed. */
export function profileChanges(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const plain = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null));
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, next] of Object.entries(after)) {
    if (next === undefined || field === 'companyId') continue;
    const was = plain(before[field]);
    const now = plain(next);
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    out[field] = MASKED_FIELDS.has(field) ? { from: was === null ? null : '•••', to: now === null ? null : '•••' } : { from: was, to: now };
  }
  return out;
}

export class EmployeeService {
  constructor(
    private readonly repos: {
      employees: EmployeeRepository;
      requests: EmployeeRequestRepository;
      gosi: GosiRepository;
      medical: MedicalInsuranceRepository;
      criminal: CriminalRecordRepository;
      audit: AuditLogRepository;
    },
    private readonly transact: UnitOfWork<EmployeeTxScope>,
    private readonly ownership?: OwnershipLookup,
    /** The onboarding pipeline machine — drives the profile's action buttons. */
    private readonly onboarding?: Workflow<Employee>,
    private readonly lists?: ListsLike,
    /** Turns a profile edit into dated history rows (unit, title, manager…). */
    private readonly history?: Pick<EmploymentHistoryService, 'draftsForEdit'>,
  ) {}

  /** A department, project or title typed by staff becomes a choice in that company's lists. */
  private async remember(
    companyId: string | null | undefined,
    input: {
      department?: string | null;
      project?: string | null;
      jobTitle?: string | null;
    },
  ): Promise<void> {
    if (!this.lists || !companyId) return;
    await this.lists.ensureValue(companyId, 'DEPARTMENT', input.department);
    await this.lists.ensureValue(companyId, 'PROJECT', input.project);
    await this.lists.ensureValue(companyId, 'JOB_TITLE', input.jobTitle);
  }

  /** One server-side page plus the tab badge counts, in parallel. */
  /** The list, counts included, limited to what this actor may reach. */
  async list(query: EmployeeListQuery, actor?: Actor) {
    const scope = actorScope(actor);
    const [{ items, total }, counts] = await Promise.all([
      this.repos.employees.listPaged(query, scope),
      this.repos.employees.statusCounts(scope),
    ]);
    return { items, total, counts };
  }

  auditPage(employeeId: string, page: number, limit: number) {
    return this.repos.employees.timelinePage(employeeId, page, limit);
  }

  /** Dropdown choices for the employee forms — the selected company's lists when present. */
  async fieldOptions(companyId?: string) {
    if (!this.lists || !companyId) return this.repos.employees.fieldOptions();
    const [departments, jobTitles, projects] = await Promise.all([
      this.lists.codes(companyId, 'DEPARTMENT'),
      this.lists.codes(companyId, 'JOB_TITLE'),
      this.lists.codes(companyId, 'PROJECT'),
    ]);
    return { departments, jobTitles, projects };
  }

  /**
   * Direct creation for EXISTING staff (data migration / hires that never
   * went through onboarding). Born ACTIVE with a number and the three
   * Stage-2 process rows; new hires get theirs on contract approval.
   * Number allocation, creation and audit are one transaction.
   */
  async createDirect(
    input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      nationalId?: string;
      birthDate?: Date;
      department?: string;
      project?: string;
      jobTitle?: string;
      directManager?: string;
      hireDate?: Date;
    } & PlacementInput,
    actor: Actor,
  ) {
    // Company and placement come from the validated context, never the body.
    const placement = await resolvePlacement(this.repos.employees, actor, input);
    await this.remember(actor.companyId, { ...input, ...placement });
    return this.transact(async (s) => {
      const employeeNo = await s.employees.allocateEmployeeNo();
      const employee = await s.employees.createDirect({
        ...input,
        ...placement,
        employeeNo,
        hireDate: input.hireDate ?? new Date(),
        ...(actor.id ? { createdById: actor.id } : {}),
      });
      await s.audit.append({
        entity: 'EMPLOYEE',
        entityId: employee.id,
        action: 'CREATE',
        toStatus: 'ACTIVE',
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
        employeeId: employee.id,
        metadata: { employeeNo, from: 'direct' },
      });
      return employee;
    });
  }

  /**
   * HR edits the profile in place. Audited with the list of touched fields
   * so the timeline shows WHAT changed, not just that something did.
   */
  async update(id: string, input: UpdateEmployeeData & PlacementInput, actor: Actor) {
    const before = await this.mustFind(id, actor);
    const { companyId: _ignored, ...placement } = await resolvePlacement(this.repos.employees, actor, input, { selfId: id });
    void _ignored; // the company never changes through an edit
    const data = { ...input, ...placement };
    await this.remember(actor.companyId, data);
    // What changed in the employment (unit, title, manager, type, hire date) becomes history, effective today.
    const drafts = this.history ? await this.history.draftsForEdit(before, data, actor) : [];

    return this.transact(async (s) => {
      const updated = await s.employees.update(id, data);
      if (drafts.length > 0) await s.history?.createMany(drafts);
      await s.audit.append({
        entity: 'EMPLOYEE',
        entityId: id,
        action: 'UPDATE_PROFILE',
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
        employeeId: id,
        metadata: { fields: Object.keys(input) },
        changes: profileChanges(before, data) as Prisma.InputJsonValue,
      });
      return updated;
    });
  }

  /**
   * ADMIN-only hard delete. Everything attached to the file goes with it in
   * one transaction; the audit trail keeps a final DELETE entry naming who
   * removed whom. Returns the storage keys of the record's files so the
   * caller can remove them from disk AFTER the commit.
   */
  async remove(id: string, actor: Actor): Promise<string[]> {
    const existing = await this.mustFind(id, actor);

    const storageKeys = await this.repos.employees.collectStorageKeys(id);
    await this.transact(async (s) => {
      await s.employees.deleteCascade(id);
      await s.audit.append({
        entity: 'EMPLOYEE',
        entityId: id,
        action: 'DELETE',
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
        metadata: {
          employeeNo: existing.employeeNo,
          name: `${existing.firstName} ${existing.lastName}`,
          email: existing.email,
        },
      });
    });
    return storageKeys;
  }

  /** Returns the replaced photo's key so the caller can delete the file. */
  async setPhoto(id: string, photoKey: string, actor: Actor) {
    const existing = await this.mustFind(id, actor);

    await this.transact(async (s) => {
      await s.employees.setPhoto(id, photoKey);
      await s.audit.append({
        entity: 'EMPLOYEE',
        entityId: id,
        action: 'UPDATE_PHOTO',
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
        employeeId: id,
      });
    });
    return { photoKey, previousKey: existing.photoKey };
  }

  async getPhotoKey(id: string, actor?: Actor): Promise<string> {
    const employee = await this.repos.employees.findById(id, actorScope(actor));
    if (!employee?.photoKey) throw new NotFoundError('photo', id);
    return employee.photoKey;
  }

  /**
   * Log an HR service request (salary letter, promotion, warning…), with the
   * document behind it when HR already has the file in hand.
   */
  async createRequest(
    employeeId: string,
    type: EmployeeRequestType,
    actor: Actor,
    notes?: string,
    document?: RequestDocument,
  ) {
    // Scope guard: an employee outside the actor's company / subtree is a 404.
    await this.mustFind(employeeId, actor);

    return this.transact(async (s) => {
      const request = await s.requests.create({
        employeeId,
        type,
        ...(notes ? { notes } : {}),
        ...(document ? { document } : {}),
        createdById: actor.id as string,
      });
      await s.audit.append({
        entity: 'EMPLOYEE_REQUEST',
        entityId: request.id,
        action: type,
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
        employeeId,
        ...(document ? { metadata: { fileName: document.fileName } } : {}),
      });
      return request;
    });
  }

  /**
   * Attach (or replace) the document on a request raised earlier — the signed
   * copy usually comes back after the request itself was logged. Returns the
   * key of the file being replaced so the route can delete it AFTER the
   * commit: a failed write must never leave the row pointing at a deleted file.
   */
  async attachRequestDocument(
    employeeId: string,
    requestId: string,
    document: RequestDocument,
    actor: Actor,
  ) {
    const request = await this.mustFindRequest(employeeId, requestId);
    const replacedKey = request.storageKey;
    const updated = await this.transact(async (s) => {
      const row = await s.requests.setDocument(requestId, document);
      await s.audit.append({
        entity: 'EMPLOYEE_REQUEST',
        entityId: requestId,
        action: 'REQUEST_DOCUMENT_ATTACHED',
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
        employeeId,
        metadata: { type: request.type, fileName: document.fileName, replaced: replacedKey !== null },
      });
      return row;
    });
    return { request: updated, replacedKey };
  }

  /** Storage key + name of a request's document, for viewing. */
  async getRequestDocument(employeeId: string, requestId: string) {
    const request = await this.mustFindRequest(employeeId, requestId);
    if (!request.storageKey) throw new NotFoundError('request document', requestId);
    return { storageKey: request.storageKey, fileName: request.fileName, mimeType: request.mimeType };
  }

  /** A request is only reachable through its own employee's file. */
  /** The employee, or 404 — outside the actor's scope counts as not found. */
  private async mustFind(id: string, actor?: Actor) {
    const employee = await this.repos.employees.findById(id, actorScope(actor));
    if (!employee) throw new NotFoundError('employee', id);
    return employee;
  }

  private async mustFindRequest(employeeId: string, requestId: string) {
    const request = await this.repos.requests.findById(requestId);
    if (!request || request.employeeId !== employeeId) throw new NotFoundError('request', requestId);
    return request;
  }

  async getDetails(id: string, actor: Actor) {
    const employee = await this.repos.employees.findWithDetails(id, actorScope(actor));
    if (!employee) throw new NotFoundError('employee', id);
    // Newest page of the timeline; the rest is paged in from /audit.
    const timeline = await this.repos.employees.timelinePage(id, 1, 20);

    const processMachine = new Workflow(employeeProcessMachine('GOSI'), noopDeps(this.ownership));
    const criminalMachine = new Workflow(criminalRecordMachine(), noopDeps(this.ownership));

    // Contract summary — salary only for the groups that should see money.
    const { documents, contract: contractRow, _count, ...rest } = employee;
    const seesSalary = actor.role === 'HR' || actor.role === 'FINANCE' || actor.role === 'ADMIN';
    const details = (contractRow?.details ?? null) as Record<string, unknown> | null;
    const contract = contractRow
      ? {
          startDate: details?.['startDate'] ?? null,
          durationMonths: details?.['durationMonths'] ?? null,
          terms: details?.['terms'] ?? null,
          ...(seesSalary ? { salary: details?.['salary'] ?? null } : {}),
          sentAt: contractRow.sentAt,
          approvedAt: contractRow.approvedAt,
          status: contractRow.status,
          statusChangedAt: contractRow.statusChangedAt,
          rejectReason: contractRow.rejectReason,
          externalRef: contractRow.externalRef,
        }
      : null;

    return {
      ...rest,
      // Bank details: only the last digits here; the full number via GET /:id/iban (pay permission, audited).
      iban: maskIban(fieldCrypto().decrypt(rest.iban)),
      auditLogs: timeline.items,
      /** Everything on the timeline — the page above holds only the newest 20. */
      auditTotal: timeline.total,
      contract,
      onboardingDocuments: documents.map((d) => ({
        id: d.id,
        type: d.type,
        label: d.label,
        required: d.required,
        uploaded: d.storageKey !== null,
      })),
      /** Pipeline actions for the profile's onboarding section. */
      availableActions: this.onboarding
        ? this.onboarding.availableActions(employee.status, actor)
        : [],
      processActions: {
        gosi: employee.gosi ? processMachine.availableActions(employee.gosi.status, actor) : [],
        medical: employee.medical
          ? processMachine.availableActions(employee.medical.status, actor)
          : [],
        criminal: employee.criminalRecord
          ? criminalMachine.availableActions(employee.criminalRecord.status, actor)
          : [],
      },
    };
  }

  /** Storage key of a process's completion document, for viewing. */
  async getProcessCertificateKey(employeeId: string, kind: ProcessKind, actor?: Actor): Promise<string> {
    await this.mustFind(employeeId, actor);
    const repo =
      kind === 'gosi' ? this.repos.gosi : kind === 'medical' ? this.repos.medical : this.repos.criminal;
    const row = await repo.findByEmployee(employeeId);
    if (!row?.certificateStorageKey) throw new NotFoundError(`${kind} certificate`, employeeId);
    return row.certificateStorageKey;
  }

  /** One entry point for all three process cards. */
  async actOnProcess(
    employeeId: string,
    kind: ProcessKind,
    action: string,
    actor: Actor,
    input: ProcessActionInput = {},
  ) {
    await this.mustFind(employeeId, actor);
    if (kind === 'criminal') return this.actOnCriminal(employeeId, action, actor, input);
    return this.actOnHoldable(employeeId, kind, action, actor, input);
  }

  // ------------------------------------------------------------------ private

  /** GOSI + medical insurance share machine and hold semantics. */
  private async actOnHoldable(
    employeeId: string,
    kind: 'gosi' | 'medical',
    action: string,
    actor: Actor,
    input: ProcessActionInput,
  ) {
    const row = await (kind === 'gosi' ? this.repos.gosi : this.repos.medical).findByEmployee(
      employeeId,
    );
    if (!row) throw new NotFoundError(`${kind} process`, employeeId);

    const machineKey = kind === 'gosi' ? 'GOSI' : 'MEDICAL_INSURANCE';
    const hold =
      action === 'HOLD'
        ? {
            reason: (input.holdReason ?? 'OTHER') as GosiHoldReason & MedicalHoldReason,
            ...(input.holdNote ? { note: input.holdNote } : {}),
          }
        : undefined;

    return this.transact(async (s) => {
      const repo = kind === 'gosi' ? s.gosi : s.medical;
      const workflow = new Workflow<ProcessRow>(employeeProcessMachine(machineKey), {
        getId: (r) => r.id,
        getStatus: (r) => r.status,
        ...(this.ownership ? { ownership: this.ownership } : {}),
        move: (r, from, to) =>
          (repo as GosiRepository).moveStatus(
            r.id,
            from as ProcessStatus,
            to as ProcessStatus,
            hold as never,
            input.certificateStorageKey,
          ),
        audit: (entry) => s.audit.append(entry),
        anchors: () => ({ employeeId }),
      });
      return workflow.transition(row, action, actor, hold ? { hold } : undefined);
    });
  }

  private async actOnCriminal(
    employeeId: string,
    action: string,
    actor: Actor,
    input: ProcessActionInput,
  ) {
    const row = await this.repos.criminal.findByEmployee(employeeId);
    if (!row) throw new NotFoundError('criminal process', employeeId);

    return this.transact(async (s) => {
      const workflow = new Workflow<ProcessRow>(criminalRecordMachine(), {
        getId: (r) => r.id,
        getStatus: (r) => r.status,
        ...(this.ownership ? { ownership: this.ownership } : {}),
        move: (r, from, to) =>
          s.criminal.moveStatus(
            r.id,
            from as CriminalRecordStatus,
            to as CriminalRecordStatus,
            input.certificateStorageKey,
          ),
        audit: (entry) => s.audit.append(entry),
        anchors: () => ({ employeeId }),
      });
      return workflow.transition(row, action, actor);
    });
  }
}

/** availableActions never persists — inert deps are fine for lookups. */
function noopDeps(ownership?: OwnershipLookup) {
  return {
    getId: (r: ProcessRow) => r.id,
    getStatus: (r: ProcessRow) => r.status,
    move: () => Promise.resolve(false),
    audit: () => Promise.resolve({}),
    ...(ownership ? { ownership } : {}),
  };
}
