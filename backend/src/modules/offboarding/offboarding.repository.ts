import type { Db } from '../../common/prisma.js';
import type { EmployeeScope } from '../../auth/authz/authorize.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { OffboardingReason, OffboardingStatus } from '../../generated/prisma/enums.js';
import { viaEmployeeCompanyWhere, type CompanyFilter } from '../../workflow/company-filter.js';

export class OffboardingRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    reason: OffboardingReason;
    requestedById: string;
    notes?: string;
  }) {
    return this.db.offboarding.create({ data });
  }

  /** With a scope, an offboarding whose employee sits outside it is simply not found. */
  findById(id: string, scope?: EmployeeScope) {
    return scope
      ? this.db.offboarding.findFirst({ where: { id, employee: scope } })
      : this.db.offboarding.findUnique({ where: { id } });
  }

  /** An employee may have at most one offboarding that is not closed/cancelled. */
  findOpenByEmployee(employeeId: string) {
    return this.db.offboarding.findFirst({
      where: { employeeId, status: { notIn: ['CLOSED', 'CANCELLED'] } },
    });
  }

  /** SLA scan input: records sitting in `status` since before `threshold`. */
  listInStatusSince(status: string, threshold: Date, limit = 500, company?: CompanyFilter) {
    return this.db.offboarding.findMany({
      where: { status: status as OffboardingStatus, updatedAt: { lt: threshold }, ...viaEmployeeCompanyWhere(company) },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
  }

  /** Guarded lifecycle move; `stamp` writes the step's timestamp fields. */
  async moveStatus(
    id: string,
    from: OffboardingStatus,
    to: OffboardingStatus,
    stamp?: Prisma.OffboardingUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.db.offboarding.updateMany({
      where: { id, status: from },
      data: { status: to, ...stamp },
    });
    return result.count === 1;
  }

  recordExitInterview(id: string, data: Prisma.InputJsonValue, completedAt: Date) {
    return this.db.offboarding.update({
      where: { id },
      data: { exitInterviewData: data, exitInterviewCompletedAt: completedAt },
    });
  }

  recordSettlement(
    id: string,
    settlement: {
      settlementWorkingDays: number;
      settlementLeaveDays: number;
      settlementDeductions: number;
      settlementEntitlements: number;
      settlementNotes?: string;
    },
  ) {
    return this.db.offboarding.update({ where: { id }, data: settlement });
  }
}
