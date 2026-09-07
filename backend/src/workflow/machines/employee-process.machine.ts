import type { MachineDef } from '../engine.js';

interface ProcessLike {
  id: string;
  employeeId: string;
  status: string;
}

/**
 * Who may act on the Stage-2 cards by default. Business rule: the named
 * primary owners (see ResponsibilityService) are for notifications and
 * follow-up only — any authorised teammate must be able to complete a step
 * when the owner is away, so both HR and the insurance group can act.
 * Admins can narrow or widen this per status in Status Ownership.
 */
const STAGE2_ROLES = ['HR', 'INSURANCE'];

/**
 * Stage 2 — GOSI and Medical Insurance share one lifecycle
 * (Pending / Done / On Hold / Cancelled). Hold reasons are recorded by the
 * repository at move time; the machine only rules on legality.
 */
export function employeeProcessMachine(key: 'GOSI' | 'MEDICAL_INSURANCE'): MachineDef<ProcessLike> {
  return {
    key,
    transitions: [
      { action: 'COMPLETE', from: 'PENDING', to: 'DONE', actors: ['USER'], roles: STAGE2_ROLES },
      { action: 'HOLD', from: 'PENDING', to: 'ON_HOLD', actors: ['USER'], roles: STAGE2_ROLES },
      { action: 'RESUME', from: 'ON_HOLD', to: 'PENDING', actors: ['USER'], roles: STAGE2_ROLES },
      { action: 'COMPLETE', from: 'ON_HOLD', to: 'DONE', actors: ['USER'], roles: STAGE2_ROLES },
      { action: 'CANCEL', from: 'PENDING', to: 'CANCELLED', actors: ['USER'], roles: STAGE2_ROLES },
      { action: 'CANCEL', from: 'ON_HOLD', to: 'CANCELLED', actors: ['USER'], roles: STAGE2_ROLES },
    ],
  };
}

/** Stage 2 — Criminal Record Certificate: strictly forward (BRD). */
export function criminalRecordMachine(): MachineDef<ProcessLike> {
  return {
    key: 'CRIMINAL_RECORD',
    transitions: [
      { action: 'SEND_REQUEST', from: 'TRAINING', to: 'REQUEST_SENT', actors: ['USER'], roles: STAGE2_ROLES },
      { action: 'MARK_PENDING', from: 'REQUEST_SENT', to: 'PENDING', actors: ['USER'], roles: STAGE2_ROLES },
      // Certificate received & attached — repository stamps the storage key.
      { action: 'COMPLETE', from: 'PENDING', to: 'DONE', actors: ['USER'], roles: STAGE2_ROLES },
    ],
  };
}
