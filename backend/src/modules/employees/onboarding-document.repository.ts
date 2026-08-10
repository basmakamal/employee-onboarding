import type { Db } from '../../common/prisma.js';

/** The onboarding checklist — one row per required/optional document. */
export class OnboardingDocumentRepository {
  constructor(private readonly db: Db) {}

  listByEmployee(employeeId: string) {
    return this.db.onboardingDocument.findMany({ where: { employeeId } });
  }

  attachUpload(
    id: string,
    file: { storageKey: string; mimeType: string; sizeBytes: number },
    uploadedAt: Date,
  ) {
    return this.db.onboardingDocument.update({
      where: { id },
      data: { ...file, uploadedAt },
    });
  }

  /** The gate for ACCEPT_DOCUMENTS / SEND_CONTRACT. */
  countMissingRequired(employeeId: string): Promise<number> {
    return this.db.onboardingDocument.count({
      where: { employeeId, required: true, storageKey: null },
    });
  }
}
