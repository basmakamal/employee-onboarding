import type { AttendanceDay, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { EmployeeScope } from '../../auth/authz/authorize.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { localDay } from '../employees/employment-history.service.js';
import type { ScheduleService } from './schedule.service.js';
import { addDays, assignPunches, isFinished, judgeDay, withLeave, zonedInstant, type DayResult, type PunchKind } from './attendance-calc.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOUR = 3_600_000;
const dayValue = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const isDuplicate = (err: unknown) => (err as { code?: string } | null)?.code === 'P2002';

export type Decision = 'CONFIRMED' | 'EXCUSED';

/** What staff enter for one day: the clock-in, the clock-out, or both (local times). */
export interface PunchInput {
  date: string;
  inTime?: string | undefined;
  outTime?: string | undefined;
  note?: string | undefined;
}
export interface OvertimeInput {
  date: string;
  minutes: number;
  reason: string;
}

/** The fields a recalculation compares before deciding a reviewed day needs a new look. */
const SAME = (a: Pick<AttendanceDay, 'status' | 'workedMinutes' | 'lateMinutes' | 'earlyLeaveMinutes' | 'overtimeMinutes'>, b: DayResult) =>
  a.status === b.status &&
  a.workedMinutes === b.workedMinutes &&
  a.lateMinutes === b.lateMinutes &&
  a.earlyLeaveMinutes === b.earlyLeaveMinutes &&
  a.overtimeMinutes === b.overtimeMinutes;

/**
 * Attendance: punches in, judged days out.
 *
 * Employees do not use the platform: staff record the in / out times on the
 * employee file (source MANUAL) until a biometric device feeds the same
 * table. Days are recalculated from the punches against the schedule in
 * force that day until payroll locks them; an exception (absent, late,
 * early, missing punch) waits for HR, and only a CONFIRMED one may be
 * deducted. Overtime is paid only once approved by the branch manager, the
 * company manager or the super admin (attendance.approve, within their
 * scope) - the approver is always recorded.
 */
export class AttendanceService {
  private lastAutoRun = '';

  constructor(
    private readonly db: PrismaClient,
    private readonly schedule: ScheduleService,
    private readonly audit: AuditLogRepository,
  ) {}

  private log(companyId: string, actor: Actor, employeeId: string, action: string, metadata: Record<string, string | number | boolean | null>) {
    return this.audit.append({
      entity: 'EMPLOYEE',
      entityId: employeeId,
      action,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId,
      companyId,
      metadata,
    });
  }

  async timezone(companyId: string): Promise<string> {
    const c = await this.db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return c?.timezone ?? 'Asia/Riyadh';
  }

  // ─────────────────────────────────────────────────────────── judging

  /**
   * Recalculate the days [from, to] of these people from their punches.
   * Only days whose window has closed are written; locked days never
   * change; a reviewed day keeps its decision unless the result changed.
   */
  async recompute(companyId: string, employeeIds: string[], from: string, to: string, now = new Date()): Promise<number> {
    if (employeeIds.length === 0) return 0;
    const tz = await this.timezone(companyId);
    // A day's punches may sit in the evening before or the morning after.
    const schedules = await this.schedule.resolveMany(companyId, employeeIds, addDays(from, -1), addDays(to, 1));
    const events = await this.db.attendanceEvent.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        at: { gte: zonedInstant(addDays(from, -1), '00:00', tz), lt: zonedInstant(addDays(to, 2), '00:00', tz) },
      },
      select: { employeeId: true, kind: true, at: true },
      orderBy: { at: 'asc' },
    });
    const existing = await this.db.attendanceDay.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: dayValue(from), lte: dayValue(to) } },
    });
    const existingOf = new Map(existing.map((d) => [`${d.employeeId}:${dayOf(d.date)}`, d]));
    // Approved leave turns a working day into LEAVE (or excuses half of it).
    const leaves = await this.db.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { lte: dayValue(to) }, endDate: { gte: dayValue(from) } },
      select: { employeeId: true, startDate: true, endDate: true, halfDay: true, leaveType: { select: { code: true } } },
    });

    let written = 0;
    for (const employeeId of employeeIds) {
      const days = schedules.get(employeeId) ?? [];
      const mine = events.filter((e) => e.employeeId === employeeId).map((e) => ({ kind: e.kind as PunchKind, at: e.at }));
      const byDay = assignPunches(days, mine, tz);
      for (const day of days) {
        if (day.date < from || day.date > to || !isFinished(day, tz, now)) continue;
        const punches = byDay.get(day.date) ?? [];
        const prev = existingOf.get(`${employeeId}:${day.date}`);
        if (prev?.locked) continue;
        // No schedule and no punches: nothing to record.
        if (!day.assignmentId && !day.holiday && punches.length === 0 && !prev) continue;
        const leave = leaves.find((l) => l.employeeId === employeeId && dayOf(l.startDate) <= day.date && dayOf(l.endDate) >= day.date);
        const judged = judgeDay(day, punches, tz);
        const result = leave ? withLeave(judged, leave.halfDay) : judged;
        const leaveCode = leave && judged.scheduledMinutes > 0 ? leave.leaveType.code : null;
        const review = !result.exception ? 'NONE' : prev && SAME(prev, result) && prev.review !== 'NONE' ? prev.review : 'PENDING';
        if (prev && SAME(prev, result) && prev.review === review && prev.shiftCodes === result.shiftCodes && (prev.leaveCode ?? null) === leaveCode) continue;
        const data = {
          status: result.status,
          shiftCodes: result.shiftCodes,
          leaveCode,
          scheduledMinutes: result.scheduledMinutes,
          workedMinutes: result.workedMinutes,
          lateMinutes: result.lateMinutes,
          earlyLeaveMinutes: result.earlyLeaveMinutes,
          overtimeMinutes: result.overtimeMinutes,
          firstIn: result.firstIn,
          lastOut: result.lastOut,
          review,
          ...(review !== prev?.review ? { reviewedById: null, reviewedAt: null, reviewNote: null } : {}),
          computedAt: now,
        };
        await this.db.attendanceDay.upsert({
          where: { employeeId_date: { employeeId, date: dayValue(day.date) } },
          create: { companyId, employeeId, date: dayValue(day.date), ...data },
          update: data,
        });
        written += 1;
      }
    }
    return written;
  }

  /**
   * The scheduler's job: once an hour, judge the last three local days of
   * every active employee (and anyone who punched) in every company.
   */
  async recomputeRecent(now = new Date()): Promise<number> {
    const hour = now.toISOString().slice(0, 13);
    if (hour === this.lastAutoRun) return 0;
    this.lastAutoRun = hour;
    let total = 0;
    const companies = await this.db.company.findMany({ select: { id: true, timezone: true } });
    for (const c of companies) {
      const today = localDay(c.timezone ?? 'Asia/Riyadh', now);
      const from = addDays(today, -2);
      const people = await this.db.employee.findMany({
        where: {
          companyId: c.id,
          OR: [{ status: 'ACTIVE' }, { attendanceEvents: { some: { at: { gte: new Date(now.getTime() - 96 * HOUR) } } } }],
        },
        select: { id: true },
      });
      const ids = people.map((p) => p.id);
      for (let i = 0; i < ids.length; i += 200) {
        total += await this.recompute(c.id, ids.slice(i, i + 200), from, today, now);
      }
    }
    return total;
  }

  // ─────────────────────────────────────────────────────────── reading

  listEvents(employeeId: string, fromAt: Date, toAt: Date) {
    return this.db.attendanceEvent.findMany({
      where: { employeeId, at: { gte: fromAt, lt: toAt } },
      orderBy: { at: 'asc' },
      select: { id: true, kind: true, at: true, source: true, note: true, createdById: true },
    });
  }

  /** One person's days, punches and requests over a period (employee tab / My attendance). */
  async personPeriod(companyId: string, employeeId: string, from: string, to: string) {
    const tz = await this.timezone(companyId);
    const [days, events, schedule, overtime] = await Promise.all([
      this.db.attendanceDay.findMany({ where: { employeeId, date: { gte: dayValue(from), lte: dayValue(to) } }, orderBy: { date: 'desc' } }),
      this.listEvents(employeeId, zonedInstant(from, '00:00', tz), zonedInstant(addDays(to, 1), '12:00', tz)),
      this.schedule.resolve(companyId, employeeId, from, to),
      this.db.overtimeRequest.findMany({ where: { employeeId, date: { gte: dayValue(from), lte: dayValue(to) } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const names = await this.userNames([
      ...days.map((d) => d.reviewedById),
      ...events.map((e) => e.createdById),
      ...overtime.flatMap((o) => [o.decidedById, o.requestedById]),
    ]);
    return {
      timezone: tz,
      schedule,
      days: days.map((d) => ({ ...d, reviewedBy: names.get(d.reviewedById ?? '') ?? null })),
      events: events.map((e) => ({ ...e, createdBy: names.get(e.createdById ?? '') ?? null })),
      overtime: overtime.map((o) => ({ ...o, decidedBy: names.get(o.decidedById ?? '') ?? null, requestedBy: names.get(o.requestedById ?? '') ?? null })),
    };
  }

  async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (want.length === 0) return new Map();
    const rows = await this.db.user.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ─────────────────────────────────────────────────────────── review

  /**
   * HR's decision on an exception: CONFIRMED (payroll may deduct it) or
   * EXCUSED (it is waived). Allowed until payroll locks the day.
   */
  async review(companyId: string, dayIds: string[], decision: Decision, note: string | undefined, actor: Actor, scope: EmployeeScope | undefined) {
    const days = await this.db.attendanceDay.findMany({
      where: { id: { in: dayIds }, companyId, ...(scope ? { employee: scope } : {}) },
    });
    if (days.length !== dayIds.length) throw new NotFoundError('attendance day', dayIds.find((id) => !days.some((d) => d.id === id)) ?? '');
    for (const d of days) {
      if (d.locked) throw new GuardFailedError('DAY_LOCKED', `${dayOf(d.date)} is already in a payroll run`);
      if (d.review === 'NONE') throw new GuardFailedError('NOTHING_TO_REVIEW', `${dayOf(d.date)} has no exception to review`);
    }
    const now = new Date();
    for (const d of days) {
      await this.db.attendanceDay.update({
        where: { id: d.id },
        data: { review: decision, reviewedById: actor.id ?? null, reviewedAt: now, reviewNote: note?.trim() || null },
      });
      await this.log(companyId, actor, d.employeeId, decision === 'CONFIRMED' ? 'ATTENDANCE_CONFIRMED' : 'ATTENDANCE_EXCUSED', {
        date: dayOf(d.date), status: d.status, late: d.lateMinutes, early: d.earlyLeaveMinutes,
      });
    }
    return days.length;
  }

  // ─────────────────────────────────────────────────────────── recording

  private async notFuture(companyId: string, date: string, now = new Date()) {
    if (!DAY_RE.test(date)) throw new GuardFailedError('BAD_DATE', 'pick a date', 'date');
    if (date > localDay(await this.timezone(companyId), now)) throw new GuardFailedError('FUTURE_DATE', 'that day has not happened yet', 'date');
  }

  private async lockedDay(employeeId: string, date: string) {
    const day = await this.db.attendanceDay.findUnique({ where: { employeeId_date: { employeeId, date: dayValue(date) } }, select: { locked: true } });
    return !!day?.locked;
  }

  /**
   * Staff record a day's clock-in and / or clock-out (local times). The
   * clock-out lands on the next morning when it is earlier than the
   * clock-in - or, alone, earlier than the start of that day's overnight
   * shift. The day is judged again straight away.
   */
  async recordPunches(companyId: string, employeeId: string, input: PunchInput, actor: Actor, now = new Date()) {
    await this.notFuture(companyId, input.date, now);
    if (!input.inTime && !input.outTime) throw new GuardFailedError('NEEDS_TIME', 'enter the clock-in time, the clock-out time, or both', 'inTime');
    if (input.inTime && !TIME_RE.test(input.inTime)) throw new GuardFailedError('BAD_TIME', 'use a time like 08:00', 'inTime');
    if (input.outTime && !TIME_RE.test(input.outTime)) throw new GuardFailedError('BAD_TIME', 'use a time like 17:00', 'outTime');
    const employee = await this.db.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
    if (!employee) throw new NotFoundError('employee', employeeId);
    if (await this.lockedDay(employeeId, input.date)) throw new GuardFailedError('DAY_LOCKED', 'this day is already in a payroll run', 'date');

    const tz = await this.timezone(companyId);
    const [day] = await this.schedule.resolve(companyId, employeeId, input.date, input.date);
    const first = day?.shifts[0];
    const punches: Array<{ kind: PunchKind; at: Date; field: string }> = [];
    if (input.inTime) punches.push({ kind: 'IN', at: zonedInstant(input.date, input.inTime, tz), field: 'inTime' });
    if (input.outTime) {
      const nextDay = input.inTime ? input.outTime <= input.inTime : !!first && first.overnight && input.outTime < first.startTime;
      punches.push({ kind: 'OUT', at: zonedInstant(nextDay ? addDays(input.date, 1) : input.date, input.outTime, tz), field: 'outTime' });
    }
    for (const p of punches) {
      if (p.at.getTime() > now.getTime()) throw new GuardFailedError('FUTURE_TIME', 'that time has not happened yet', p.field);
    }
    const note = input.note?.trim() || null;
    try {
      await this.db.$transaction(async (tx) => {
        for (const p of punches) {
          await tx.attendanceEvent.create({
            data: {
              companyId,
              employeeId,
              kind: p.kind,
              at: p.at,
              source: 'MANUAL',
              note,
              fingerprint: `manual:${employeeId}:${p.kind}:${Math.floor(p.at.getTime() / 60_000)}`,
              createdById: actor.id ?? null,
            },
          });
        }
      });
    } catch (err) {
      if (isDuplicate(err)) throw new GuardFailedError('DUPLICATE_PUNCH', 'this punch is already recorded', punches[0]!.field);
      throw err;
    }
    await this.log(companyId, actor, employeeId, 'ATTENDANCE_RECORDED', { date: input.date, in: input.inTime ?? null, out: input.outTime ?? null, note });
    await this.recompute(companyId, [employeeId], addDays(input.date, -1), addDays(input.date, 1), now);
    return { count: punches.length };
  }

  /** Remove a punch entered by mistake. Device and imported punches stay. */
  async deletePunch(companyId: string, employeeId: string, eventId: string, actor: Actor, now = new Date()) {
    const e = await this.db.attendanceEvent.findFirst({ where: { id: eventId, employeeId, companyId } });
    if (!e) throw new NotFoundError('punch', eventId);
    if (e.source !== 'MANUAL') throw new GuardFailedError('NOT_MANUAL', 'only punches entered by hand can be deleted');
    const date = localDay(await this.timezone(companyId), e.at);
    // The punch may belong to the day before (a night shift's clock-out).
    for (const d of [addDays(date, -1), date]) {
      if (await this.lockedDay(employeeId, d)) throw new GuardFailedError('DAY_LOCKED', 'this day is already in a payroll run');
    }
    await this.db.attendanceEvent.delete({ where: { id: e.id } });
    await this.log(companyId, actor, employeeId, 'ATTENDANCE_PUNCH_DELETED', { kind: e.kind, at: e.at.toISOString(), note: e.note });
    await this.recompute(companyId, [employeeId], addDays(date, -1), addDays(date, 1), now);
  }

  // ─────────────────────────────────────────────────────────── overtime

  /** Staff enter overtime for approval (before or after it is worked). */
  async requestOvertime(companyId: string, employeeId: string, input: OvertimeInput, actor: Actor) {
    if (!DAY_RE.test(input.date)) throw new GuardFailedError('BAD_DATE', 'pick a date', 'date');
    if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 720) {
      throw new GuardFailedError('BAD_MINUTES', 'between 1 minute and 12 hours', 'minutes');
    }
    if (await this.lockedDay(employeeId, input.date)) throw new GuardFailedError('DAY_LOCKED', 'this day is already in a payroll run', 'date');
    const open = await this.db.overtimeRequest.count({ where: { employeeId, date: dayValue(input.date), status: { in: ['PENDING', 'APPROVED'] } } });
    if (open) throw new GuardFailedError('DUPLICATE_REQUEST', 'there is already an overtime request for this day', 'date');
    const row = await this.db.overtimeRequest.create({
      data: {
        companyId,
        employeeId,
        date: dayValue(input.date),
        minutes: input.minutes,
        reason: input.reason.trim(),
        requestedById: actor.id ?? null,
      },
    });
    await this.log(companyId, actor, employeeId, 'OVERTIME_REQUESTED', { date: input.date, minutes: input.minutes });
    return row;
  }

  /** Approve all or part of the minutes, or reject. The approver is recorded. */
  async decideOvertime(companyId: string, id: string, approve: boolean, approvedMinutes: number | undefined, note: string | undefined, actor: Actor, scope: EmployeeScope | undefined) {
    const o = await this.db.overtimeRequest.findFirst({ where: { id, companyId, ...(scope ? { employee: scope } : {}) } });
    if (!o) throw new NotFoundError('overtime request', id);
    const minutes = approve ? (approvedMinutes ?? o.minutes) : null;
    if (minutes !== null && (minutes < 1 || minutes > o.minutes)) {
      throw new GuardFailedError('BAD_MINUTES', `approve between 1 and ${o.minutes} minutes`, 'approvedMinutes');
    }
    if (approve && (await this.lockedDay(o.employeeId, dayOf(o.date)))) throw new GuardFailedError('DAY_LOCKED', 'this day is already in a payroll run');
    const moved = await this.db.overtimeRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', approvedMinutes: minutes, decidedById: actor.id ?? null, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
    if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request has already been decided');
    await this.log(companyId, actor, o.employeeId, approve ? 'OVERTIME_APPROVED' : 'OVERTIME_REJECTED', { date: dayOf(o.date), minutes: minutes ?? 0 });
    return this.db.overtimeRequest.findUniqueOrThrow({ where: { id } });
  }

  /** An overtime request still waiting can be withdrawn (audited). */
  async cancelOvertime(companyId: string, employeeId: string, id: string, actor: Actor) {
    const moved = await this.db.overtimeRequest.updateMany({ where: { id, companyId, employeeId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (moved.count === 0) throw new GuardFailedError('ALREADY_DECIDED', 'this request is no longer waiting');
    await this.log(companyId, actor, employeeId, 'OVERTIME_CANCELLED', { request: id });
  }

  // ─────────────────────────────────────────────────────────── lists

  /** Days across the company (scoped), newest first, for the attendance register. */
  async listDays(
    companyId: string,
    scope: EmployeeScope | undefined,
    q: { from: string; to: string; orgUnitPath?: string | undefined; q?: string | undefined; status?: string | undefined; review?: string | undefined; page: number; limit: number },
  ) {
    const employee: Prisma.EmployeeWhereInput = {
      AND: [
        scope ?? { companyId },
        ...(q.orgUnitPath ? [{ orgUnit: { path: { startsWith: q.orgUnitPath } } }] : []),
        ...(q.q ? [{ OR: [{ firstName: { contains: q.q } }, { lastName: { contains: q.q } }, { employeeNo: { contains: q.q } }] }] : []),
      ],
    };
    const where: Prisma.AttendanceDayWhereInput = {
      companyId,
      date: { gte: dayValue(q.from), lte: dayValue(q.to) },
      employee,
      ...(q.status === 'LATE' ? { lateMinutes: { gt: 0 } } : q.status === 'EARLY' ? { earlyLeaveMinutes: { gt: 0 } } : q.status === 'OVERTIME' ? { overtimeMinutes: { gt: 0 } } : q.status ? { status: q.status } : {}),
      ...(q.review ? { review: q.review } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.attendanceDay.findMany({
        where,
        include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } } },
        orderBy: [{ date: 'desc' }, { employee: { firstName: 'asc' } }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.attendanceDay.count({ where }),
    ]);
    const names = await this.userNames(rows.map((r) => r.reviewedById));
    return { total, timezone: await this.timezone(companyId), items: rows.map((r) => ({ ...r, reviewedBy: names.get(r.reviewedById ?? '') ?? null })) };
  }

  /** Overtime requests across the company (scoped), newest first. */
  async listOvertime(companyId: string, scope: EmployeeScope | undefined, q: { status?: string | undefined; page: number; limit: number }) {
    const where = { companyId, ...(scope ? { employee: scope } : {}), ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.db.overtimeRequest.findMany({
        where,
        include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } } },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.db.overtimeRequest.count({ where }),
    ]);
    const names = await this.userNames(rows.flatMap((r) => [r.decidedById, r.requestedById]));
    // What the day itself recorded, so the approver sees the evidence next to the request.
    const days = rows.length === 0 ? [] : await this.db.attendanceDay.findMany({
      where: { OR: rows.map((r) => ({ employeeId: r.employeeId, date: r.date })) },
      select: { employeeId: true, date: true, status: true, firstIn: true, lastOut: true, workedMinutes: true, overtimeMinutes: true, shiftCodes: true },
    });
    return {
      total,
      timezone: await this.timezone(companyId),
      items: rows.map((r) => ({
        ...r,
        decidedBy: names.get(r.decidedById ?? '') ?? null,
        requestedBy: names.get(r.requestedById ?? '') ?? null,
        day: days.find((d) => d.employeeId === r.employeeId && d.date.getTime() === r.date.getTime()) ?? null,
      })),
    };
  }

  /** How many overtime requests wait for this approver. */
  async pendingCount(companyId: string, scope: EmployeeScope | undefined) {
    return { overtime: await this.db.overtimeRequest.count({ where: { companyId, status: 'PENDING', ...(scope ? { employee: scope } : {}) } }) };
  }
}

