import type { Db } from '../../common/prisma.js';
import type { EmployeeRequestType } from '../../generated/prisma/enums.js';

/** The stored file behind a request — one per request. */
export interface RequestDocument {
  storageKey: string;
  fileName: string;
  mimeType: string;
}

/** HR services log (salary letter, promotion, warning…) — see schema. */
export class EmployeeRequestRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    type: EmployeeRequestType;
    notes?: string;
    createdById: string;
    document?: RequestDocument;
  }) {
    const { document, ...rest } = data;
    return this.db.employeeRequest.create({
      data: { ...rest, ...(document ?? {}) },
      include: { createdBy: { select: { name: true } } },
    });
  }

  findById(id: string) {
    return this.db.employeeRequest.findUnique({ where: { id } });
  }

  /** Attach or replace the request's document; the caller disposes of the old file. */
  setDocument(id: string, document: RequestDocument) {
    return this.db.employeeRequest.update({
      where: { id },
      data: document,
      include: { createdBy: { select: { name: true } } },
    });
  }
}
