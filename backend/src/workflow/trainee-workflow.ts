import type { Trainee } from '../generated/prisma/client.js';
import { Workflow } from './engine.js';
import { traineeMachine } from './machines/trainee.machine.js';
import type { TraineeRepository } from '../modules/trainees/trainee.repository.js';
import type { TraineeDocumentRepository } from '../modules/trainees/trainee-document.repository.js';
import type { ContractRepository } from '../modules/trainees/contract.repository.js';
import type { AuditLogRepository } from './audit-log.repository.js';
import type { TraineeStatus } from '../generated/prisma/enums.js';

/**
 * Composition: the Stage-1 machine wired to real repositories.
 * Both the API services (Phase E) and the SLA scheduler drive transitions
 * through this single instance — one door, always guarded, always audited.
 */
export function buildTraineeWorkflow(
  repos: {
    trainees: TraineeRepository;
    documents: TraineeDocumentRepository;
    contracts: ContractRepository;
    audit: AuditLogRepository;
  },
  ownership?: import('./engine.js').OwnershipLookup,
): Workflow<Trainee> {
  const machine = traineeMachine({
    countMissingRequiredDocs: (traineeId) => repos.documents.countMissingRequired(traineeId),
    hasContract: async (traineeId) => (await repos.contracts.findByTrainee(traineeId)) !== null,
    contractWasSent: async (traineeId) =>
      (await repos.contracts.findByTrainee(traineeId))?.sentAt != null,
  });

  return new Workflow<Trainee>(machine, {
    getId: (t) => t.id,
    getStatus: (t) => t.status,
    ...(ownership ? { ownership } : {}),
    move: (t, from, to) => repos.trainees.moveStatus(t.id, from as TraineeStatus, to as TraineeStatus),
    audit: (entry) => repos.audit.append(entry),
    anchors: (t) => ({ traineeId: t.id }),
  });
}
