import type { Db } from '../../common/prisma.js';

export class TraineeDocumentRepository {
  constructor(private readonly db: Db) {}

  listByTrainee(traineeId: string) {
    return this.db.traineeDocument.findMany({ where: { traineeId } });
  }

  /** Attach an uploaded file to its checklist row. */
  attachUpload(
    id: string,
    file: { storageKey: string; mimeType: string; sizeBytes: number },
    uploadedAt: Date,
  ) {
    return this.db.traineeDocument.update({
      where: { id },
      data: { ...file, uploadedAt },
    });
  }

  addRequirement(traineeId: string, type: string, required: boolean, label?: string) {
    return this.db.traineeDocument.create({
      data: { traineeId, type, required, label: label ?? null },
    });
  }

  /** Gate for contract creation/sending: required rows without an upload. */
  countMissingRequired(traineeId: string): Promise<number> {
    return this.db.traineeDocument.count({
      where: { traineeId, required: true, storageKey: null },
    });
  }
}
