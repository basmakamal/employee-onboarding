import type { Db } from '../../common/prisma.js';

export interface ListValueInput {
  companyId: string;
  list: string;
  code: string;
  labelAr: string;
  labelEn: string;
  sortOrder?: number;
  active?: boolean;
  system?: boolean;
}

/** The dropdown values, one table for every list. Every row belongs to one company. */
export class ListValueRepository {
  constructor(private readonly db: Db) {}

  /** Every company id — boot seeding gives each one the full catalogue. */
  async companyIds(): Promise<string[]> {
    const rows = await this.db.company.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** The oldest company — the fallback for a legacy record that has no company yet. */
  async firstCompanyId(): Promise<string | null> {
    const row = await this.db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return row?.id ?? null;
  }

  listAll(companyId: string) {
    return this.db.listValue.findMany({
      where: { companyId },
      orderBy: [{ list: 'asc' }, { sortOrder: 'asc' }, { labelEn: 'asc' }],
    });
  }

  find(companyId: string, list: string, code: string) {
    return this.db.listValue.findUnique({ where: { companyId_list_code: { companyId, list, code } } });
  }

  findById(id: string) {
    return this.db.listValue.findUnique({ where: { id } });
  }

  create(data: ListValueInput) {
    return this.db.listValue.create({ data });
  }

  update(id: string, data: Partial<Pick<ListValueInput, 'labelAr' | 'labelEn' | 'sortOrder' | 'active'>>) {
    return this.db.listValue.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.db.listValue.delete({ where: { id } });
  }

  /** The largest sortOrder in a company's list, so a new value lands at the end. */
  async lastSortOrder(companyId: string, list: string): Promise<number> {
    const row = await this.db.listValue.findFirst({ where: { companyId, list }, orderBy: { sortOrder: 'desc' } });
    return row?.sortOrder ?? -1;
  }

  /** Values already typed on this company's employee records — the free lists start from these. */
  async distinctEmployeeValues(companyId: string): Promise<{ departments: string[]; jobTitles: string[]; projects: string[] }> {
    const [departments, jobTitles, projects] = await Promise.all([
      this.db.employee.groupBy({ by: ['department'], where: { companyId, department: { not: null } } }),
      this.db.employee.groupBy({ by: ['jobTitle'], where: { companyId, jobTitle: { not: null } } }),
      this.db.employee.groupBy({ by: ['project'], where: { companyId, project: { not: null } } }),
    ]);
    const clean = (values: Array<string | null>) =>
      [...new Set(values.filter((x): x is string => !!x?.trim()).map((x) => x.trim()))];
    return {
      departments: clean(departments.map((d) => d.department)),
      jobTitles: clean(jobTitles.map((j) => j.jobTitle)),
      projects: clean(projects.map((p) => p.project)),
    };
  }
}
