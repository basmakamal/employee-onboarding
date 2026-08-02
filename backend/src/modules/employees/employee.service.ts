import type { Actor } from '../../workflow/engine.js';
import { Workflow } from '../../workflow/engine.js';
import {
  employeeProcessMachine,
  criminalRecordMachine,
} from '../../workflow/machines/employee-process.machine.js';
import { NotFoundError } from '../../workflow/errors.js';
import type { EmployeeRepository } from './employee.repository.js';
import type { GosiRepository } from '../processes/gosi.repository.js';
import type { MedicalInsuranceRepository } from '../processes/medical-insurance.repository.js';
import type { CriminalRecordRepository } from '../processes/criminal-record.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type {
  ProcessStatus,
  GosiHoldReason,
  MedicalHoldReason,
  CriminalRecordStatus,
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
      gosi: GosiRepository;
      medical: MedicalInsuranceRepository;
      criminal: CriminalRecordRepository;
      audit: AuditLogRepository;
    },
  ) {}

  list() {
    return this.repos.employees.list();
  }

  async getDetails(id: string, actor: Actor) {
    const employee = await this.repos.employees.findWithDetails(id);
    if (!employee) throw new NotFoundError('employee', id);

    const processMachine = new Workflow(employeeProcessMachine('GOSI'), noopDeps());
    const criminalMachine = new Workflow(criminalRecordMachine(), noopDeps());

    return {
      ...employee,
      processActions: {
        gosi: employee.gosi ? processMachine.availableActions(employee.gosi.status, actor.type) : [],
        medical: employee.medical
          ? processMachine.availableActions(employee.medical.status, actor.type)
          : [],
        criminal: employee.criminalRecord
          ? criminalMachine.availableActions(employee.criminalRecord.status, actor.type)
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
function noopDeps() {
  return {
    getId: (r: ProcessRow) => r.id,
    getStatus: (r: ProcessRow) => r.status,
    move: () => Promise.resolve(false),
    audit: () => Promise.resolve({}),
  };
}
