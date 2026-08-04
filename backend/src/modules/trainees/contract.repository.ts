import type { Db } from '../../common/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

export class ContractRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    traineeId: string;
    createdById: string;
    storageKey?: string;
    details?: Prisma.InputJsonValue;
  }) {
    return this.db.contract.create({ data });
  }

  findByTrainee(traineeId: string) {
    return this.db.contract.findUnique({ where: { traineeId } });
  }

  markSent(id: string, sentAt: Date) {
    return this.db.contract.update({ where: { id }, data: { sentAt } });
  }

  updateDetails(id: string, details: Prisma.InputJsonValue) {
    return this.db.contract.update({ where: { id }, data: { details } });
  }

  /** Guarded on unapproved so a duplicate approval click cannot re-stamp it. */
  async markApproved(id: string, approvedAt: Date): Promise<boolean> {
    const result = await this.db.contract.updateMany({
      where: { id, approvedAt: null },
      data: { approvedAt },
    });
    return result.count === 1;
  }
}
