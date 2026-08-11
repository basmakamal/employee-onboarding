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

  /**
   * Batch variant for the tick loop: the latest firing per candidate in ONE
   * GROUP BY, instead of one query per candidate per rule per tick.
   */
  async lastFirings(ruleId: string, entityIds: string[]): Promise<Map<string, Date>> {
    if (entityIds.length === 0) return new Map();
    const rows = await this.db.slaFiring.groupBy({
      by: ['entityId'],
      where: { ruleId, entityId: { in: entityIds } },
      _max: { firedAt: true },
    });
    return new Map(
      rows.flatMap((r) => (r._max.firedAt ? [[r.entityId, r._max.firedAt] as const] : [])),
    );
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
