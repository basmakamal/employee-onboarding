import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { ScheduleService } from '../workforce/schedule.service.js';
import { isWorkingDay } from '../workforce/leave-calc.js';
import { addDays } from '../workforce/attendance-calc.js';
import type { CompensationService } from './compensation.service.js';
import { resolvePackage, type ComponentDef } from './compensation-calc.js';
import { calculate, ENGINE_VERSION, type EngineInput, type EngineWarning, type Proration, type Segment } from './payroll-engine.js';
import { addMonths } from './loan-calc.js';
import { removeStoredFiles } from '../../common/storage.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const dayValue = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const numOrNull = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

const PAYMENT_LABELS: Record<string, [string, string]> = {
  BONUS: ['مكافأة', 'Bonus'],
  COMMISSION: ['عمولة', 'Commission'],
  ARREARS: ['فروقات مستحقة', 'Arrears'],
  OTHER_EARNING: ['استحقاق آخر', 'Other earning'],
  PENALTY: ['جزاء', 'Penalty'],
  DAMAGE: ['تلف / فقد', 'Damage / loss'],
  OTHER_DEDUCTION: ['استقطاع آخر', 'Other deduction'],
  CORRECTION: ['تصحيح', 'Correction'],
};
const monthAr = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const monthEn = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

export interface RunWarning {
  code: 'EXCEPTIONS_PENDING' | 'GOSI_RATES_MISSING' | 'NO_PAY' | 'NEGATIVE_NET' | 'DEDUCTIONS_OVER_LIMIT';
  blocking: boolean;
  count: number;
}

/**
 * Payroll runs: one month of a company, calculated from everything already
 * decided elsewhere (pay versions, confirmed attendance exceptions, approved
 * leave, overtime, one-off payments, loan instalments) and the policy in
 * force. A run is recalculated until approved; approving locks the
 * attendance days it used and marks instalments and payments as paid. The
 * person who calculated a run can never approve it.
 */
export class PayrollService {
  constructor(
    private readonly db: PrismaClient,
    private readonly pay: CompensationService,
    private readonly schedule: ScheduleService,
    private readonly calendar: { getCalendar(companyId: string): Promise<{ weekendDays: number[] }> },
    private readonly audit: AuditLogRepository,
  ) {}

  private log(companyId: string, actor: Actor, runId: string, action: string, metadata: Record<string, string | number | boolean | null>) {
    return this.audit.append({
      entity: 'PAYROLL_RUN', entityId: runId, action, actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      companyId, metadata,
    });
  }

  /** The attendance period of a payroll month: the day after last month's cut-off to this month's. */
  static period(month: string, cutoffDay: number) {
    const pad = String(cutoffDay).padStart(2, '0');
    return { from: addDays(`${addMonths(month, -1)}-${pad}`, 1), to: `${month}-${pad}` };
  }

  // ─────────────────────────────────────────────────────────── reading

  async list(companyId: string) {
    const runs = await this.db.payrollRun.findMany({ where: { companyId }, orderBy: [{ month: 'desc' }, { version: 'desc' }], take: 60 });
    const names = await this.names(runs.flatMap((r) => [r.calculatedById, r.approvedById, r.paidById]));
    return runs.map((r) => this.shapeRun(r, names));
  }

  async get(companyId: string, id: string) {
    const run = await this.db.payrollRun.findFirst({
      where: { id, companyId },
      include: {
        lines: {
          include: {
            items: { orderBy: { sortOrder: 'asc' } },
            employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } },
          },
          orderBy: { employee: { firstName: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundError('payroll run', id);
    const names = await this.names([run.calculatedById, run.approvedById, run.paidById, run.cancelledById, run.reopenedById]);
    // The month before, for the comparison of totals.
    const previous = await this.db.payrollRun.findFirst({
      where: { companyId, month: { lt: run.month }, status: { in: ['APPROVED', 'PAID'] } },
      orderBy: [{ month: 'desc' }, { version: 'desc' }],
      select: { id: true, month: true, employees: true, gross: true, deductions: true, net: true },
    });
    return {
      ...this.shapeRun(run, names),
      reopenedBy: names(run.reopenedById),
      previous: previous ? { ...previous, gross: num(previous.gross), deductions: num(previous.deductions), net: num(previous.net) } : null,
      lines: run.lines.map((l) => ({
        id: l.id,
        employee: l.employee,
        gross: num(l.gross),
        deductions: num(l.deductions),
        net: num(l.net),
        employerCost: num(l.employerCost),
        previousNet: numOrNull(l.previousNet),
        held: l.held,
        heldReason: l.heldReason,
        inputs: l.inputs,
        warnings: (l.warnings ?? []) as unknown as EngineWarning[],
        items: l.items.map((i) => ({ ...i, quantity: numOrNull(i.quantity), rate: numOrNull(i.rate), amount: num(i.amount) })),
      })),
    };
  }

  private shapeRun<T extends { gross: Prisma.Decimal; deductions: Prisma.Decimal; net: Prisma.Decimal; employerCost: Prisma.Decimal; periodFrom: Date; periodTo: Date; calculatedById: string | null; approvedById: string | null; paidById: string | null; warnings: Prisma.JsonValue }>(
    r: T,
    names: (id: string | null) => string | null,
  ) {
    return {
      ...r,
      periodFrom: dayOf(r.periodFrom),
      periodTo: dayOf(r.periodTo),
      gross: num(r.gross),
      deductions: num(r.deductions),
      net: num(r.net),
      employerCost: num(r.employerCost),
      warnings: (r.warnings ?? []) as unknown as RunWarning[],
      calculatedBy: names(r.calculatedById),
      approvedBy: names(r.approvedById),
      paidBy: names(r.paidById),
    };
  }

  private async names(ids: Array<string | null | undefined>) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = want.length ? await this.db.user.findMany({ where: { id: { in: want } }, select: { id: true, name: true } }) : [];
    return (id: string | null) => rows.find((r) => r.id === id)?.name ?? null;
  }

  // ─────────────────────────────────────────────────────────── calculating

  /** Start the payroll of a month — or recalculate it while it is not approved yet. */
  async calculateMonth(companyId: string, month: string, actor: Actor) {
    if (!MONTH_RE.test(month)) throw new GuardFailedError('BAD_MONTH', 'pick the payroll month', 'month');
    const open = await this.db.payrollRun.findFirst({ where: { companyId, month, status: { not: 'CANCELLED' } }, orderBy: { version: 'desc' } });
    if (open && open.status !== 'CALCULATED') throw new GuardFailedError('RUN_CLOSED', `the payroll of ${month} is already ${open.status.toLowerCase()}`, 'month');
    const policy = await this.pay.policyOn(companyId, `${month}-01`);
    const period = PayrollService.period(month, policy.cutoffDay);
    const run =
      open ??
      (await this.db.payrollRun.create({
        data: {
          companyId,
          month,
          version: ((await this.db.payrollRun.aggregate({ where: { companyId, month }, _max: { version: true } }))._max.version ?? 0) + 1,
          periodFrom: dayValue(period.from),
          periodTo: dayValue(period.to),
          engineVersion: ENGINE_VERSION,
        },
      }));
    await this.recalculate(companyId, run.id, actor);
    return this.get(companyId, run.id);
  }

  async recalculate(companyId: string, runId: string, actor: Actor) {
    const run = await this.db.payrollRun.findFirst({ where: { id: runId, companyId }, include: { lines: { select: { employeeId: true, held: true, heldReason: true } } } });
    if (!run) throw new NotFoundError('payroll run', runId);
    if (run.status !== 'CALCULATED') throw new GuardFailedError('RUN_CLOSED', 'only a run that is not approved yet can be recalculated');
    const month = run.month;
    const monthStart = `${month}-01`;
    const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    const policyRow = await this.pay.policyOn(companyId, monthStart);
    const period = PayrollService.period(month, policyRow.cutoffDay);
    const policy = {
      proration: policyRow.proration as Proration,
      rateDaysPerMonth: policyRow.rateDaysPerMonth,
      hoursPerDay: num(policyRow.hoursPerDay),
      overtimePremiumPct: num(policyRow.overtimePremiumPct),
      gosiSaudiEmployeePct: numOrNull(policyRow.gosiSaudiEmployeePct),
      gosiSaudiEmployerPct: numOrNull(policyRow.gosiSaudiEmployerPct),
      gosiNonSaudiEmployerPct: numOrNull(policyRow.gosiNonSaudiEmployerPct),
      gosiWageCap: numOrNull(policyRow.gosiWageCap),
      deductionsMaxPct: numOrNull(policyRow.deductionsMaxPct),
    };

    // Who is paid: active people employed by the end of the month.
    const people = await this.db.employee.findMany({
      where: { companyId, status: 'ACTIVE', OR: [{ hireDate: null }, { hireDate: { lte: dayValue(monthEnd) } }] },
      select: { id: true, hireDate: true, nationality: true },
    });
    const ids = people.map((p) => p.id);
    const components: ComponentDef[] = (await this.pay.listComponents(companyId)).map((c) => ({
      id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, kind: c.kind, method: c.method,
      gosiBase: c.gosiBase, hourlyBase: c.hourlyBase, prorated: c.prorated, sortOrder: c.sortOrder,
    }));

    const [versions, schedules, cal, attendance, pendingExceptions, leaves, overtime, payments, instalments, previousRun] = await Promise.all([
      this.db.employeeCompensation.findMany({ where: { companyId, employeeId: { in: ids }, effectiveFrom: { lte: dayValue(monthEnd) } }, include: { lines: true }, orderBy: { effectiveFrom: 'asc' } }),
      this.schedule.resolveMany(companyId, ids, monthStart, monthEnd),
      this.calendar.getCalendar(companyId),
      this.db.attendanceDay.findMany({
        where: { employeeId: { in: ids }, date: { gte: dayValue(period.from), lte: dayValue(period.to) }, review: 'CONFIRMED' },
        select: { employeeId: true, status: true, lateMinutes: true, earlyLeaveMinutes: true },
      }),
      this.db.attendanceDay.count({ where: { employeeId: { in: ids }, date: { gte: dayValue(period.from), lte: dayValue(period.to) }, review: 'PENDING' } }),
      this.db.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: dayValue(period.to) }, endDate: { gte: dayValue(period.from) } },
        include: { leaveType: { select: { code: true, nameAr: true, nameEn: true } } },
      }),
      this.db.overtimeRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', date: { gte: dayValue(period.from), lte: dayValue(period.to) } },
        select: { employeeId: true, approvedMinutes: true, minutes: true },
      }),
      this.db.oneTimePayment.findMany({ where: { employeeId: { in: ids }, companyId, status: 'APPROVED', month } }),
      this.db.loanInstalment.findMany({ where: { month, status: 'DUE', loan: { companyId, employeeId: { in: ids }, status: 'APPROVED' } }, include: { loan: { select: { employeeId: true, kind: true } } } }),
      this.db.payrollRun.findFirst({ where: { companyId, month: { lt: month }, status: { in: ['APPROVED', 'PAID'] } }, orderBy: [{ month: 'desc' }, { version: 'desc' }], include: { lines: { select: { employeeId: true, net: true } } } }),
    ]);
    const heldBefore = new Map(run.lines.filter((l) => l.held).map((l) => [l.employeeId, l.heldReason]));
    // Corrections name the month they correct.
    const correctedIds = [...new Set(payments.map((p) => p.correctsRunId).filter((x): x is string => !!x))];
    const correctedMonths = new Map(
      (correctedIds.length ? await this.db.payrollRun.findMany({ where: { id: { in: correctedIds } }, select: { id: true, month: true } }) : []).map((r) => [r.id, r.month]),
    );

    const lines: Array<{ employeeId: string; result: ReturnType<typeof calculate>; previousNet: number | null }> = [];
    for (const person of people) {
      const days = schedules.get(person.id) ?? [];
      const working = (from: string, to: string) => days.filter((d) => d.date >= from && d.date <= to && isWorkingDay(d, cal.weekendDays)).length;
      const start = person.hireDate && dayOf(person.hireDate) > monthStart ? dayOf(person.hireDate) : monthStart;
      const mine = versions.filter((v) => v.employeeId === person.id);
      const segments: Segment[] = [];
      mine.forEach((v, i) => {
        const next = mine[i + 1];
        const from = dayOf(v.effectiveFrom) > start ? dayOf(v.effectiveFrom) : start;
        const to = next && addDays(dayOf(next.effectiveFrom), -1) < monthEnd ? addDays(dayOf(next.effectiveFrom), -1) : monthEnd;
        if (from > to) return;
        const pkg = resolvePackage(v.lines.map((l) => ({ componentId: l.componentId, amount: numOrNull(l.amount), percent: numOrNull(l.percent) })), components);
        segments.push({ from, to, versionId: v.id, pkg, workingDays: working(from, to) });
      });

      // The unpaid share of approved leave inside the period, per leave type and rate.
      const leaveParts = new Map<string, { code: string; nameAr: string; nameEn: string; days: number; percent: number }>();
      for (const l of leaves.filter((x) => x.employeeId === person.id)) {
        const total = Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86_400_000) + 1;
        const from = dayOf(l.startDate) > period.from ? dayOf(l.startDate) : period.from;
        const to = dayOf(l.endDate) < period.to ? dayOf(l.endDate) : period.to;
        const share = (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1) / total;
        for (const part of (l.payBreakdown ?? []) as Array<{ days: number; percent: number }>) {
          if (part.percent >= 100) continue;
          const key = `${l.leaveType.code}:${part.percent}`;
          const existing = leaveParts.get(key);
          const d = part.days * share;
          if (existing) existing.days += d;
          else leaveParts.set(key, { code: l.leaveType.code, nameAr: l.leaveType.nameAr, nameEn: l.leaveType.nameEn, days: d, percent: part.percent });
        }
      }

      const att = attendance.filter((a) => a.employeeId === person.id);
      const input: EngineInput = {
        month,
        daysInMonth,
        monthWorkingDays: working(monthStart, monthEnd),
        segments,
        policy,
        saudi: person.nationality === 'SA',
        absentDays: att.filter((a) => a.status === 'ABSENT').length,
        missingPunchDays: att.filter((a) => a.status === 'INCOMPLETE').length,
        lateEarlyMinutes: att.filter((a) => a.status === 'PRESENT').reduce((t, a) => t + a.lateMinutes + a.earlyLeaveMinutes, 0),
        leave: [...leaveParts.values()].map((x) => ({ ...x, days: r2(x.days) })),
        overtimeMinutes: overtime.filter((o) => o.employeeId === person.id).reduce((t, o) => t + (o.approvedMinutes ?? o.minutes), 0),
        payments: payments
          .filter((p) => p.employeeId === person.id)
          .map((p) => {
            const corrected = p.correctsRunId ? correctedMonths.get(p.correctsRunId) : undefined;
            const [ar, en] = PAYMENT_LABELS[p.category] ?? [p.category, p.category];
            return {
              id: p.id, kind: p.kind as 'EARNING' | 'DEDUCTION', category: p.category, amount: num(p.amount),
              labelAr: corrected ? `${ar} عن ${monthAr(corrected)}` : ar,
              labelEn: corrected ? `${en} for ${monthEn(corrected)}` : en,
            };
          }),
        instalments: instalments.filter((i) => i.loan.employeeId === person.id).map((i) => ({ id: i.id, loanId: i.loanId, kind: i.loan.kind, amount: num(i.amount) })),
      };
      const prev = previousRun?.lines.find((l) => l.employeeId === person.id);
      lines.push({ employeeId: person.id, result: calculate(input), previousNet: prev ? num(prev.net) : null });
    }

    const paid = lines.filter((l) => !heldBefore.has(l.employeeId));
    const warnings = runWarnings(paid.map((l) => l.result.warnings), pendingExceptions);
    const total = (pick: (l: (typeof lines)[number]) => number) => r2(paid.reduce((t, l) => t + pick(l), 0));
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.payrollLine.deleteMany({ where: { runId } });
      for (const l of lines) {
        await tx.payrollLine.create({
          data: {
            runId,
            employeeId: l.employeeId,
            gross: l.result.gross,
            deductions: l.result.deductions,
            net: l.result.net,
            employerCost: l.result.employerCost,
            previousNet: l.previousNet,
            held: heldBefore.has(l.employeeId),
            heldReason: heldBefore.get(l.employeeId) ?? null,
            inputs: l.result.inputs as Prisma.InputJsonValue,
            warnings: l.result.warnings as unknown as Prisma.InputJsonValue,
            items: {
              create: l.result.items.map((i) => ({
                kind: i.kind, source: i.source, sourceId: i.sourceId, code: i.code, labelAr: i.labelAr, labelEn: i.labelEn,
                quantity: i.quantity, rate: i.rate, amount: i.amount, sortOrder: i.sortOrder,
              })),
            },
          },
        });
      }
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          periodFrom: dayValue(period.from),
          periodTo: dayValue(period.to),
          policyId: policyRow.id,
          engineVersion: ENGINE_VERSION,
          employees: paid.length,
          gross: total((l) => l.result.gross),
          deductions: total((l) => l.result.deductions),
          net: total((l) => l.result.net),
          employerCost: total((l) => l.result.employerCost),
          warnings: warnings as unknown as Prisma.InputJsonValue,
          calculatedById: actor.id ?? null,
          calculatedAt: now,
        },
      });
    });
    await this.log(companyId, actor, runId, 'PAYROLL_CALCULATED', { month, employees: paid.length });
  }

  /** Leave someone out of this run's payment (or bring them back) — the run totals follow. */
  async hold(companyId: string, runId: string, lineId: string, held: boolean, reason: string | undefined, actor: Actor) {
    const line = await this.db.payrollLine.findFirst({ where: { id: lineId, runId, run: { companyId } }, include: { run: true } });
    if (!line) throw new NotFoundError('payroll line', lineId);
    if (line.run.status !== 'CALCULATED') throw new GuardFailedError('RUN_CLOSED', 'this run is no longer open');
    if (held && !reason?.trim()) throw new GuardFailedError('REASON_REQUIRED', 'say why this person is held', 'reason');
    await this.db.payrollLine.update({ where: { id: lineId }, data: { held, heldReason: held ? reason!.trim() : null } });
    const paid = await this.db.payrollLine.findMany({ where: { runId, held: false }, select: { gross: true, deductions: true, net: true, employerCost: true, warnings: true } });
    const sum = (k: 'gross' | 'deductions' | 'net' | 'employerCost') => r2(paid.reduce((t, l) => t + num(l[k]), 0));
    // A held person's problems no longer stand in the way of paying the others.
    const pending = ((line.run.warnings ?? []) as unknown as RunWarning[]).find((w) => w.code === 'EXCEPTIONS_PENDING')?.count ?? 0;
    const warnings = runWarnings(paid.map((l) => (l.warnings ?? []) as unknown as EngineWarning[]), pending);
    await this.db.payrollRun.update({
      where: { id: runId },
      data: { employees: paid.length, gross: sum('gross'), deductions: sum('deductions'), net: sum('net'), employerCost: sum('employerCost'), warnings: warnings as unknown as Prisma.InputJsonValue },
    });
    await this.log(companyId, actor, runId, held ? 'PAYROLL_LINE_HELD' : 'PAYROLL_LINE_RELEASED', { employee: line.employeeId });
  }

  /**
   * Something decided after the calculation (an approval, a pay change, an
   * exception reviewed) would change the result — approving now would pay
   * numbers nobody reviewed.
   */
  private async changedSince(companyId: string, run: { calculatedAt: Date | null; month: string; periodFrom: Date; periodTo: Date }) {
    if (!run.calculatedAt) return true;
    const after = { gt: run.calculatedAt };
    const inPeriod = { gte: run.periodFrom, lte: run.periodTo };
    const counts = await Promise.all([
      this.db.attendanceDay.count({ where: { companyId, date: inPeriod, OR: [{ computedAt: after }, { reviewedAt: after }] } }),
      this.db.leaveRequest.count({ where: { companyId, OR: [{ decidedAt: after }, { cancelledAt: after }], startDate: { lte: run.periodTo }, endDate: { gte: run.periodFrom } } }),
      this.db.overtimeRequest.count({ where: { companyId, decidedAt: after, date: inPeriod } }),
      this.db.oneTimePayment.count({ where: { companyId, month: run.month, OR: [{ decidedAt: after }, { createdAt: after }] } }),
      this.db.employeeLoan.count({ where: { companyId, OR: [{ decidedAt: after }, { closedAt: after }] } }),
      this.db.employeeCompensation.count({ where: { companyId, OR: [{ createdAt: after }, { updatedAt: after }] } }),
      this.db.payrollPolicy.count({ where: { companyId, createdAt: after } }),
    ]);
    return counts.some((c) => c > 0);
  }

  /** Approve: re-checked, never by whoever calculated it; locks the inputs it used. */
  async approve(companyId: string, runId: string, note: string | undefined, actor: Actor) {
    const run = await this.db.payrollRun.findFirst({ where: { id: runId, companyId }, include: { lines: { include: { items: true } } } });
    if (!run) throw new NotFoundError('payroll run', runId);
    if (run.status !== 'CALCULATED') throw new GuardFailedError('RUN_CLOSED', 'this run is not waiting for approval');
    if (actor.id && actor.id === run.calculatedById) throw new GuardFailedError('SAME_PERSON', 'the person who calculated a payroll cannot approve it');
    const blocking = ((run.warnings ?? []) as unknown as RunWarning[]).filter((w) => w.blocking);
    if (blocking.length) throw new GuardFailedError('RUN_BLOCKED', `resolve first: ${blocking.map((w) => w.code).join(', ')}`);
    if (await this.changedSince(companyId, run)) throw new GuardFailedError('RUN_STALE', 'something changed since the calculation — recalculate, review and approve again');

    const paid = run.lines.filter((l) => !l.held);
    const paidIds = paid.map((l) => l.employeeId);
    const instalmentIds = paid.flatMap((l) => l.items.filter((i) => i.source === 'LOAN' && i.sourceId).map((i) => i.sourceId!));
    const paymentIds = paid.flatMap((l) => l.items.filter((i) => i.source === 'PAYMENT' && i.sourceId).map((i) => i.sourceId!));
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      const moved = await tx.payrollRun.updateMany({
        where: { id: runId, status: 'CALCULATED' },
        data: { status: 'APPROVED', approvedById: actor.id ?? null, approvedAt: now, note: note?.trim() || null },
      });
      if (moved.count === 0) throw new GuardFailedError('RUN_CLOSED', 'this run is not waiting for approval');
      // The attendance a payroll has paid on never changes again.
      await tx.attendanceDay.updateMany({ where: { employeeId: { in: paidIds }, date: { gte: run.periodFrom, lte: run.periodTo } }, data: { locked: true } });
      await tx.loanInstalment.updateMany({ where: { id: { in: instalmentIds }, status: 'DUE' }, data: { status: 'DEDUCTED', payrollRunId: runId, settledAt: now } });
      await tx.oneTimePayment.updateMany({ where: { id: { in: paymentIds }, status: 'APPROVED' }, data: { status: 'PAID', payrollRunId: runId } });
      // A loan with nothing left to repay is settled.
      const loans = await tx.employeeLoan.findMany({ where: { companyId, status: 'APPROVED', instalments: { none: { status: 'DUE' } } }, select: { id: true } });
      if (loans.length) await tx.employeeLoan.updateMany({ where: { id: { in: loans.map((l) => l.id) } }, data: { status: 'SETTLED', closedAt: now } });
    });
    await this.log(companyId, actor, runId, 'PAYROLL_APPROVED', { month: run.month, employees: paid.length });
    return this.get(companyId, runId);
  }

  /** The salaries were transferred. */
  async markPaid(companyId: string, runId: string, actor: Actor) {
    const moved = await this.db.payrollRun.updateMany({ where: { id: runId, companyId, status: 'APPROVED' }, data: { status: 'PAID', paidById: actor.id ?? null, paidAt: new Date() } });
    if (moved.count === 0) throw new GuardFailedError('RUN_CLOSED', 'only an approved run can be marked paid');
    await this.log(companyId, actor, runId, 'PAYROLL_PAID', {});
    return this.get(companyId, runId);
  }

  /**
   * Undo an approval before the salaries are paid (e.g. a mistake spotted in
   * review): the attendance days unlock, instalments and one-off payments go
   * back to unpaid, the stored payslips are removed, and the run waits to be
   * recalculated and approved again. Once payslips have gone out — or the
   * run is paid — a mistake is corrected in the next month instead.
   */
  async reopen(companyId: string, runId: string, reason: string, actor: Actor) {
    const run = await this.db.payrollRun.findFirst({ where: { id: runId, companyId }, include: { lines: { select: { employeeId: true, held: true } } } });
    if (!run) throw new NotFoundError('payroll run', runId);
    if (run.status === 'PAID') throw new GuardFailedError('RUN_PAID', 'the salaries are paid — correct it in the next month instead');
    if (run.status !== 'APPROVED') throw new GuardFailedError('RUN_CLOSED', 'only an approved run can be reopened');
    if (!reason.trim()) throw new GuardFailedError('REASON_REQUIRED', 'say why the run is reopened', 'reason');
    const sent = await this.db.payslipDelivery.count({ where: { payslip: { runId }, status: { in: ['QUEUED', 'SENT'] } } });
    if (sent) throw new GuardFailedError('PAYSLIPS_SENT', 'payslips of this run were already e-mailed — correct it in the next month instead');
    const paidIds = run.lines.filter((l) => !l.held).map((l) => l.employeeId);
    const slips = await this.db.payslip.findMany({ where: { runId }, select: { storageKey: true } });
    await this.db.$transaction(async (tx) => {
      const moved = await tx.payrollRun.updateMany({
        where: { id: runId, status: 'APPROVED' },
        data: { status: 'CALCULATED', approvedById: null, approvedAt: null, reopenedById: actor.id ?? null, reopenedAt: new Date(), reopenReason: reason.trim() },
      });
      if (moved.count === 0) throw new GuardFailedError('RUN_CLOSED', 'only an approved run can be reopened');
      await tx.attendanceDay.updateMany({ where: { employeeId: { in: paidIds }, date: { gte: run.periodFrom, lte: run.periodTo } }, data: { locked: false } });
      const instalments = await tx.loanInstalment.findMany({ where: { payrollRunId: runId }, select: { loanId: true } });
      await tx.loanInstalment.updateMany({ where: { payrollRunId: runId }, data: { status: 'DUE', payrollRunId: null, settledAt: null } });
      // A loan this approval settled is being repaid again (one settled by hand stays settled).
      const loanIds = [...new Set(instalments.map((i) => i.loanId))];
      if (loanIds.length) await tx.employeeLoan.updateMany({ where: { id: { in: loanIds }, status: 'SETTLED', closedById: null }, data: { status: 'APPROVED', closedAt: null } });
      await tx.oneTimePayment.updateMany({ where: { payrollRunId: runId }, data: { status: 'APPROVED', payrollRunId: null } });
      await tx.payslip.deleteMany({ where: { runId } });
    });
    await removeStoredFiles(slips.map((s) => s.storageKey));
    await this.log(companyId, actor, runId, 'PAYROLL_REOPENED', { month: run.month, reason: reason.trim() });
    return this.get(companyId, runId);
  }

  /** Throw away a run that is not approved yet (a new one can then be started). */
  async cancel(companyId: string, runId: string, actor: Actor) {
    const moved = await this.db.payrollRun.updateMany({ where: { id: runId, companyId, status: 'CALCULATED' }, data: { status: 'CANCELLED', cancelledById: actor.id ?? null, cancelledAt: new Date() } });
    if (moved.count === 0) throw new GuardFailedError('RUN_CLOSED', 'an approved run cannot be cancelled');
    await this.log(companyId, actor, runId, 'PAYROLL_CANCELLED', {});
  }
}

/** What blocks approval, and what HR should look at — counted over the people being paid. */
export function runWarnings(lineWarnings: EngineWarning[][], pendingExceptions: number): RunWarning[] {
  const count = (code: EngineWarning['code']) => lineWarnings.filter((ws) => ws.some((w) => w.code === code)).length;
  const out: RunWarning[] = [];
  if (pendingExceptions > 0) out.push({ code: 'EXCEPTIONS_PENDING', blocking: true, count: pendingExceptions });
  for (const code of ['NO_PAY', 'NEGATIVE_NET'] as const) if (count(code)) out.push({ code, blocking: true, count: count(code) });
  for (const code of ['GOSI_RATES_MISSING', 'DEDUCTIONS_OVER_LIMIT'] as const) if (count(code)) out.push({ code, blocking: false, count: count(code) });
  return out;
}
