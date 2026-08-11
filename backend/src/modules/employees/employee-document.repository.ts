import type { Db } from '../../common/prisma.js';

export interface EmployeeDocumentInput {
  type: string;
  number?: string;
  expiryDate: Date;
  notes?: string;
}

/** Expiry-tracked documents (Iqama, passport, contract end date, …). */
export class EmployeeDocumentRepository {
  constructor(private readonly db: Db) {}

  listByEmployee(employeeId: string) {
    return this.db.employeeDocument.findMany({
      where: { employeeId },
      orderBy: { expiryDate: 'asc' },
    });
  }

  findById(id: string) {
    return this.db.employeeDocument.findUnique({ where: { id } });
  }

  create(employeeId: string, input: EmployeeDocumentInput) {
    return this.db.employeeDocument.create({ data: { employeeId, ...input } });
  }

  update(id: string, input: Partial<EmployeeDocumentInput>) {
    return this.db.employeeDocument.update({ where: { id }, data: input });
  }

  remove(id: string) {
    return this.db.employeeDocument.delete({ where: { id } });
  }

  /**
   * Documents due for an expiry alert: expiring within `withinDays` (or
   * expired up to 90 days ago), optionally filtered by type — active
   * employees only. The lower bound keeps the scan from re-reading every
   * long-expired document forever; three months of nagging is enough.
   */
  listExpiring(withinDays: number, type: string | undefined, now: Date, limit = 500) {
    const threshold = new Date(now);
    threshold.setUTCDate(threshold.getUTCDate() + withinDays);
    const floor = new Date(now);
    floor.setUTCDate(floor.getUTCDate() - 90);
    return this.db.employeeDocument.findMany({
      where: {
        expiryDate: { lte: threshold, gte: floor },
        ...(type && type !== 'ANY' ? { type } : {}),
        employee: { status: 'ACTIVE' },
      },
      include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
      orderBy: { expiryDate: 'asc' },
      take: limit,
    });
  }
}
