import type { Offboarding } from '../../generated/prisma/client.js';
import type { MachineDef } from '../engine.js';
import { GuardFailedError } from '../errors.js';

export interface OffboardingGates {
  /** Approved custody items not yet returned by the employee. */
  countUnreturnedAssets(employeeId: string): Promise<number>;
}

/** Stage 3 — Offboarding (BRD workflow diagram, README §1). */
export function offboardingMachine(gates: OffboardingGates): MachineDef<Offboarding> {
  return {
    key: 'OFFBOARDING',
    transitions: [
      // HR starts executing termination procedures. For resignations the
      // exit-interview link is auto-sent at this step (service side-effect).
      { action: 'START', from: 'REQUESTED', to: 'IN_PROGRESS', actors: ['USER'], roles: ['HR'] },

      // Procedures done — move to the asset-return checkpoint.
      { action: 'TO_ASSET_RETURN', from: 'IN_PROGRESS', to: 'ASSETS_PENDING', actors: ['USER'], roles: ['HR'] },

      // BRD hard gate: HR confirms ALL registered custody items are returned
      // before the termination can be approved.
      {
        action: 'CONFIRM_ASSETS_RETURNED',
        from: 'ASSETS_PENDING',
        to: 'NOTICE_SENT',
        actors: ['USER'], roles: ['HR'],
        guard: async ({ record }) => {
          const unreturned = await gates.countUnreturnedAssets(record.employeeId);
          if (unreturned > 0) {
            throw new GuardFailedError(
              'ASSETS_UNRETURNED',
              `${unreturned} custody item(s) have not been returned`,
            );
          }
        },
      },

      // Termination notice delivered → settlement stage.
      { action: 'TO_SETTLEMENT', from: 'NOTICE_SENT', to: 'SETTLEMENT', actors: ['USER'], roles: ['HR'] },

      // Settlement approved and entitlements paid → employee Inactive,
      // file closed (employee flip is a service side-effect in Phase E).
      {
        action: 'CLOSE',
        from: 'SETTLEMENT',
        to: 'CLOSED',
        actors: ['USER'],
        roles: ['FINANCE'],
        guard: ({ record }) => {
          if (
            record.settlementEntitlements === null ||
            record.settlementWorkingDays === null ||
            record.settlementLeaveDays === null
          ) {
            throw new GuardFailedError(
              'SETTLEMENT_INCOMPLETE',
              'final settlement amounts have not been entered',
            );
          }
        },
      },

      // Cancellation is possible until the notice goes out.
      { action: 'CANCEL', from: 'REQUESTED', to: 'CANCELLED', actors: ['USER'], roles: ['HR'] },
      { action: 'CANCEL', from: 'IN_PROGRESS', to: 'CANCELLED', actors: ['USER'], roles: ['HR'] },
      { action: 'CANCEL', from: 'ASSETS_PENDING', to: 'CANCELLED', actors: ['USER'], roles: ['HR'] },
    ],
  };
}
