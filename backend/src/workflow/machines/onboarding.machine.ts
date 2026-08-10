import type { Employee } from '../../generated/prisma/client.js';
import type { MachineDef } from '../engine.js';
import { GuardFailedError } from '../errors.js';

/**
 * Async data the guards need — injected so the machine stays unit-testable.
 * Wired to OnboardingDocumentRepository / ContractRepository in the services.
 */
export interface OnboardingGates {
  /** Required checklist rows without an upload. */
  countMissingRequiredDocs(employeeId: string): Promise<number>;
  /** A contract row exists for this employee. */
  hasContract(employeeId: string): Promise<boolean>;
  /** The contract was sent to the new hire (sentAt stamped). */
  contractWasSent(employeeId: string): Promise<boolean>;
}

/**
 * The employee onboarding pipeline (BRD stage 1) — the front half of the
 * single employee lifecycle. Contract approval activates the employee;
 * ACTIVE → INACTIVE is flipped by offboarding closure, outside this machine.
 */
export function onboardingMachine(gates: OnboardingGates): MachineDef<Employee> {
  const documentsComplete = async (employeeId: string) => {
    const missing = await gates.countMissingRequiredDocs(employeeId);
    if (missing > 0) {
      throw new GuardFailedError(
        'DOCUMENTS_INCOMPLETE',
        `${missing} required document(s) are still missing`,
      );
    }
  };

  return {
    key: 'EMPLOYEE',
    transitions: [
      // HR sends the data-completion form (signed link goes out).
      { action: 'SEND_FORM', from: 'CREATED', to: 'AWAITING_FORM', actors: ['USER'], roles: ['HR'] },

      // The new hire submits the form through the signed link.
      { action: 'SUBMIT_FORM', from: 'AWAITING_FORM', to: 'FORM_RECEIVED', actors: ['LINK'] },

      // HR review: incomplete → back to the new hire (BRD loop).
      {
        action: 'REQUEST_MISSING',
        from: 'FORM_RECEIVED',
        to: 'AWAITING_FORM',
        actors: ['USER'], roles: ['HR'],
      },

      // HR review: complete → contract work begins.
      // BRD rule: "the contract cannot be created before data is complete".
      {
        action: 'ACCEPT_DOCUMENTS',
        from: 'FORM_RECEIVED',
        to: 'CONTRACT_CREATION',
        actors: ['USER'], roles: ['HR'],
        guard: ({ record }) => documentsComplete(record.id),
      },

      // HR sends the contract for e-approval.
      // BRD rule: "the contract cannot be sent before all documents are complete".
      {
        action: 'SEND_CONTRACT',
        from: 'CONTRACT_CREATION',
        to: 'AWAITING_CONTRACT_APPROVAL',
        actors: ['USER'], roles: ['HR'],
        guard: async ({ record }) => {
          await documentsComplete(record.id);
          if (!(await gates.hasContract(record.id))) {
            throw new GuardFailedError('CONTRACT_MISSING', 'no contract has been created yet');
          }
        },
      },

      // E-approval through the signed link activates the employee —
      // the service then allocates the employee number and opens the
      // Stage-2 process tracks.
      {
        action: 'APPROVE_CONTRACT',
        from: 'AWAITING_CONTRACT_APPROVAL',
        to: 'ACTIVE',
        actors: ['LINK'],
      },

      // SLA engine: deadlines expire the two waiting states (BRD table).
      { action: 'EXPIRE', from: 'AWAITING_FORM', to: 'EXPIRED', actors: ['SYSTEM'] },
      {
        action: 'EXPIRE',
        from: 'AWAITING_CONTRACT_APPROVAL',
        to: 'EXPIRED',
        actors: ['SYSTEM'],
      },

      // BRD: "if HR reopens the request, it returns to the last completed
      // stage and the process resumes" — target depends on how far it got.
      {
        action: 'REOPEN',
        from: 'EXPIRED',
        to: async ({ record }) =>
          (await gates.contractWasSent(record.id))
            ? 'AWAITING_CONTRACT_APPROVAL'
            : 'AWAITING_FORM',
        actors: ['USER'], roles: ['HR'],
      },
    ],
  };
}
