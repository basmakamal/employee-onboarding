import type { Actor, OwnershipLookup } from '../../workflow/engine.js';
import { Workflow } from '../../workflow/engine.js';
import {
  employeeProcessMachine,
  criminalRecordMachine,
} from '../../workflow/machines/employee-process.machine.js';
import { NotFoundError } from '../../workflow/errors.js';
import type { EmployeeRepository, UpdateEmployeeData } from './employee.repository.js';
import type { EmployeeRequestRepository } from './employee-request.repository.js';
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

/**
 * Stage 2 — the employee file. The three processes are independent by BRD
 * design: each has its own machine, and nothing here blocks anything else.
 * Hold reasons/certificates travel alongside the guarded status move.
 */
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
    private readonly ownership?: OwnershipLookup,
  ) {}

  list() {
    return this.repos.employees.list();
  }

  /**
   * Direct creation for EXISTING staff (data migration / hires that never
   * went through the trainee flow). Trainee-originated employees are still
   * created automatically on contract approval — same repo call, so both
   * paths open the three Stage-2 process rows.
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
      hireDate?: Date;
    },
    actor: Actor,
  ) {
    const employeeNo = `EMP-${String((await this.repos.employees.count()) + 1).padStart(4, '0')}`;
    const employee = await this.repos.employees.create({
      ...input,
      employeeNo,
      hireDate: input.hireDate ?? new Date(),
    });
    await this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: employee.id,
      action: 'CREATE',
      toStatus: 'ACTIVE',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId: employee.id,
      metadata: { employeeNo, from: 'direct' },
    });
    return employee;
  }

  /**
   * HR edits the profile in place. Audited with the list of touched fields
   * so the timeline shows WHAT changed, not just that something did.
   */
  async update(id: string, input: UpdateEmployeeData, actor: Actor) {
    const existing = await this.repos.employees.findById(id);
    if (!existing) throw new NotFoundError('employee', id);

    const updated = await this.repos.employees.update(id, input);
    await this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: id,
      action: 'UPDATE_PROFILE',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId: id,
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  }

  async setPhoto(id: string, photoKey: string, actor: Actor) {
    const existing = await this.repos.employees.findById(id);
    if (!existing) throw new NotFoundError('employee', id);

    await this.repos.employees.setPhoto(id, photoKey);
    await this.repos.audit.append({
      entity: 'EMPLOYEE',
      entityId: id,
      action: 'UPDATE_PHOTO',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId: id,
    });
    return { photoKey };
  }

  async getPhotoKey(id: string): Promise<string> {
    const employee = await this.repos.employees.findById(id);
    if (!employee?.photoKey) throw new NotFoundError('photo', id);
    return employee.photoKey;
  }

  /** Log an HR service request (salary letter, promotion, warning…). */
  async createRequest(
    employeeId: string,
    type: EmployeeRequestType,
    actor: Actor,
    notes?: string,
  ) {
    const existing = await this.repos.employees.findById(employeeId);
    if (!existing) throw new NotFoundError('employee', employeeId);

    const request = await this.repos.requests.create({
      employeeId,
      type,
      ...(notes ? { notes } : {}),
      createdById: actor.id as string,
    });
    await this.repos.audit.append({
      entity: 'EMPLOYEE_REQUEST',
      entityId: request.id,
      action: type,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId,
    });
    return request;
  }

  async getDetails(id: string, actor: Actor) {
    const employee = await this.repos.employees.findWithDetails(id);
    if (!employee) throw new NotFoundError('employee', id);

    const processMachine = new Workflow(employeeProcessMachine('GOSI'), noopDeps(this.ownership));
    const criminalMachine = new Workflow(criminalRecordMachine(), noopDeps(this.ownership));

    // Slim the trainee relation down to what the profile shows: the contract
    // summary (salary only for the groups that should see money) and the
    // onboarding document checklist.
    const { trainee, ...rest } = employee;
    const seesSalary = actor.role === 'HR' || actor.role === 'FINANCE' || actor.role === 'ADMIN';
    const details = (trainee?.contract?.details ?? null) as Record<string, unknown> | null;
    const contract = trainee?.contract
      ? {
          startDate: details?.['startDate'] ?? null,
          durationMonths: details?.['durationMonths'] ?? null,
          terms: details?.['terms'] ?? null,
          ...(seesSalary ? { salary: details?.['salary'] ?? null } : {}),
          sentAt: trainee.contract.sentAt,
          approvedAt: trainee.contract.approvedAt,
        }
      : null;

    return {
      ...rest,
      contract,
      onboardingDocuments:
        trainee?.documents.map((d) => ({
          id: d.id,
          type: d.type,
          required: d.required,
          uploaded: d.storageKey !== null,
        })) ?? [],
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

  /** One entry point for all three process cards. */
  async actOnProcess(
    employeeId: string,
    kind: ProcessKind,
    action: string,
    actor: Actor,
    input: ProcessActionInput = {},
  ) {
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
    const repo = kind === 'gosi' ? this.repos.gosi : this.repos.medical;
    const row = await repo.findByEmployee(employeeId);
    if (!row) throw new NotFoundError(`${kind} process`, employeeId);

    const machineKey = kind === 'gosi' ? 'GOSI' : 'MEDICAL_INSURANCE';
    const hold =
      action === 'HOLD'
        ? {
            reason: (input.holdReason ?? 'OTHER') as GosiHoldReason & MedicalHoldReason,
            ...(input.holdNote ? { note: input.holdNote } : {}),
          }
        : undefined;

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
        ),
      audit: (entry) => this.repos.audit.append(entry),
      anchors: () => ({ employeeId }),
    });

    return workflow.transition(row, action, actor, hold ? { hold } : undefined);
  }

  private async actOnCriminal(
    employeeId: string,
    action: string,
    actor: Actor,
    input: ProcessActionInput,
  ) {
    const row = await this.repos.criminal.findByEmployee(employeeId);
    if (!row) throw new NotFoundError('criminal process', employeeId);

    const workflow = new Workflow<ProcessRow>(criminalRecordMachine(), {
      getId: (r) => r.id,
      getStatus: (r) => r.status,
      ...(this.ownership ? { ownership: this.ownership } : {}),
      move: (r, from, to) =>
        this.repos.criminal.moveStatus(
          r.id,
          from as CriminalRecordStatus,
          to as CriminalRecordStatus,
          input.certificateStorageKey,
        ),
      audit: (entry) => this.repos.audit.append(entry),
      anchors: () => ({ employeeId }),
    });

    return workflow.transition(row, action, actor);
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
