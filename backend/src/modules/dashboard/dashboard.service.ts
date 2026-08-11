import type { PrismaClient } from '../../generated/prisma/client.js';

/** Six GROUP BYs per view is real work — reuse the answer briefly. */
const CACHE_MS = 30_000;

/**
 * Aggregations for the home dashboard: everyone sees where every record
 * stands per stage, plus the latest activity across the system.
 */
export class DashboardService {
  private cache: { value: unknown; at: number } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  async summary() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const [byStatus, gosi, medical, criminal, assetForms, offboardings, recent] =
      await Promise.all([
        this.prisma.employee.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.gosiProcess.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.medicalInsuranceProcess.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.criminalRecordProcess.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.assetForm.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.offboarding.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.auditLog.findMany({
          orderBy: { at: 'desc' },
          take: 12,
          include: {
            employee: { select: { firstName: true, lastName: true, employeeNo: true } },
          },
        }),
      ]);

    const toMap = (rows: Array<{ status: string; _count: { _all: number } }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

    // One lifecycle, two views: the onboarding pipeline vs. employment.
    const all = toMap(byStatus as never);
    const employees: Record<string, number> = {};
    const onboarding: Record<string, number> = {};
    for (const [status, count] of Object.entries(all)) {
      if (status === 'ACTIVE' || status === 'INACTIVE') employees[status] = count;
      else onboarding[status] = count;
    }

    const value = {
      onboarding,
      employees,
      processes: {
        gosi: toMap(gosi as never),
        medical: toMap(medical as never),
        criminal: toMap(criminal as never),
      },
      assetForms: toMap(assetForms as never),
      offboardings: toMap(offboardings as never),
      recent: recent.map((log) => ({
        id: log.id,
        entity: log.entity,
        action: log.action,
        toStatus: log.toStatus,
        actorType: log.actorType,
        at: log.at,
        subject: log.employee
          ? `${log.employee.firstName} ${log.employee.lastName}${log.employee.employeeNo ? ` (${log.employee.employeeNo})` : ''}`
          : null,
      })),
    };
    this.cache = { value, at: Date.now() };
    return value;
  }
}
