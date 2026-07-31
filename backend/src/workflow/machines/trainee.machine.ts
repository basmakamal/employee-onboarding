import type { Trainee } from '../../generated/prisma/client.js';
import type { MachineDef } from '../engine.js';
import { GuardFailedError } from '../errors.js';

/**
 * Async data the guards need — injected so the machine stays unit-testable.
 * Wired to TraineeDocumentRepository / ContractRepository in the services.
 */
export interface TraineeGates {
  /** Required checklist rows without an upload. */
  countMissingRequiredDocs(traineeId: string): Promise<number>;
  /** A contract row exists for this trainee. */
  hasContract(traineeId: string): Promise<boolean>;
  /** The contract was sent to the trainee (sentAt stamped). */
  contractWasSent(traineeId: string): Promise<boolean>;
}

/** Stage 1 — Trainee Management (BRD workflow diagram, README §1). */
export function traineeMachine(gates: TraineeGates): MachineDef<Trainee> {
  const documentsComplete = async (traineeId: string) => {
    const missing = await gates.countMissingRequiredDocs(traineeId);
    if (missing > 0) {
      throw new GuardFailedError(
        'DOCUMENTS_INCOMPLETE',
        `${missing} required document(s) are still missing`,
      );
    }
  };

  return {
    key: 'TRAINEE',
    transitions: [
      // HR sends the data-completion form (signed link goes out).
      { action: 'SEND_FORM', from: 'CREATED', to: 'AWAITING_FORM', actors: ['USER'] },

      // Trainee submits the form through the signed link.
      { action: 'SUBMIT_FORM', from: 'AWAITING_FORM', to: 'FORM_RECEIVED', actors: ['LINK'] },

      // HR review: incomplete → back to the trainee (BRD loop).
      {
        action: 'REQUEST_MISSING',
        from: 'FORM_RECEIVED',
        to: 'AWAITING_FORM',
        actors: ['USER'],
      },

      // HR review: complete → contract work begins.
      // BRD rule: "the contract cannot be created before data is complete".
      {
        action: 'ACCEPT_DOCUMENTS',
        from: 'FORM_RECEIVED',
        to: 'CONTRACT_CREATION',
        actors: ['USER'],
        guard: ({ record }) => documentsComplete(record.id),
      },

      // HR sends the contract for e-approval.
      // BRD rule: "the contract cannot be sent before all documents are complete".
      {
        action: 'SEND_CONTRACT',
        from: 'CONTRACT_CREATION',
        to: 'AWAITING_CONTRACT_APPROVAL',
        actors: ['USER'],
        guard: async ({ record }) => {
          await documentsComplete(record.id);
          if (!(await gates.hasContract(record.id))) {
            throw new GuardFailedError('CONTRACT_MISSING', 'no contract has been created yet');
          }
        },
      },

      // Trainee approves electronically → employee profile creation follows.
      {
        action: 'APPROVE_CONTRACT',
        from: 'AWAITING_CONTRACT_APPROVAL',
        to: 'EMPLOYEE_CREATED',
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
        actors: ['USER'],
      },
    ],
  };
}
