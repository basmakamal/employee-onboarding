import type { Db } from '../../common/prisma.js';

/** Company asset registry (unique serial numbers). */
export class AssetRepository {
  constructor(private readonly db: Db) {}

  create(data: { type: string; name: string; serialNumber?: string; notes?: string }) {
    return this.db.asset.create({ data });
  }

  findBySerial(serialNumber: string) {
    return this.db.asset.findUnique({ where: { serialNumber } });
  }

  list() {
    return this.db.asset.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }
}
