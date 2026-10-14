import type { Db } from '../../common/prisma.js';

/** Asset registry — one per company; serial numbers unique inside a company. */
export class AssetRepository {
  constructor(private readonly db: Db) {}

  create(data: { companyId: string; type: string; name: string; serialNumber?: string; notes?: string }) {
    return this.db.asset.create({ data });
  }

  /** Serial numbers are unique per company (the registry scope arrives in Phase 6). */
  findBySerial(serialNumber: string, companyId?: string) {
    return this.db.asset.findFirst({
      where: { serialNumber, ...(companyId ? { companyId } : {}) },
    });
  }

  /** The registry of one company. */
  list(companyId: string) {
    return this.db.asset.findMany({ where: { companyId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }
}
