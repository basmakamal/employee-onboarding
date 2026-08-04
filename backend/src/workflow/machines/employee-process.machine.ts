import type { MachineDef } from '../engine.js';

interface ProcessLike {
  id: string;
  employeeId: string;
  status: string;
}

/**
 * Stage 2 — GOSI and Medical Insurance share one lifecycle
 * (Pending / Done / On Hold / Cancelled). Hold reasons are recorded by the
 * repository at move time; the machine only rules on legality.
 */
export function employeeProcessMachine(key: 'GOSI' | 'MEDICAL_INSURANCE'): MachineDef<ProcessLike> {
  return {
    key,
    transitions: [
      { action: 'COMPLETE', from: 'PENDING', to: 'DONE', actors: ['USER'], roles: ['INSURANCE'] },
      { action: 'HOLD', from: 'PENDING', to: 'ON_HOLD', actors: ['USER'], roles: ['INSURANCE'] },
      { action: 'RESUME', from: 'ON_HOLD', to: 'PENDING', actors: ['USER'], roles: ['INSURANCE'] },
      { action: 'COMPLETE', from: 'ON_HOLD', to: 'DONE', actors: ['USER'], roles: ['INSURANCE'] },
      { action: 'CANCEL', from: 'PENDING', to: 'CANCELLED', actors: ['USER'], roles: ['INSURANCE'] },
      { action: 'CANCEL', from: 'ON_HOLD', to: 'CANCELLED', actors: ['USER'], roles: ['INSURANCE'] },
    ],
  };
}

/** Stage 2 — Criminal Record Certificate: strictly forward (BRD). */
export function criminalRecordMachine(): MachineDef<ProcessLike> {
  return {
    key: 'CRIMINAL_RECORD',
    transitions: [
      { action: 'SEND_REQUEST', from: 'TRAINING', to: 'REQUEST_SENT', actors: ['USER'], roles: ['HR'] },
      { action: 'MARK_PENDING', from: 'REQUEST_SENT', to: 'PENDING', actors: ['USER'], roles: ['HR'] },
      // Certificate received & attached — repository stamps the storage key.
      { action: 'COMPLETE', from: 'PENDING', to: 'DONE', actors: ['USER'], roles: ['HR'] },
    ],
  };
}
