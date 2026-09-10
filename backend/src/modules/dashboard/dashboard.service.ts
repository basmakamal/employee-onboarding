import type { PrismaClient } from '../../generated/prisma/client.js';

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
  private cache: { value: unknown; at: number } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  async summary(now: Date = new Date()) {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;

    const stallBefore = new Date(now.getTime() - STALL_DAYS * 86_400_000);
    const expiryUntil = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000);
    const trendStart = new Date(now.getTime() - TREND_WEEKS * 7 * 86_400_000);

    const [byStatus, gosi, medical, criminal, assetForms, offboardings, recent, stalled, expiring, custody, hires, intakes] =
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
            actor: { select: { name: true } },
          },
        }),
        // Pipeline records that have not moved for STALL_DAYS.
        this.prisma.employee.findMany({
          where: { status: { in: [...PIPELINE] }, statusChangedAt: { lt: stallBefore } },
          orderBy: { statusChangedAt: 'asc' },
          take: 10,
          select: { id: true, firstName: true, lastName: true, status: true, statusChangedAt: true },
        }),
        // Documents expiring soon (or already expired) on active staff.
        this.prisma.employeeDocument.findMany({
          where: { expiryDate: { lte: expiryUntil }, employee: { status: 'ACTIVE' } },
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
          where: { status: { in: ['SENT', 'PENDING_EMPLOYEE_APPROVAL'] }, sentAt: { lt: stallBefore } },
          orderBy: { sentAt: 'asc' },
          take: 6,
          select: { status: true, sentAt: true, employee: { select: { id: true, firstName: true, lastName: true } } },
        }),
        this.prisma.employee.findMany({
          where: { hireDate: { gte: trendStart } },
          select: { hireDate: true },
        }),
        this.prisma.employee.findMany({
          where: { createdAt: { gte: trendStart } },
          select: { createdAt: true },
        }),
      ]);

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
      },
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
    this.cache = { value, at: Date.now() };
    return value;
  }
}
