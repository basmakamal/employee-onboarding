import type { Trainee } from '../generated/prisma/client.js';
import type { TraineeStatus } from '../generated/prisma/enums.js';
import type { Workflow } from './engine.js';
import type { SlaWatcher, WatchedRecord } from './sla-scheduler.js';
import type { TraineeRepository } from '../modules/trainees/trainee.repository.js';
import type { OffboardingRepository } from '../modules/offboarding/offboarding.repository.js';
import type { GosiRepository } from '../modules/processes/gosi.repository.js';
import type { MedicalInsuranceRepository } from '../modules/processes/medical-insurance.repository.js';

const TRAINEE_SUBJECT_TEMPLATES: Record<string, string> = {
  AWAITING_FORM: 'trainee.form_reminder',
  AWAITING_CONTRACT_APPROVAL: 'trainee.contract_approval_reminder',
};

/** Stage 1 — trainees, with subject emails and EXPIRE support. */
export function traineeWatcher(
  trainees: TraineeRepository,
  workflow: Workflow<Trainee>,
): SlaWatcher {
  return {
    processKey: 'TRAINEE',
    async listInStatusSince(status, threshold): Promise<WatchedRecord[]> {
      const rows = await trainees.listInStatusSince(status as TraineeStatus, threshold);
      return rows.map((t) => ({
        id: t.id,
        name: `${t.firstName} ${t.lastName}`,
        email: t.email,
        anchorAt: t.statusChangedAt,
        traineeId: t.id,
      }));
    },
    subjectTemplate: (status) => TRAINEE_SUBJECT_TEMPLATES[status],
    async expire(record, ruleId) {
      const trainee = await trainees.findById(record.id);
      if (!trainee) return;
      await workflow.transition(trainee, 'EXPIRE', { type: 'SYSTEM' }, { rule: ruleId });
    },
  };
}

/** Stage 3 — offboardings stalled mid-flow (staff reminders only). */
export function offboardingWatcher(offboardings: OffboardingRepository): SlaWatcher {
  return {
    processKey: 'OFFBOARDING',
    async listInStatusSince(status, threshold): Promise<WatchedRecord[]> {
      const rows = await offboardings.listInStatusSince(status, threshold);
      return rows.map((o) => ({
        id: o.id,
        name: o.employee ? `${o.employee.firstName} ${o.employee.lastName}` : o.id,
        anchorAt: o.updatedAt,
        employeeId: o.employeeId,
      }));
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
    async listInStatusSince(status, threshold): Promise<WatchedRecord[]> {
      const rows = await repo.listInStatusSince(status, threshold);
      return rows.map((p) => ({
        id: p.id,
        name: p.employee ? `${p.employee.firstName} ${p.employee.lastName}` : p.id,
        anchorAt: p.updatedAt,
        employeeId: p.employeeId,
      }));
    },
  };
}
