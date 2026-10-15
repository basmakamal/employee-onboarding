import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { EmployeeScope } from '../../auth/authz/authorize.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { CompensationService } from './compensation.service.js';
import { addMonths, buildSchedule, withinLimit } from './loan-calc.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

export const EARNING_CATEGORIES = ['BONUS', 'COMMISSION', 'ARREARS', 'OTHER_EARNING'] as const;
export const DEDUCTION_CATEGORIES = ['PENALTY', 'DAMAGE', 'OTHER_DEDUCTION'] as const;

export interface LoanInput {
  kind: 'ADVANCE' | 'LOAN';
  amount: number;
  instalments: number;
  startMonth: string;
  reason: string;
}
export interface PaymentInput {
  kind: 'EARNING' | 'DEDUCTION';
  category: string;
  amount: number;
  month: string;
  reason: string;
}

/**
 * Advances, loans and one-off payments — the money that moves outside the
 * monthly package. HR / payroll enter them, an approver decides (recorded),
 * and payroll (Phase F) takes the approved ones into the month. Amounts stay
 * out of the audit trail, like salaries.
 */
export class LoanService {
  constructor(
    private readonly db: PrismaClient,
    private readonly pay: CompensationService,
    private readonly audit: AuditLogRepository,
  ) {}

  private log(companyId: string, actor: Actor, employeeId: string, action: string, metadata: Record<string, string | number | boolean | null>) {
    return this.audit.append({
      entity: 'EMPLOYEE', entityId: employeeId, action, actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId, companyId, metadata,
    });
  }

  private async thisMonth(companyId: string) {
    return (await this.pay.todayOf(companyId)).slice(0, 7);
  }

  private async activeEmployee(companyId: string, employeeId: string) {
    const e = await this.db.employee.findFirst({ where: { id: employeeId, companyId }, select: { status: true } });
    if (!e) throw new NotFoundError('employee', employeeId);
    if (e.status !== 'ACTIVE') throw new GuardFailedError('NOT_ACTIVE', 'only active employees');
  }

  // ─────────────────────────────────────────────────────────── loans

  /**
   * Work out a loan without saving it: the schedule, and whether one
   * instalment stays within the share of the wage the policy allows
   * (Art. 92: 10% by default).
   */
  async evaluateLoan(companyId: string, employeeId: string, input: LoanInput) {
    if (!MONTH_RE.test(input.startMonth)) throw new GuardFailedError('BAD_MONTH', 'pick the month of the first instalment', 'startMonth');
    if (input.startMonth < (await this.thisMonth(companyId))) throw new GuardFailedError('PAST_MONTH', 'repayment starts this month or later', 'startMonth');
    if (!(input.amount > 0) || input.amount > 1_000_000) throw new GuardFailedError('BAD_AMOUNT', 'enter the amount', 'amount');
    const count = input.kind === 'ADVANCE' ? 1 : input.instalments;
    if (!Number.isInteger(count) || count < 1 || count > 60) throw new GuardFailedError('BAD_INSTALMENTS', 'from 1 to 60 monthly instalments', 'instalments');
    const schedule = buildSchedule(input.amount, count, input.startMonth);
    // The wage of that month: from the 1st (or today, in the current month); someone who joined mid-month by the month's end.
    const today = await this.pay.todayOf(companyId);
    const from = today.slice(0, 7) === input.startMonth ? today : `${input.startMonth}-01`;
    const monthEnd = new Date(Date.UTC(Number(input.startMonth.slice(0, 4)), Number(input.startMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const gross = (await this.pay.grossOn(companyId, employeeId, from)) ?? (await this.pay.grossOn(companyId, employeeId, monthEnd));
    if (gross == null) throw new GuardFailedError('NO_PAY', 'enter this employee\'s pay first — instalments are checked against the wage', 'amount');
    const policy = await this.pay.policyOn(companyId, `${input.startMonth}-01`);
    const maxPct = policy.loanInstalmentMaxPct == null ? null : Number(policy.loanInstalmentMaxPct);
    // Other loans being repaid in the same months count too.
    const others = await this.db.loanInstalment.findMany({
      where: { status: 'DUE', month: { in: schedule.map((s) => s.month) }, loan: { employeeId, status: 'APPROVED' } },
      select: { month: true, amount: true },
    });
    const worst = Math.max(...schedule.map((s) => s.amount + others.filter((o) => o.month === s.month).reduce((t, o) => t + num(o.amount), 0)));
    const limit = maxPct == null ? null : r2((gross * maxPct) / 100);
    return { schedule, gross, maxPct, limit, monthlyTotal: r2(worst), withinLimit: withinLimit(worst, gross, maxPct) };
  }

  async requestLoan(companyId: string, employeeId: string, input: LoanInput, actor: Actor) {
    await this.activeEmployee(companyId, employeeId);
    const e = await this.evaluateLoan(companyId, employeeId, input);
    if (!e.withinLimit) {
      throw new GuardFailedError('LOAN_OVER_LIMIT', `the monthly repayment (${e.monthlyTotal}) is above ${e.maxPct}% of the wage (${e.limit}) — spread it over more months`, 'instalments');
    }
    const row = await this.db.employeeLoan.create({
      data: {
        companyId, employeeId, kind: input.kind, amount: input.amount, instalmentCount: e.schedule.length,
        startMonth: input.startMonth, reason: input.reason.trim(), requestedById: actor.id ?? null,
      },
    });
    await this.log(companyId, actor, employeeId, input.kind === 'ADVANCE' ? 'ADVANCE_REQUESTED' : 'LOAN_REQUESTED', { startMonth: input.startMonth, instalments: e.schedule.length });
    return row;
  }

  /** Approve (the schedule is created, the limit re-checked) or reject. The approver is recorded. */
  async decideLoan(companyId: string, id: string, approve: boolean, note: string | undefined, actor: Actor, scope: EmployeeScope | undefined) {
    const loan = await this.db.employeeLoan.findFirst({ where: { id, companyId, ...(scope ? { employee: scope } : {}) } });
    if (!loan) throw new NotFoundError('loan', id);
    if (loan.status !== 'PENDING') throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
    let schedule: Array<{ seq: number; month: string; amount: number }> = [];
    if (approve) {
      // Repayment never starts in a month that has already passed.
      const startMonth = loan.startMonth < (await this.thisMonth(companyId)) ? await this.thisMonth(companyId) : loan.startMonth;
      const e = await this.evaluateLoan(companyId, loan.employeeId, { kind: loan.kind as 'ADVANCE' | 'LOAN', amount: num(loan.amount), instalments: loan.instalmentCount, startMonth, reason: loan.reason });
      if (!e.withinLimit) throw new GuardFailedError('LOAN_OVER_LIMIT', `the monthly repayment (${e.monthlyTotal}) is now above ${e.maxPct}% of the wage (${e.limit})`);
      schedule = e.schedule;
    }
    await this.db.$transaction(async (tx) => {
      const moved = await tx.employeeLoan.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          ...(approve ? { startMonth: schedule[0]!.month } : {}),
          decidedById: actor.id ?? null, decidedAt: new Date(), decisionNote: note?.trim() || null,
        },
      });
      if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
      if (approve) await tx.loanInstalment.createMany({ data: schedule.map((s) => ({ loanId: id, ...s })) });
    });
    await this.log(companyId, actor, loan.employeeId, approve ? 'LOAN_APPROVED' : 'LOAN_REJECTED', { kind: loan.kind });
    return this.db.employeeLoan.findUniqueOrThrow({ where: { id }, include: { instalments: { orderBy: { seq: 'asc' } } } });
  }

  /** Withdraw a request, or call off an approved loan nothing has been repaid of yet. */
  async cancelLoan(companyId: string, employeeId: string, id: string, actor: Actor) {
    const loan = await this.db.employeeLoan.findFirst({ where: { id, employeeId, companyId }, include: { instalments: true } });
    if (!loan) throw new NotFoundError('loan', id);
    if (!['PENDING', 'APPROVED'].includes(loan.status)) throw new GuardFailedError('ALREADY_DECIDED', 'this loan is already closed');
    if (loan.instalments.some((i) => i.status === 'DEDUCTED' || i.status === 'PAID_CASH')) {
      throw new GuardFailedError('REPAYMENT_STARTED', 'repayment has started — record the rest as paid instead');
    }
    await this.db.$transaction(async (tx) => {
      await tx.loanInstalment.deleteMany({ where: { loanId: id } });
      await tx.employeeLoan.update({ where: { id }, data: { status: 'CANCELLED', closedById: actor.id ?? null, closedAt: new Date() } });
    });
    await this.log(companyId, actor, employeeId, 'LOAN_CANCELLED', { kind: loan.kind });
  }

  /** Skip a month: the instalment moves after the last one (e.g. a month of unpaid leave). */
  async postpone(companyId: string, employeeId: string, loanId: string, instalmentId: string, actor: Actor) {
    const loan = await this.db.employeeLoan.findFirst({ where: { id: loanId, employeeId, companyId, status: 'APPROVED' }, include: { instalments: true } });
    if (!loan) throw new NotFoundError('loan', loanId);
    const inst = loan.instalments.find((i) => i.id === instalmentId);
    if (!inst || inst.status !== 'DUE') throw new GuardFailedError('NOT_DUE', 'only an instalment still due can move');
    const last = loan.instalments.filter((i) => i.status !== 'POSTPONED').map((i) => i.month).sort().at(-1)!;
    const seq = Math.max(...loan.instalments.map((i) => i.seq)) + 1;
    await this.db.$transaction(async (tx) => {
      const moved = await tx.loanInstalment.updateMany({ where: { id: inst.id, status: 'DUE' }, data: { status: 'POSTPONED', note: `moved to ${addMonths(last, 1)}` } });
      if (moved.count === 0) throw new GuardFailedError('NOT_DUE', 'only an instalment still due can move');
      await tx.loanInstalment.create({ data: { loanId, seq, month: addMonths(last, 1), amount: inst.amount, note: `moved from ${inst.month}` } });
    });
    await this.log(companyId, actor, employeeId, 'LOAN_INSTALMENT_POSTPONED', { from: inst.month, to: addMonths(last, 1) });
  }

  /** The employee repaid the rest outside payroll (cash, transfer): the loan is settled. */
  async settle(companyId: string, employeeId: string, loanId: string, note: string, actor: Actor) {
    const loan = await this.db.employeeLoan.findFirst({ where: { id: loanId, employeeId, companyId, status: 'APPROVED' } });
    if (!loan) throw new NotFoundError('loan', loanId);
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.loanInstalment.updateMany({ where: { loanId, status: 'DUE' }, data: { status: 'PAID_CASH', settledAt: now, note: note.trim() } });
      await tx.employeeLoan.update({ where: { id: loanId }, data: { status: 'SETTLED', closedById: actor.id ?? null, closedAt: now } });
    });
    await this.log(companyId, actor, employeeId, 'LOAN_SETTLED', { kind: loan.kind });
  }

  // ─────────────────────────────────────────────────────────── one-off payments

  async requestPayment(companyId: string, employeeId: string, input: PaymentInput, actor: Actor) {
    await this.activeEmployee(companyId, employeeId);
    const allowed: readonly string[] = input.kind === 'EARNING' ? EARNING_CATEGORIES : DEDUCTION_CATEGORIES;
    if (!allowed.includes(input.category)) throw new GuardFailedError('BAD_CATEGORY', 'pick what the payment is for', 'category');
    if (!MONTH_RE.test(input.month)) throw new GuardFailedError('BAD_MONTH', 'pick the payroll month', 'month');
    if (input.month < (await this.thisMonth(companyId))) throw new GuardFailedError('PAST_MONTH', 'this month or a later one', 'month');
    if (!(input.amount > 0) || input.amount > 1_000_000) throw new GuardFailedError('BAD_AMOUNT', 'enter the amount', 'amount');
    const row = await this.db.oneTimePayment.create({
      data: { companyId, employeeId, kind: input.kind, category: input.category, amount: input.amount, month: input.month, reason: input.reason.trim(), requestedById: actor.id ?? null },
    });
    await this.log(companyId, actor, employeeId, 'PAYMENT_REQUESTED', { kind: input.kind, category: input.category, month: input.month });
    return row;
  }

  async decidePayment(companyId: string, id: string, approve: boolean, note: string | undefined, actor: Actor, scope: EmployeeScope | undefined) {
    const p = await this.db.oneTimePayment.findFirst({ where: { id, companyId, ...(scope ? { employee: scope } : {}) } });
    if (!p) throw new NotFoundError('payment', id);
    const moved = await this.db.oneTimePayment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actor.id ?? null, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
    if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
    await this.log(companyId, actor, p.employeeId, approve ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED', { category: p.category, month: p.month });
    return this.db.oneTimePayment.findUniqueOrThrow({ where: { id } });
  }

  async cancelPayment(companyId: string, employeeId: string, id: string, actor: Actor) {
    const moved = await this.db.oneTimePayment.updateMany({ where: { id, employeeId, companyId, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
    if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this payment is already paid or closed');
    await this.log(companyId, actor, employeeId, 'PAYMENT_CANCELLED', { payment: id });
  }

  // ─────────────────────────────────────────────────────────── reading

  private async names(ids: Array<string | null | undefined>) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = want.length ? await this.db.user.findMany({ where: { id: { in: want } }, select: { id: true, name: true } }) : [];
    return (id: string | null) => rows.find((r) => r.id === id)?.name ?? null;
  }

  private shapeLoan<T extends { amount: Prisma.Decimal; instalments: Array<{ amount: Prisma.Decimal; status: string }> }>(loan: T) {
    const sum = (status: string) => r2(loan.instalments.filter((i) => i.status === status).reduce((t, i) => t + num(i.amount), 0));
    return {
      ...loan,
      amount: num(loan.amount),
      outstanding: sum('DUE'),
      repaid: r2(sum('DEDUCTED') + sum('PAID_CASH')),
      instalments: loan.instalments.map((i) => ({ ...i, amount: num(i.amount) })),
    };
  }

  /** The loans and one-off payments of one employee (Pay tab). */
  async forEmployee(companyId: string, employeeId: string) {
    const [loans, payments, thisMonth] = await Promise.all([
      this.db.employeeLoan.findMany({ where: { employeeId, companyId }, include: { instalments: { orderBy: { seq: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
      this.db.oneTimePayment.findMany({ where: { employeeId, companyId }, orderBy: [{ month: 'desc' }, { createdAt: 'desc' }], take: 100 }),
      this.thisMonth(companyId),
    ]);
    const name = await this.names([...loans, ...payments].flatMap((x) => [x.requestedById, x.decidedById]));
    return {
      thisMonth,
      loans: loans.map((l) => ({ ...this.shapeLoan(l), requestedBy: name(l.requestedById), decidedBy: name(l.decidedById) })),
      payments: payments.map((p) => ({ ...p, amount: num(p.amount), requestedBy: name(p.requestedById), decidedBy: name(p.decidedById) })),
    };
  }

  /** Company register: loans by status (with what is left), or the one-off payments of a month. */
  async register(companyId: string, scope: EmployeeScope | undefined, q: { view: 'LOANS' | 'PAYMENTS'; status?: string | undefined; month?: string | undefined }) {
    const employee = { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } };
    const where = { companyId, ...(scope ? { employee: scope } : {}), ...(q.status ? { status: q.status } : {}) };
    if (q.view === 'LOANS') {
      const loans = await this.db.employeeLoan.findMany({ where, include: { employee, instalments: { orderBy: { seq: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 300 });
      const name = await this.names(loans.flatMap((l) => [l.requestedById, l.decidedById]));
      return { items: loans.map((l) => ({ ...this.shapeLoan(l), requestedBy: name(l.requestedById), decidedBy: name(l.decidedById) })) };
    }
    const payments = await this.db.oneTimePayment.findMany({
      where: { ...where, ...(q.month ? { month: q.month } : {}) },
      include: { employee },
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const name = await this.names(payments.flatMap((p) => [p.requestedById, p.decidedById]));
    return { items: payments.map((p) => ({ ...p, amount: num(p.amount), requestedBy: name(p.requestedById), decidedBy: name(p.decidedById) })) };
  }
}
