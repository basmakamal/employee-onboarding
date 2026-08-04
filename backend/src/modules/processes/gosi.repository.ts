import type { Db } from '../../common/prisma.js';
import type { ProcessStatus, GosiHoldReason } from '../../generated/prisma/enums.js';

export class GosiRepository {
  constructor(private readonly db: Db) {}

  findByEmployee(employeeId: string) {
    return this.db.gosiProcess.findUnique({ where: { employeeId } });
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
