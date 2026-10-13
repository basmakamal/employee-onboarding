import type { Db } from '../common/prisma.js';

/** What a session and the company switcher need to know about a company. */
export const COMPANY_PUBLIC_SELECT = { id: true, code: true, nameAr: true, nameEn: true, active: true } as const;

/** Companies plus the two lookups the session needs (which companies exist, where a unit sits). */
export class CompanyRepository {
  constructor(private readonly db: Db) {}

  listActive() {
    return this.db.company.findMany({
      where: { active: true },
      select: COMPANY_PUBLIC_SELECT,
      orderBy: { nameEn: 'asc' },
    });
  }

  listActiveByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.company.findMany({
      where: { id: { in: ids }, active: true },
      select: COMPANY_PUBLIC_SELECT,
      orderBy: { nameEn: 'asc' },
    });
  }

  findById(id: string) {
    return this.db.company.findUnique({ where: { id }, select: COMPANY_PUBLIC_SELECT });
  }

  /** Materialised paths of org units — turns unit assignments into scope prefixes. */
  async unitPaths(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const rows = await this.db.orgUnit.findMany({ where: { id: { in: ids } }, select: { id: true, path: true } });
    return Object.fromEntries(rows.map((r) => [r.id, r.path]));
  }
}
