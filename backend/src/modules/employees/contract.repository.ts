import type { Db } from '../../common/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

export class ContractRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    createdById: string;
    storageKey?: string;
    details?: Prisma.InputJsonValue;
  }) {
    return this.db.contract.create({ data });
  }

  findByEmployee(employeeId: string) {
    return this.db.contract.findUnique({ where: { employeeId } });
  }

  markSent(id: string, sentAt: Date) {
    return this.db.contract.update({ where: { id }, data: { sentAt } });
  }

  updateDetails(id: string, details: Prisma.InputJsonValue) {
    return this.db.contract.update({ where: { id }, data: { details } });
  }

  /** Guarded on approvedAt IS NULL — a duplicate approval cannot re-stamp. */
  async markApproved(id: string, approvedAt: Date): Promise<boolean> {
    const result = await this.db.contract.updateMany({
      where: { id, approvedAt: null },
      data: { approvedAt },
    });
    return result.count === 1;
  }
}
