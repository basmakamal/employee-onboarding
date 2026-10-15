import { Prisma, type LeaveType, type PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { EmployeeScope } from '../../auth/authz/authorize.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { localDay } from '../employees/employment-history.service.js';
import type { ScheduleService } from './schedule.service.js';
import { addDays } from './attendance-calc.js';
import {
  countLeaveDays,
  monthlyAccrual,
  monthsBetween,
  payBreakdown,
  r2,
  serviceMonths,
  yearlyEntitlement,
  type CountMode,
  type PayTier,
} from './leave-calc.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayValue = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));

/** Saudi Labour Law defaults — seeded per company, editable by HR, flagged for confirmation in the UI. */
export const DEFAULT_LEAVE_TYPES: Array<Omit<Prisma.LeaveTypeCreateManyInput, 'companyId'>> = [
  // Art. 109: 21 days a year, 30 after five years of service.
  { code: 'ANNUAL', nameAr: 'إجازة سنوية', nameEn: 'Annual leave', color: '#2e7d32', balanceMode: 'ACCRUAL', accrual: 'MONTHLY', daysPerYear: 21, seniorDaysPerYear: 30, seniorAfterYears: 5, countMode: 'WORKING', allowHalfDay: true },
  // Art. 117: in a year, 30 days in full, 60 at 75%, 30 unpaid.
  { code: 'SICK', nameAr: 'إجازة مرضية', nameEn: 'Sick leave', color: '#c62828', yearlyLimit: 120, payTiers: [{ days: 30, percent: 100 }, { days: 60, percent: 75 }, { days: 30, percent: 0 }], countMode: 'CALENDAR' },
  // Art. 113: marriage 5 days, death of a close relative 5 days, birth of a child 3 days.
  { code: 'MARRIAGE', nameAr: 'إجازة زواج', nameEn: 'Marriage leave', color: '#ad1457', maxPerRequest: 5, countMode: 'CALENDAR' },
  { code: 'BEREAVEMENT', nameAr: 'إجازة وفاة', nameEn: 'Bereavement leave', color: '#455a64', maxPerRequest: 5, countMode: 'CALENDAR' },
  { code: 'BIRTH', nameAr: 'إجازة مولود', nameEn: 'Birth of a child', color: '#0277bd', maxPerRequest: 3, countMode: 'CALENDAR', gender: 'MALE' },
  // Art. 114: Hajj once, after two years, 10–15 days including Eid al-Adha.
  { code: 'HAJJ', nameAr: 'إجازة حج', nameEn: 'Hajj leave', color: '#6d4c41', maxPerRequest: 15, oncePerService: true, minServiceMonths: 24, countMode: 'CALENDAR' },
  // Art. 151: 12 weeks maternity leave.
  { code: 'MATERNITY', nameAr: 'إجازة وضع', nameEn: 'Maternity leave', color: '#8e24aa', maxPerRequest: 84, gender: 'FEMALE', countMode: 'CALENDAR' },
  // Art. 160: a Muslim widow — 4 months and 10 days.
  { code: 'IDDAH', nameAr: 'إجازة عدة', nameEn: 'Iddah leave', color: '#37474f', maxPerRequest: 130, gender: 'FEMALE', countMode: 'CALENDAR' },
  { code: 'UNPAID', nameAr: 'إجازة بدون راتب', nameEn: 'Unpaid leave', color: '#757575', paidPercent: 0, countMode: 'WORKING' },
];

export interface LeaveTypeInput {
  code: string;
  nameAr: string;
  nameEn: string;
  color?: string | null | undefined;
  paidPercent: number;
  balanceMode: 'ACCRUAL' | 'NONE';
  accrual?: 'MONTHLY' | 'YEARLY' | null | undefined;
  daysPerYear?: number | null | undefined;
  seniorDaysPerYear?: number | null | undefined;
  seniorAfterYears?: number | null | undefined;
  carryForwardMax?: number | null | undefined;
  yearlyLimit?: number | null | undefined;
  payTiers?: PayTier[] | null | undefined;
  maxPerRequest?: number | null | undefined;
  oncePerService?: boolean | undefined;
  minServiceMonths?: number | null | undefined;
  gender: 'ANY' | 'FEMALE' | 'MALE';
  countMode: CountMode;
  allowHalfDay?: boolean | undefined;
  active?: boolean | undefined;
}

export interface LeaveInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay?: boolean | undefined;
  reason?: string | undefined;
}

/**
 * Leave: types with their rules, requests entered by staff and approved by
 * the branch manager / company manager / super admin, and balances kept as
 * a ledger (accrual, use, reversal, adjustment, expiry) — never one number
 * someone types over. Approved leave marks the attendance days as LEAVE.
 */
export class LeaveService {
  private lastAutoRun = '';

  constructor(
    private readonly db: PrismaClient,
    private readonly schedule: ScheduleService,
    private readonly calendar: { getCalendar(companyId: string): Promise<{ weekendDays: number[] }> },
    private readonly audit: AuditLogRepository,
    /** Re-judge attendance days once a leave is approved or cancelled. */
    private readonly attendance?: { recompute(companyId: string, employeeIds: string[], from: string, to: string): Promise<number> },
  ) {}

  private log(companyId: string, actor: Actor, entity: string, entityId: string, action: string, metadata: Record<string, string | number | boolean | null>, employeeId?: string) {
    return this.audit.append({
      entity,
      entityId,
      action,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      ...(employeeId ? { employeeId } : {}),
      companyId,
      metadata,
    });
  }

  private async timezone(companyId: string) {
    const c = await this.db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return c?.timezone ?? 'Asia/Riyadh';
  }

  // ─────────────────────────────────────────────────────────── types

  /** The company's leave types — the Saudi defaults are created the first time. */
  async listTypes(companyId: string) {
    if ((await this.db.leaveType.count({ where: { companyId } })) === 0) {
      await this.db.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, companyId, system: true })), skipDuplicates: true });
    }
    return this.db.leaveType.findMany({ where: { companyId }, orderBy: [{ active: 'desc' }, { system: 'desc' }, { code: 'asc' }] });
  }

  private validateType(input: LeaveTypeInput) {
    if (input.balanceMode === 'ACCRUAL') {
      if (!input.accrual) throw new GuardFailedError('ACCRUAL_NEEDED', 'choose how the balance builds up', 'accrual');
      if (!input.daysPerYear || input.daysPerYear <= 0) throw new GuardFailedError('DAYS_PER_YEAR', 'enter the days earned per year', 'daysPerYear');
      if ((input.seniorDaysPerYear != null) !== (input.seniorAfterYears != null)) {
        throw new GuardFailedError('SENIORITY', 'enter both the senior days and the years of service, or neither', 'seniorAfterYears');
      }
    }
    if (input.payTiers?.length) {
      if (input.payTiers.some((t) => t.days <= 0 || t.percent < 0 || t.percent > 100)) throw new GuardFailedError('BAD_TIERS', 'each pay step needs days and a percent from 0 to 100', 'payTiers');
    }
  }

  private typeData(input: LeaveTypeInput) {
    const accrues = input.balanceMode === 'ACCRUAL';
    return {
      code: input.code.trim().toUpperCase(),
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn.trim(),
      color: input.color ?? null,
      paidPercent: input.paidPercent,
      balanceMode: input.balanceMode,
      accrual: accrues ? (input.accrual ?? 'MONTHLY') : null,
      daysPerYear: accrues ? (input.daysPerYear ?? null) : null,
      seniorDaysPerYear: accrues ? (input.seniorDaysPerYear ?? null) : null,
      seniorAfterYears: accrues ? (input.seniorAfterYears ?? null) : null,
      carryForwardMax: accrues ? (input.carryForwardMax ?? null) : null,
      yearlyLimit: input.yearlyLimit ?? null,
      payTiers: input.payTiers?.length ? (input.payTiers as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      maxPerRequest: input.maxPerRequest ?? null,
      oncePerService: input.oncePerService ?? false,
      minServiceMonths: input.minServiceMonths ?? null,
      gender: input.gender,
      countMode: input.countMode,
      allowHalfDay: input.allowHalfDay ?? false,
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
  }

  async createType(companyId: string, input: LeaveTypeInput, actor: Actor) {
    this.validateType(input);
    const data = this.typeData(input);
    if (await this.db.leaveType.findUnique({ where: { companyId_code: { companyId, code: data.code } } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a leave type with code ${data.code} already exists`, 'code');
    }
    const row = await this.db.leaveType.create({ data: { ...data, companyId } });
    await this.log(companyId, actor, 'LEAVE_TYPE', row.id, 'LEAVE_TYPE_CREATED', { code: row.code });
    return row;
  }

  async updateType(companyId: string, id: string, input: LeaveTypeInput, actor: Actor) {
    const existing = await this.db.leaveType.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundError('leave type', id);
    this.validateType(input);
    const data = this.typeData(input);
    // A seeded type keeps its code: other parts of the system may look for it.
    if (existing.system) data.code = existing.code;
    if (data.code !== existing.code && (await this.db.leaveType.findUnique({ where: { companyId_code: { companyId, code: data.code } } }))) {
      throw new GuardFailedError('DUPLICATE_CODE', `a leave type with code ${data.code} already exists`, 'code');
    }
    if (existing.balanceMode === 'ACCRUAL' && data.balanceMode !== 'ACCRUAL' && (await this.db.leaveLedgerEntry.count({ where: { leaveTypeId: id } }))) {
      throw new GuardFailedError('HAS_BALANCES', 'people already hold balances of this type — switch it off and create a new one instead', 'balanceMode');
    }
    const row = await this.db.leaveType.update({ where: { id }, data });
    await this.log(companyId, actor, 'LEAVE_TYPE', id, 'LEAVE_TYPE_UPDATED', { code: row.code });
    return row;
  }

  async deleteType(companyId: string, id: string, actor: Actor) {
    const existing = await this.db.leaveType.findFirst({ where: { id, companyId }, include: { _count: { select: { requests: true, ledger: true } } } });
    if (!existing) throw new NotFoundError('leave type', id);
    if (existing.system) throw new GuardFailedError('SYSTEM_TYPE', 'a built-in leave type can be switched off, not deleted');
    if (existing._count.requests || existing._count.ledger) throw new GuardFailedError('TYPE_IN_USE', 'this type has requests or balances — switch it off instead');
    await this.db.leaveType.delete({ where: { id } });
    await this.log(companyId, actor, 'LEAVE_TYPE', id, 'LEAVE_TYPE_DELETED', { code: existing.code });
  }

  // ─────────────────────────────────────────────────────────── balances

  private async balanceOf(employeeId: string, leaveTypeId: string, upTo?: Date) {
    const agg = await this.db.leaveLedgerEntry.aggregate({
      where: { employeeId, leaveTypeId, ...(upTo ? { date: { lte: upTo } } : {}) },
      _sum: { days: true },
    });
    return r2(num(agg._sum.days) ?? 0);
  }

  /** Days of a type requested (pending) or taken (approved) by someone in a calendar year. */
  private async daysInYear(employeeId: string, leaveTypeId: string, year: number, statuses: string[], excludeId?: string) {
    const agg = await this.db.leaveRequest.aggregate({
      where: {
        employeeId,
        leaveTypeId,
        status: { in: statuses },
        startDate: { gte: dayValue(`${year}-01-01`), lte: dayValue(`${year}-12-31`) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { days: true },
    });
    return r2(num(agg._sum.days) ?? 0);
  }

  /**
   * Where someone stands per active type: the balance (accruing types) or
   * the days used of the yearly limit, plus what is still waiting.
   */
  async balances(companyId: string, employeeId: string) {
    const types = (await this.listTypes(companyId)).filter((t) => t.active);
    const year = Number(localDay(await this.timezone(companyId)).slice(0, 4));
    return Promise.all(
      types.map(async (t) => ({
        leaveTypeId: t.id,
        code: t.code,
        nameAr: t.nameAr,
        nameEn: t.nameEn,
        color: t.color,
        balanceMode: t.balanceMode,
        balance: t.balanceMode === 'ACCRUAL' ? await this.balanceOf(employeeId, t.id) : null,
        usedThisYear: await this.daysInYear(employeeId, t.id, year, ['APPROVED']),
        pending: await this.daysInYear(employeeId, t.id, year, ['PENDING']),
        yearlyLimit: t.yearlyLimit,
      })),
    );
  }

  // ─────────────────────────────────────────────────────────── requests

  /**
   * Work out a leave without saving it: the days it takes, how they are paid
   * and what would be left — plus every rule it breaks, as a GuardFailedError.
   */
  async evaluate(companyId: string, employeeId: string, input: LeaveInput, excludeId?: string) {
    if (!DAY_RE.test(input.startDate)) throw new GuardFailedError('BAD_DATE', 'pick the first day', 'startDate');
    if (!DAY_RE.test(input.endDate)) throw new GuardFailedError('BAD_DATE', 'pick the last day', 'endDate');
    if (input.endDate < input.startDate) throw new GuardFailedError('END_BEFORE_START', 'the last day is before the first day', 'endDate');
    if ((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000 > 366) throw new GuardFailedError('TOO_LONG', 'one request covers at most a year', 'endDate');
    const type = await this.db.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId } });
    if (!type || !type.active) throw new GuardFailedError('BAD_LEAVE_TYPE', 'pick an active leave type', 'leaveTypeId');
    const employee = await this.db.employee.findFirst({ where: { id: employeeId, companyId }, select: { status: true, gender: true, hireDate: true } });
    if (!employee) throw new NotFoundError('employee', employeeId);
    if (employee.status !== 'ACTIVE') throw new GuardFailedError('NOT_ACTIVE', 'leave is for active employees');
    if (employee.hireDate && input.startDate < dayOf(employee.hireDate)) {
      throw new GuardFailedError('BEFORE_HIRE', `employment starts on ${dayOf(employee.hireDate)}`, 'startDate');
    }
    if (type.gender !== 'ANY' && employee.gender && employee.gender !== type.gender) {
      throw new GuardFailedError('WRONG_GENDER', 'this leave type does not apply to this employee', 'leaveTypeId');
    }
    if (input.halfDay && (!type.allowHalfDay || input.startDate !== input.endDate)) {
      throw new GuardFailedError('NO_HALF_DAY', 'a half day is a single day of a type that allows it', 'halfDay');
    }
    if (type.minServiceMonths && (!employee.hireDate || serviceMonths(employee.hireDate, dayValue(input.startDate)) < type.minServiceMonths)) {
      throw new GuardFailedError('NOT_ENOUGH_SERVICE', `needs ${type.minServiceMonths} months of service first`, 'leaveTypeId');
    }
    if (type.oncePerService && (await this.db.leaveRequest.count({ where: { employeeId, leaveTypeId: type.id, status: 'APPROVED', ...(excludeId ? { id: { not: excludeId } } : {}) } }))) {
      throw new GuardFailedError('ONCE_ONLY', 'this leave is taken once in the whole employment', 'leaveTypeId');
    }
    const overlap = await this.db.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: dayValue(input.endDate) },
        endDate: { gte: dayValue(input.startDate) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (overlap) throw new GuardFailedError('LEAVE_OVERLAP', `another leave already covers ${dayOf(overlap.startDate)} – ${dayOf(overlap.endDate)}`, 'startDate');

    const [schedule, cal] = await Promise.all([
      this.schedule.resolve(companyId, employeeId, input.startDate, input.endDate),
      this.calendar.getCalendar(companyId),
    ]);
    const days = countLeaveDays(schedule, type.countMode as CountMode, cal.weekendDays, !!input.halfDay);
    if (days <= 0) throw new GuardFailedError('NO_WORKING_DAYS', 'these dates contain no working day', 'endDate');
    if (type.maxPerRequest && days > type.maxPerRequest) throw new GuardFailedError('TOO_MANY_DAYS', `at most ${type.maxPerRequest} days at a time`, 'endDate');

    const year = Number(input.startDate.slice(0, 4));
    const takenBefore = await this.daysInYear(employeeId, type.id, year, ['APPROVED'], excludeId);
    const pendingOther = await this.daysInYear(employeeId, type.id, year, ['PENDING'], excludeId);
    if (type.yearlyLimit && takenBefore + pendingOther + days > type.yearlyLimit) {
      throw new GuardFailedError('YEARLY_LIMIT', `at most ${type.yearlyLimit} days a year (${r2(takenBefore + pendingOther)} already used or requested)`, 'endDate');
    }
    let balanceAfter: number | null = null;
    if (type.balanceMode === 'ACCRUAL') {
      const balance = await this.balanceOf(employeeId, type.id);
      balanceAfter = r2(balance - pendingOther - days);
      if (balanceAfter < 0) throw new GuardFailedError('INSUFFICIENT_BALANCE', `only ${r2(balance - pendingOther)} days available`, 'endDate');
    }
    return { type, days, takenBefore, balanceAfter, pay: payBreakdown(days, takenBefore, type.payTiers as PayTier[] | null, type.paidPercent) };
  }

  /** Staff enter a leave for an employee; it waits for an approver. */
  async request(companyId: string, employeeId: string, input: LeaveInput, actor: Actor) {
    const e = await this.evaluate(companyId, employeeId, input);
    const row = await this.db.leaveRequest.create({
      data: {
        companyId,
        employeeId,
        leaveTypeId: e.type.id,
        startDate: dayValue(input.startDate),
        endDate: dayValue(input.endDate),
        halfDay: !!input.halfDay,
        days: e.days,
        payBreakdown: e.pay as unknown as Prisma.InputJsonValue,
        reason: input.reason?.trim() || null,
        requestedById: actor.id ?? null,
      },
    });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'LEAVE_REQUESTED', { type: e.type.code, from: input.startDate, to: input.endDate, days: e.days }, employeeId);
    return row;
  }

  /**
   * Approve (re-checks every rule, takes the days off the balance and marks
   * the attendance days) or reject. The approver is recorded.
   */
  async decide(companyId: string, id: string, approve: boolean, note: string | undefined, actor: Actor, scope: EmployeeScope | undefined) {
    const r = await this.db.leaveRequest.findFirst({ where: { id, companyId, ...(scope ? { employee: scope } : {}) }, include: { leaveType: true } });
    if (!r) throw new NotFoundError('leave request', id);
    if (r.status !== 'PENDING') throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
    const now = new Date();
    if (!approve) {
      const moved = await this.db.leaveRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'REJECTED', decidedById: actor.id ?? null, decidedAt: now, decisionNote: note?.trim() || null },
      });
      if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
      await this.log(companyId, actor, 'EMPLOYEE', r.employeeId, 'LEAVE_REJECTED', { type: r.leaveType.code, from: dayOf(r.startDate), to: dayOf(r.endDate) }, r.employeeId);
      return this.db.leaveRequest.findUniqueOrThrow({ where: { id } });
    }
    // The world may have moved since it was entered (balance used, schedule changed).
    const e = await this.evaluate(companyId, r.employeeId, { leaveTypeId: r.leaveTypeId, startDate: dayOf(r.startDate), endDate: dayOf(r.endDate), halfDay: r.halfDay }, r.id);
    await this.db.$transaction(async (tx) => {
      const moved = await tx.leaveRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          days: e.days,
          payBreakdown: e.pay as unknown as Prisma.InputJsonValue,
          decidedById: actor.id ?? null,
          decidedAt: now,
          decisionNote: note?.trim() || null,
        },
      });
      if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
      if (r.leaveType.balanceMode === 'ACCRUAL') {
        await tx.leaveLedgerEntry.create({
          data: { companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, kind: 'USE', days: -e.days, date: r.startDate, requestId: r.id, createdById: actor.id ?? null },
        });
      }
    });
    await this.log(companyId, actor, 'EMPLOYEE', r.employeeId, 'LEAVE_APPROVED', { type: r.leaveType.code, from: dayOf(r.startDate), to: dayOf(r.endDate), days: e.days }, r.employeeId);
    await this.attendance?.recompute(companyId, [r.employeeId], dayOf(r.startDate), dayOf(r.endDate));
    return this.db.leaveRequest.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Cancel: a waiting request is simply withdrawn; an approved one gives its
   * days back (REVERSAL) unless payroll has already used one of its days.
   */
  async cancel(companyId: string, employeeId: string, id: string, actor: Actor) {
    const r = await this.db.leaveRequest.findFirst({ where: { id, employeeId, companyId }, include: { leaveType: true } });
    if (!r) throw new NotFoundError('leave request', id);
    if (!['PENDING', 'APPROVED'].includes(r.status)) throw new GuardFailedError('ALREADY_DECIDED', 'this request is already closed');
    if (r.status === 'APPROVED') {
      const locked = await this.db.attendanceDay.count({ where: { employeeId, locked: true, date: { gte: r.startDate, lte: r.endDate } } });
      if (locked) throw new GuardFailedError('DAY_LOCKED', 'part of this leave is already in a payroll run');
    }
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      const moved = await tx.leaveRequest.updateMany({
        where: { id, status: r.status },
        data: { status: 'CANCELLED', cancelledById: actor.id ?? null, cancelledAt: now },
      });
      if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request changed meanwhile — reload and try again');
      if (r.status === 'APPROVED' && r.leaveType.balanceMode === 'ACCRUAL') {
        await tx.leaveLedgerEntry.create({
          data: { companyId, employeeId, leaveTypeId: r.leaveTypeId, kind: 'REVERSAL', days: r.days, date: r.startDate, requestId: r.id, createdById: actor.id ?? null },
        });
      }
    });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'LEAVE_CANCELLED', { type: r.leaveType.code, from: dayOf(r.startDate), to: dayOf(r.endDate), wasApproved: r.status === 'APPROVED' }, employeeId);
    if (r.status === 'APPROVED') await this.attendance?.recompute(companyId, [employeeId], dayOf(r.startDate), dayOf(r.endDate));
  }

  /** HR corrects a balance — e.g. the opening balance at go-live. */
  async adjust(companyId: string, employeeId: string, input: { leaveTypeId: string; days: number; date?: string | undefined; note: string }, actor: Actor) {
    const type = await this.db.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId } });
    if (!type || type.balanceMode !== 'ACCRUAL') throw new GuardFailedError('BAD_LEAVE_TYPE', 'only a type with a balance can be adjusted', 'leaveTypeId');
    if (!input.days || Math.abs(input.days) > 400) throw new GuardFailedError('BAD_DAYS', 'enter the days to add (or remove, with a minus)', 'days');
    const employee = await this.db.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
    if (!employee) throw new NotFoundError('employee', employeeId);
    const date = input.date ?? localDay(await this.timezone(companyId));
    const row = await this.db.leaveLedgerEntry.create({
      data: { companyId, employeeId, leaveTypeId: type.id, kind: 'ADJUSTMENT', days: r2(input.days), date: dayValue(date), note: input.note.trim(), createdById: actor.id ?? null },
    });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'LEAVE_BALANCE_ADJUSTED', { type: type.code, days: r2(input.days), note: input.note.trim() }, employeeId);
    return row;
  }

  // ─────────────────────────────────────────────────────────── reading

  /** The leave tab of the employee file: balances, requests, and the ledger of the accruing types. */
  async person(companyId: string, employeeId: string) {
    const [balances, requests, ledger] = await Promise.all([
      this.balances(companyId, employeeId),
      this.db.leaveRequest.findMany({ where: { employeeId }, include: { leaveType: { select: { code: true, nameAr: true, nameEn: true, color: true } } }, orderBy: { startDate: 'desc' }, take: 100 }),
      this.db.leaveLedgerEntry.findMany({ where: { employeeId }, include: { leaveType: { select: { code: true, nameAr: true, nameEn: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 }),
    ]);
    const names = await this.userNames([...requests.flatMap((r) => [r.requestedById, r.decidedById, r.cancelledById]), ...ledger.map((l) => l.createdById)]);
    return {
      balances,
      requests: requests.map((r) => ({ ...r, requestedBy: names.get(r.requestedById ?? '') ?? null, decidedBy: names.get(r.decidedById ?? '') ?? null, cancelledBy: names.get(r.cancelledById ?? '') ?? null })),
      ledger: ledger.map((l) => ({ ...l, createdBy: names.get(l.createdById ?? '') ?? null })),
    };
  }

  /** Requests across the company (scoped), newest first. */
  async list(
    companyId: string,
    scope: EmployeeScope | undefined,
    q: { status?: string | undefined; leaveTypeId?: string | undefined; from?: string | undefined; to?: string | undefined; orgUnitPath?: string | undefined; q?: string | undefined; page: number; limit: number },
  ) {
    const employee: Prisma.EmployeeWhereInput = {
      AND: [
        scope ?? { companyId },
        ...(q.orgUnitPath ? [{ orgUnit: { path: { startsWith: q.orgUnitPath } } }] : []),
        ...(q.q ? [{ OR: [{ firstName: { contains: q.q } }, { lastName: { contains: q.q } }, { employeeNo: { contains: q.q } }] }] : []),
      ],
    };
    const where: Prisma.LeaveRequestWhereInput = {
      companyId,
      employee,
      ...(q.status ? { status: q.status } : {}),
      ...(q.leaveTypeId ? { leaveTypeId: q.leaveTypeId } : {}),
      ...(q.from ? { endDate: { gte: dayValue(q.from) } } : {}),
      ...(q.to ? { startDate: { lte: dayValue(q.to) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.leaveRequest.findMany({
        where,
        include: {
          leaveType: { select: { code: true, nameAr: true, nameEn: true, color: true, balanceMode: true } },
          employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.leaveRequest.count({ where }),
    ]);
    const names = await this.userNames(rows.flatMap((r) => [r.requestedById, r.decidedById]));
    // The balance the approver needs next to a waiting request.
    const balances = new Map<string, number>();
    for (const r of rows) {
      if (r.status === 'PENDING' && r.leaveType.balanceMode === 'ACCRUAL') {
        balances.set(r.id, await this.balanceOf(r.employeeId, r.leaveTypeId));
      }
    }
    return {
      total,
      items: rows.map((r) => ({
        ...r,
        requestedBy: names.get(r.requestedById ?? '') ?? null,
        decidedBy: names.get(r.decidedById ?? '') ?? null,
        balance: balances.get(r.id) ?? null,
      })),
    };
  }

  async pendingCount(companyId: string, scope: EmployeeScope | undefined) {
    return { pending: await this.db.leaveRequest.count({ where: { companyId, status: 'PENDING', ...(scope ? { employee: scope } : {}) } }) };
  }

  private async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (want.length === 0) return new Map();
    const rows = await this.db.user.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Approved leave of these people that touches [from, to] — attendance marks those days LEAVE. */
  approvedBetween(employeeIds: string[], from: string, to: string) {
    return this.db.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { lte: dayValue(to) }, endDate: { gte: dayValue(from) } },
      select: { employeeId: true, startDate: true, endDate: true, halfDay: true, leaveType: { select: { code: true } } },
    });
  }

  // ─────────────────────────────────────────────────────────── accrual

  /**
   * The scheduler's job (hourly, cheap when there is nothing to do): accrue
   * every completed month since the type was set up, give yearly types their
   * days on 1 January, and at the turn of the year expire what exceeds the
   * carry-forward cap. Every entry carries a period key, so running twice —
   * or catching up after downtime — never counts a month twice.
   */
  async accrue(now = new Date()): Promise<number> {
    const hour = now.toISOString().slice(0, 13);
    if (hour === this.lastAutoRun) return 0;
    this.lastAutoRun = hour;
    let written = 0;
    const types = await this.db.leaveType.findMany({ where: { active: true, balanceMode: 'ACCRUAL' } });
    const byCompany = new Map<string, LeaveType[]>();
    for (const t of types) byCompany.set(t.companyId, [...(byCompany.get(t.companyId) ?? []), t]);
    for (const [companyId, list] of byCompany) {
      const today = localDay(await this.timezone(companyId), now);
      const people = await this.db.employee.findMany({ where: { companyId, status: 'ACTIVE', hireDate: { not: null } }, select: { id: true, hireDate: true } });
      for (const t of list) {
        for (const p of people) written += await this.accrueOne(t, p.id, p.hireDate!, today);
      }
    }
    return written;
  }

  private async entry(t: LeaveType, employeeId: string, kind: string, days: number, date: string, periodKey: string, note: string) {
    if (days === 0) return 0;
    try {
      await this.db.leaveLedgerEntry.create({ data: { companyId: t.companyId, employeeId, leaveTypeId: t.id, kind, days, date: dayValue(date), periodKey, note } });
      return 1;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return 0;
      throw err;
    }
  }

  /** One person, one type: everything due up to today. */
  async accrueOne(t: LeaveType, employeeId: string, hireDate: Date, today: string): Promise<number> {
    let written = 0;
    const setUp = dayOf(t.createdAt);
    const yearly = { daysPerYear: num(t.daysPerYear), seniorDaysPerYear: num(t.seniorDaysPerYear), seniorAfterYears: t.seniorAfterYears };
    if (t.accrual === 'MONTHLY') {
      // Completed months only, from the later of set-up and hire — earlier service is the opening balance's job.
      const first = [setUp.slice(0, 7), dayOf(hireDate).slice(0, 7)].sort()[1]!;
      const last = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
      if (first <= last) {
        const existing = new Set(
          (await this.db.leaveLedgerEntry.findMany({ where: { employeeId, leaveTypeId: t.id, kind: 'ACCRUAL' }, select: { periodKey: true } })).map((e) => e.periodKey),
        );
        for (const month of monthsBetween(first, last)) {
          if (existing.has(month)) continue;
          const monthEnd = addDays(`${nextMonth(month)}-01`, -1);
          const amount = monthlyAccrual(yearlyEntitlement(yearly, hireDate, dayValue(monthEnd)), month, hireDate);
          written += await this.entry(t, employeeId, 'ACCRUAL', amount, monthEnd, month, `${month}`);
        }
      }
    } else if (t.accrual === 'YEARLY') {
      const year = today.slice(0, 4);
      const hired = dayOf(hireDate);
      // Not for the year the type was set up (the opening balance covers it), unless hired after that.
      if (year > setUp.slice(0, 4) || hired > setUp) {
        const from = hired > `${year}-01-01` ? hired : `${year}-01-01`;
        if (from <= today) {
          const share = (Date.parse(`${year}-12-31`) - Date.parse(from)) / 86_400_000 + 1;
          const amount = r2(yearlyEntitlement(yearly, hireDate, dayValue(from)) * (share / daysInYear(Number(year))));
          written += await this.entry(t, employeeId, 'ACCRUAL', amount, from, year, `${year}`);
        }
      }
    }
    // The turn of the year: what exceeds the carry-forward cap expires.
    const cap = num(t.carryForwardMax);
    const prevYear = String(Number(today.slice(0, 4)) - 1);
    if (cap != null && prevYear >= setUp.slice(0, 4)) {
      const balance = await this.balanceOf(employeeId, t.id, dayValue(`${prevYear}-12-31`));
      const already = await this.db.leaveLedgerEntry.count({ where: { employeeId, leaveTypeId: t.id, kind: 'EXPIRY', periodKey: `${prevYear}-carry` } });
      if (!already && balance > cap) {
        written += await this.entry(t, employeeId, 'EXPIRY', -r2(balance - cap), `${today.slice(0, 4)}-01-01`, `${prevYear}-carry`, `over the carry-forward cap of ${cap}`);
      }
    }
    return written;
  }
}

const daysInYear = (y: number) => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86_400_000;

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
