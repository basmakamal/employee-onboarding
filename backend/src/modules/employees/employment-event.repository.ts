import type { Db } from '../../common/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';

/** One history row as it is written. */
export interface EmploymentEventRow {
  companyId: string;
  employeeId: string;
  category: string;
  oldValue?: Prisma.InputJsonValue | undefined;
  newValue?: Prisma.InputJsonValue | undefined;
  effectiveDate: Date;
  status: 'SCHEDULED' | 'APPLIED';
  appliedAt?: Date | null;
  batchId: string;
  reason?: string | null;
  createdById?: string | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
}

const WHO = { select: { id: true, name: true } } as const;

/** Employment history rows — written once; only their status moves. */
export class EmploymentEventRepository {
  constructor(private readonly db: Db) {}

  createMany(rows: EmploymentEventRow[]) {
    if (rows.length === 0) return Promise.resolve({ count: 0 });
    // Optional keys left undefined are dropped; an absent snapshot is stored as NULL.
    const data = rows.map(({ oldValue, newValue, ...rest }) => ({
      ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
      oldValue: oldValue ?? Prisma.DbNull,
      newValue: newValue ?? Prisma.DbNull,
    })) as Prisma.EmploymentEventCreateManyInput[];
    return this.db.employmentEvent.createMany({ data });
  }

  countForEmployee(employeeId: string) {
    return this.db.employmentEvent.count({ where: { employeeId } });
  }

  /** One employee's history, newest effective date first. */
  listForEmployee(employeeId: string) {
    return this.db.employmentEvent.findMany({
      where: { employeeId },
      include: { createdBy: WHO, approvedBy: WHO },
      orderBy: [{ effectiveDate: 'desc' }, { recordedAt: 'desc' }],
    });
  }

  /** A company's changes — the Transfers & promotions page. */
  listCompany(where: Prisma.EmploymentEventWhereInput, take: number) {
    return this.db.employmentEvent.findMany({
      where: { ...where, category: { notIn: ['OPENING', 'STATUS'] } },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } },
        createdBy: WHO,
        approvedBy: WHO,
      },
      orderBy: [{ effectiveDate: 'desc' }, { recordedAt: 'desc' }],
      take,
    });
  }

  batch(batchId: string) {
    return this.db.employmentEvent.findMany({ where: { batchId }, orderBy: { category: 'asc' } });
  }

  /** Guarded status move for a whole change; the count says whether this caller won. */
  async moveBatch(
    batchId: string,
    from: string,
    data: Prisma.EmploymentEventUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await this.db.employmentEvent.updateMany({ where: { batchId, status: from }, data });
    return count > 0;
  }

  updateOldValue(id: string, oldValue: Prisma.InputJsonValue | undefined) {
    return this.db.employmentEvent.update({ where: { id }, data: { oldValue: oldValue ?? Prisma.DbNull } });
  }

  /** Scheduled changes whose date has (possibly) arrived — filtered per company time zone by the caller. */
  dueScheduled(upTo: Date) {
    return this.db.employmentEvent.findMany({
      where: { status: 'SCHEDULED', effectiveDate: { lte: upTo } },
      orderBy: [{ effectiveDate: 'asc' }, { recordedAt: 'asc' }],
      take: 500,
    });
  }

  /** Employees placed in a company that have no history yet — they get their opening entry. */
  employeesWithoutHistory(take: number) {
    return this.db.employee.findMany({
      where: { companyId: { not: null }, employmentEvents: { none: {} } },
      take,
    });
  }
}
