import type { Db } from '../../common/prisma.js';
import type { ProcessStatus, GosiHoldReason } from '../../generated/prisma/enums.js';

export class GosiRepository {
  constructor(private readonly db: Db) {}

  findByEmployee(employeeId: string) {
    return this.db.gosiProcess.findUnique({ where: { employeeId } });
  }

  /** SLA scan input: cards sitting in `status` since before `threshold`. */
  listInStatusSince(status: string, threshold: Date, limit = 500) {
    return this.db.gosiProcess.findMany({
      where: { status: status as ProcessStatus, updatedAt: { lt: threshold } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
  }

  /** Guarded status move; hold reason/note only meaningful for ON_HOLD. */
  async moveStatus(
    id: string,
    from: ProcessStatus,
    to: ProcessStatus,
    hold?: { reason: GosiHoldReason; note?: string },
  ): Promise<boolean> {
    const result = await this.db.gosiProcess.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        holdReason: to === 'ON_HOLD' ? (hold?.reason ?? 'OTHER') : null,
        holdNote: to === 'ON_HOLD' ? (hold?.note ?? null) : null,
      },
    });
    return result.count === 1;
  }
}
