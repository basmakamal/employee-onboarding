import type { Db } from '../../common/prisma.js';
import type { DocumentStatus } from '../../generated/prisma/enums.js';

export interface CreateDocumentData {
  employeeId: string;
  type: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export class DocumentRepository {
  constructor(private readonly db: Db) {}

  create(data: CreateDocumentData) {
    return this.db.document.create({ data });
  }

  listByEmployee(employeeId: string) {
    return this.db.document.findMany({
      where: { employeeId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  setStatus(id: string, status: DocumentStatus) {
    return this.db.document.update({ where: { id }, data: { status } });
  }
}
