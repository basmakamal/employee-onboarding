import type { Db } from '../../common/prisma.js';

export interface ListValueInput {
  list: string;
  code: string;
  labelAr: string;
  labelEn: string;
  sortOrder?: number;
  active?: boolean;
  system?: boolean;
}

/** The dropdown values, one table for every list. */
export class ListValueRepository {
  constructor(private readonly db: Db) {}

  listAll() {
    return this.db.listValue.findMany({ orderBy: [{ list: 'asc' }, { sortOrder: 'asc' }, { labelEn: 'asc' }] });
  }

  listByKey(list: string, activeOnly = false) {
    return this.db.listValue.findMany({
      where: { list, ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { labelEn: 'asc' }],
    });
  }

  find(list: string, code: string) {
    return this.db.listValue.findUnique({ where: { list_code: { list, code } } });
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

  /** The largest sortOrder in a list, so a new value lands at the end. */
  async lastSortOrder(list: string): Promise<number> {
    const row = await this.db.listValue.findFirst({ where: { list }, orderBy: { sortOrder: 'desc' } });
    return row?.sortOrder ?? -1;
  }

  /** Values already typed on employee records — the free lists start from these. */
  async distinctEmployeeValues(): Promise<{ departments: string[]; jobTitles: string[]; projects: string[] }> {
    const [departments, jobTitles, projects] = await Promise.all([
      this.db.employee.groupBy({ by: ['department'], where: { department: { not: null } } }),
      this.db.employee.groupBy({ by: ['jobTitle'], where: { jobTitle: { not: null } } }),
      this.db.employee.groupBy({ by: ['project'], where: { project: { not: null } } }),
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
