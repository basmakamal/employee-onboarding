import type { AssetForm } from '../../generated/prisma/client.js';
import type { MachineDef } from '../engine.js';
import { GuardFailedError } from '../errors.js';

export interface AssetFormGates {
  /** Number of item lines on the form — an empty form cannot be sent. */
  countItems(formId: string): Promise<number>;
}

/** Stage 2 — Asset custody form lifecycle (BRD statuses, verbatim). */
export function assetFormMachine(gates: AssetFormGates): MachineDef<AssetForm> {
  return {
    key: 'ASSET_FORM',
    transitions: [
      // HR sends the custody form to the employee (signed link).
      {
        action: 'SEND',
        from: 'DRAFT',
        to: 'SENT',
        actors: ['USER'],
        guard: async ({ record }) => {
          if ((await gates.countItems(record.id)) === 0) {
            throw new GuardFailedError('FORM_EMPTY', 'the custody form has no asset lines');
          }
        },
      },

      // Employee opened the signed link — now formally awaiting their decision.
      { action: 'OPEN', from: 'SENT', to: 'PENDING_EMPLOYEE_APPROVAL', actors: ['LINK'] },

      // Employee decides electronically.
      {
        action: 'APPROVE',
        from: 'PENDING_EMPLOYEE_APPROVAL',
        to: 'APPROVED',
        actors: ['LINK'],
      },
      {
        action: 'REJECT',
        from: 'PENDING_EMPLOYEE_APPROVAL',
        to: 'REJECTED',
        actors: ['LINK'],
      },

      // HR may revise a rejected form and try again.
      { action: 'REVISE', from: 'REJECTED', to: 'DRAFT', actors: ['USER'] },

      // HR may cancel anything not yet decided.
      { action: 'CANCEL', from: 'DRAFT', to: 'CANCELLED', actors: ['USER'] },
      { action: 'CANCEL', from: 'SENT', to: 'CANCELLED', actors: ['USER'] },
      {
        action: 'CANCEL',
        from: 'PENDING_EMPLOYEE_APPROVAL',
        to: 'CANCELLED',
        actors: ['USER'],
      },
    ],
  };
}
