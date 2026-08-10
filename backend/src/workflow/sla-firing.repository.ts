import type { Db } from '../common/prisma.js';

/** The scheduler's memory: when did rule X last fire for record Y? */
export class SlaFiringRepository {
  constructor(private readonly db: Db) {}

  async lastFiring(ruleId: string, entityId: string): Promise<Date | null> {
    const row = await this.db.slaFiring.findFirst({
      where: { ruleId, entityId },
      orderBy: { firedAt: 'desc' },
      select: { firedAt: true },
    });
    return row?.firedAt ?? null;
  }

  record(ruleId: string, entityId: string, firedAt: Date) {
    return this.db.slaFiring.create({ data: { ruleId, entityId, firedAt } });
  }

  /** Reset the memory for one record — e.g. a renewed document must alert
   *  again on its next expiry cycle. */
  clearForEntity(entityId: string) {
    return this.db.slaFiring.deleteMany({ where: { entityId } });
  }
}
