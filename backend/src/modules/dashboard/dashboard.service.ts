import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Aggregations for the home dashboard: everyone sees where every record
 * stands per stage, plus the latest activity across the system.
 */
export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async summary() {
    const [trainees, employees, gosi, medical, criminal, assetForms, offboardings, recent] =
      await Promise.all([
        this.prisma.trainee.groupBy({ by: ['status'], _count: { _all: true } }),
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
            trainee: { select: { firstName: true, lastName: true } },
            employee: { select: { firstName: true, lastName: true, employeeNo: true } },
          },
        }),
      ]);

    const toMap = (rows: Array<{ status: string; _count: { _all: number } }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

    return {
      trainees: toMap(trainees as never),
      employees: toMap(employees as never),
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
          ? `${log.employee.firstName} ${log.employee.lastName} (${log.employee.employeeNo})`
          : log.trainee
            ? `${log.trainee.firstName} ${log.trainee.lastName}`
            : null,
      })),
    };
  }
}
