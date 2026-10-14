import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { auditScope, viaEmployee, withScope, type EmployeeScope } from '../../auth/authz/authorize.js';

/** Six GROUP BYs per view is real work — reuse the answer briefly. */
const CACHE_MS = 30_000;
/** A pipeline record sitting still this long is "stalled". */
const STALL_DAYS = 3;
/** Documents expiring within this window are flagged. */
const EXPIRY_WINDOW_DAYS = 30;
/** Trend charts look back this many weeks. */
const TREND_WEEKS = 8;

const PIPELINE = ['CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL'] as const;

export interface AttentionItem {
  kind: 'stalled' | 'expiring' | 'custody';
  employeeId: string;
  name: string;
  /** Status the record is stuck in (stalled/custody) or the document type (expiring). */
  status: string;
  /** Days waiting (stalled/custody) or days left, negative when already past (expiring). */
  days: number;
  /** Where the action lives. */
  to: string;
}

const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

/**
 * Aggregations for the home dashboard: what needs attention today, the
 * numbers with an 8-week trend, where every record stands per stage, and the
 * latest activity across the system.
 */
export class DashboardService {
  /** Keyed by scope: company A's numbers must never be replayed to company B. */
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Everything is limited to `scope` — the actor's company (and, for a
   * branch / department manager, their subtree). No scope = the whole
   * database, which only internal callers without a company ever get.
   */
  async summary(scope?: EmployeeScope, now: Date = new Date()) {
    const key = JSON.stringify(scope ?? null);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const emp = (where: Prisma.EmployeeWhereInput) => withScope(where, scope);
    const child = viaEmployee(scope);

    const stallBefore = new Date(now.getTime() - STALL_DAYS * 86_400_000);
    const expiryUntil = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000);
    const trendStart = new Date(now.getTime() - TREND_WEEKS * 7 * 86_400_000);

    const soon = new Date(now.getTime() + 30 * 86_400_000);
    const [upcomingChanges, withoutLogin] = await Promise.all([
      this.prisma.employmentEvent.findMany({
        where: { status: 'SCHEDULED', effectiveDate: { lte: soon }, employee: emp({}), category: { in: ['ORG_UNIT', 'POSITION', 'MANAGER'] } },
        orderBy: { effectiveDate: 'asc' },
        take: 6,
        select: { batchId: true, category: true, effectiveDate: true, employee: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.employee.count({ where: emp({ status: 'ACTIVE', account: null }) }),
    ]);

    const [
      byStatus, gosi, medical, criminal, assetForms, offboardings, recent, stalled, expiring, custody, hires, intakes,
      joiners,
    ] =
      await Promise.all([
        this.prisma.employee.groupBy({ by: ['status'], where: emp({}), _count: { _all: true } }),
        this.prisma.gosiProcess.groupBy({ by: ['status'], where: child, _count: { _all: true } }),
        this.prisma.medicalInsuranceProcess.groupBy({ by: ['status'], where: child, _count: { _all: true } }),
        this.prisma.criminalRecordProcess.groupBy({ by: ['status'], where: child, _count: { _all: true } }),
        this.prisma.assetForm.groupBy({ by: ['status'], where: child, _count: { _all: true } }),
        this.prisma.offboarding.groupBy({ by: ['status'], where: child, _count: { _all: true } }),
        this.prisma.auditLog.findMany({
          where: auditScope(scope),
          orderBy: { at: 'desc' },
          take: 12,
          include: {
            employee: { select: { firstName: true, lastName: true, employeeNo: true } },
            actor: { select: { name: true } },
          },
        }),
        // Pipeline records that have not moved for STALL_DAYS.
        this.prisma.employee.findMany({
          where: emp({ status: { in: [...PIPELINE] }, statusChangedAt: { lt: stallBefore } }),
          orderBy: { statusChangedAt: 'asc' },
          take: 10,
          select: { id: true, firstName: true, lastName: true, status: true, statusChangedAt: true },
        }),
        // Documents expiring soon (or already expired) on active staff.
        this.prisma.employeeDocument.findMany({
          where: { expiryDate: { lte: expiryUntil }, employee: emp({ status: 'ACTIVE' }) },
          orderBy: { expiryDate: 'asc' },
          take: 10,
          select: {
            type: true,
            expiryDate: true,
            employee: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        // Custody forms the employee has not answered.
        this.prisma.assetForm.findMany({
          where: { status: { in: ['SENT', 'PENDING_EMPLOYEE_APPROVAL'] }, sentAt: { lt: stallBefore }, ...child },
          orderBy: { sentAt: 'asc' },
          take: 6,
          select: { status: true, sentAt: true, employee: { select: { id: true, firstName: true, lastName: true } } },
        }),
        this.prisma.employee.findMany({
          where: emp({ hireDate: { gte: trendStart } }),
          select: { hireDate: true },
        }),
        this.prisma.employee.findMany({
          where: emp({ createdAt: { gte: trendStart } }),
          select: { createdAt: true },
        }),
        // The newest colleagues — the human face of "how are we growing".
        this.prisma.employee.findMany({
          where: emp({ status: 'ACTIVE', hireDate: { not: null } }),
          orderBy: { hireDate: 'desc' },
          take: 5,
          select: { id: true, firstName: true, lastName: true, jobTitle: true, department: true, hireDate: true },
        }),
      ]);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const joinedThisMonth = hires.filter((h) => h.hireDate && h.hireDate >= monthStart).length;

    const toMap = (rows: Array<{ status: string; _count: { _all: number } }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

    // One lifecycle, two views: the onboarding pipeline vs. employment.
    const all = toMap(byStatus as never);
    const employees: Record<string, number> = {};
    const onboarding: Record<string, number> = {};
    for (const [status, count] of Object.entries(all)) {
      if (status === 'ACTIVE' || status === 'INACTIVE' || status === 'WITHDRAWN') employees[status] = count;
      else onboarding[status] = count;
    }

    // Weekly buckets, oldest first — what the sparklines draw.
    const bucket = (dates: Array<Date | null>) => {
      const weeks = new Array<number>(TREND_WEEKS).fill(0);
      for (const d of dates) {
        if (!d) continue;
        const idx = TREND_WEEKS - 1 - Math.floor(dayDiff(now, d) / 7);
        if (idx >= 0 && idx < TREND_WEEKS) weeks[idx] = (weeks[idx] ?? 0) + 1;
      }
      return weeks;
    };

    const attention: AttentionItem[] = [
      ...stalled.map((e) => ({
        kind: 'stalled' as const,
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`,
        status: e.status,
        days: dayDiff(now, e.statusChangedAt),
        to: `/employees/${e.id}`,
      })),
      ...expiring.map((d) => ({
        kind: 'expiring' as const,
        employeeId: d.employee.id,
        name: `${d.employee.firstName} ${d.employee.lastName}`,
        status: d.type,
        days: dayDiff(d.expiryDate, now),
        to: `/employees/${d.employee.id}`,
      })),
      ...custody.map((f) => ({
        kind: 'custody' as const,
        employeeId: f.employee.id,
        name: `${f.employee.firstName} ${f.employee.lastName}`,
        status: f.status,
        days: f.sentAt ? dayDiff(now, f.sentAt) : 0,
        to: `/employees/${f.employee.id}`,
      })),
    ]
      // Most urgent first: expiry that is closest/past, then the longest wait.
      .sort((a, b) => {
        const ua = a.kind === 'expiring' ? -1000 + a.days : -a.days;
        const ub = b.kind === 'expiring' ? -1000 + b.days : -b.days;
        return ua - ub;
      })
      .slice(0, 8);

    const value = {
      /** Transfers / promotions taking effect in the next 30 days. */
      upcomingChanges: upcomingChanges.map((c) => ({
        batchId: c.batchId,
        category: c.category,
        effectiveDate: c.effectiveDate.toISOString().slice(0, 10),
        employeeId: c.employee.id,
        name: `${c.employee.firstName} ${c.employee.lastName}`.trim(),
      })),
      /** Active people who cannot use My space yet. */
      withoutLogin,
      onboarding,
      employees,
      processes: {
        gosi: toMap(gosi as never),
        medical: toMap(medical as never),
        criminal: toMap(criminal as never),
      },
      assetForms: toMap(assetForms as never),
      offboardings: toMap(offboardings as never),
      attention,
      counts: {
        stalled: stalled.length,
        expiringDocs: expiring.length,
        custodyWaiting: custody.length,
        joinedThisMonth,
      },
      recentJoiners: joiners.map((j) => ({
        id: j.id,
        name: `${j.firstName} ${j.lastName}`,
        jobTitle: j.jobTitle,
        department: j.department,
        hireDate: j.hireDate,
      })),
      trends: {
        weeks: TREND_WEEKS,
        hires: bucket(hires.map((h) => h.hireDate)),
        intakes: bucket(intakes.map((i) => i.createdAt)),
      },
      recent: recent.map((log) => ({
        id: log.id,
        entity: log.entity,
        action: log.action,
        toStatus: log.toStatus,
        actorType: log.actorType,
        actorName: log.actor?.name ?? null,
        at: log.at,
        subject: log.employee
          ? `${log.employee.firstName} ${log.employee.lastName}${log.employee.employeeNo ? ` (${log.employee.employeeNo})` : ''}`
          : null,
      })),
    };
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }
}
