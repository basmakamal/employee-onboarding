/**
 * Attendance: local times in the company time zone, which day a punch
 * belongs to (night shifts), how a day is judged (late, early, break,
 * overtime, absent, missing punch), and the service rules for staff-entered
 * punches, re-judging reviewed days and deciding overtime.
 */
import { describe, expect, it, vi } from 'vitest';
import { assignPunches, isFinished, judgeDay, zonedInstant, type Punch } from '../src/modules/workforce/attendance-calc.js';
import { AttendanceService } from '../src/modules/workforce/attendance.service.js';
import type { ScheduleDay } from '../src/modules/workforce/schedule.service.js';
import { GuardFailedError } from '../src/workflow/errors.js';

const TZ = 'Asia/Riyadh';
const at = (day: string, hhmm: string) => zonedInstant(day, hhmm, TZ);
const p = (kind: 'IN' | 'OUT', day: string, hhmm: string): Punch => ({ kind, at: at(day, hhmm) });

const MORNING = { id: 'sh-m', code: 'M', nameAr: 'ص', nameEn: 'Morning', kind: 'FIXED', startTime: '08:00', endTime: '16:00', breakMinutes: 60, graceMinutes: 15, requiredMinutes: null, color: null, overnight: false, minutes: 480 };
const NIGHT = { id: 'sh-n', code: 'N', nameAr: 'ل', nameEn: 'Night', kind: 'FIXED', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 10, requiredMinutes: null, color: null, overnight: true, minutes: 480 };
const FLEX = { ...MORNING, id: 'sh-f', code: 'F', kind: 'FLEXIBLE', startTime: '07:00', endTime: '19:00', minutes: 720, breakMinutes: 0, graceMinutes: 0, requiredMinutes: 480 };

function sched(date: string, shifts: ScheduleDay['shifts'], extra: Partial<ScheduleDay> = {}): ScheduleDay {
  return { date, assignmentId: 'a1', patternCode: 'P', temporary: false, shifts, rest: shifts.length === 0, holiday: null, ...extra };
}

describe('company time zone', () => {
  it('turns a Riyadh wall-clock time into the right instant (UTC+3)', () => {
    expect(at('2026-11-01', '08:00').toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(at('2026-11-01', '01:30').toISOString()).toBe('2026-10-31T22:30:00.000Z');
  });
});

describe('judging a day', () => {
  const day = sched('2026-11-01', [MORNING]);

  it('on time: the break comes off, a few minutes past the end are overtime', () => {
    const r = judgeDay(day, [p('IN', '2026-11-01', '07:58'), p('OUT', '2026-11-01', '16:05')], TZ);
    expect(r).toMatchObject({ status: 'PRESENT', scheduledMinutes: 420, workedMinutes: 427, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 7, exception: false });
  });

  it('late counts in full once past the grace minutes; within grace is on time', () => {
    expect(judgeDay(day, [p('IN', '2026-11-01', '08:10'), p('OUT', '2026-11-01', '16:00')], TZ).lateMinutes).toBe(0);
    const late = judgeDay(day, [p('IN', '2026-11-01', '08:20'), p('OUT', '2026-11-01', '16:00')], TZ);
    expect(late).toMatchObject({ lateMinutes: 20, exception: true });
  });

  it('leaving early is counted from the scheduled end, and no break is taken off a short day', () => {
    const r = judgeDay(day, [p('IN', '2026-11-01', '08:00'), p('OUT', '2026-11-01', '12:00')], TZ);
    expect(r).toMatchObject({ workedMinutes: 240, earlyLeaveMinutes: 240, overtimeMinutes: 0, exception: true });
  });

  it('a break spent clocked out is not taken off twice', () => {
    const r = judgeDay(day, [p('IN', '2026-11-01', '08:00'), p('OUT', '2026-11-01', '12:00'), p('IN', '2026-11-01', '13:00'), p('OUT', '2026-11-01', '16:00')], TZ);
    expect(r).toMatchObject({ workedMinutes: 420, overtimeMinutes: 0, exception: false });
  });

  it('no punches on a working day is an absence; a missing clock-out is incomplete', () => {
    expect(judgeDay(day, [], TZ)).toMatchObject({ status: 'ABSENT', exception: true });
    expect(judgeDay(day, [p('IN', '2026-11-01', '08:00')], TZ)).toMatchObject({ status: 'INCOMPLETE', exception: true, overtimeMinutes: 0 });
  });

  it('work on a rest day or holiday is all overtime; a holiday beats the shift', () => {
    const rest = judgeDay(sched('2026-11-06', []), [p('IN', '2026-11-06', '09:00'), p('OUT', '2026-11-06', '12:00')], TZ);
    expect(rest).toMatchObject({ status: 'REST', workedMinutes: 180, overtimeMinutes: 180, exception: false });
    const holiday = judgeDay(sched('2026-11-01', [MORNING], { holiday: 'National Day' }), [], TZ);
    expect(holiday).toMatchObject({ status: 'HOLIDAY', exception: false });
  });

  it('a flexible shift is short by what was not worked of the required minutes', () => {
    const r = judgeDay(sched('2026-11-01', [FLEX]), [p('IN', '2026-11-01', '10:00'), p('OUT', '2026-11-01', '17:00')], TZ);
    expect(r).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 60, workedMinutes: 420, exception: true });
  });
});

describe('which day a punch belongs to', () => {
  it("a night shift's morning clock-out stays on the night it started", () => {
    const days = [sched('2026-11-01', [NIGHT]), sched('2026-11-02', [])];
    const punches = [p('IN', '2026-11-01', '21:55'), p('OUT', '2026-11-02', '06:05')];
    const byDay = assignPunches(days, punches, TZ);
    expect(byDay.get('2026-11-01')).toHaveLength(2);
    expect(byDay.get('2026-11-02')).toHaveLength(0);
    // 490 raw minutes − 30 break = 460; scheduled 450 → 10 overtime.
    expect(judgeDay(days[0]!, byDay.get('2026-11-01')!, TZ)).toMatchObject({ status: 'PRESENT', workedMinutes: 460, overtimeMinutes: 10 });
  });

  it('a day is judged only six hours after its last shift ends', () => {
    const day = sched('2026-11-01', [NIGHT]);
    expect(isFinished(day, TZ, at('2026-11-02', '11:59'))).toBe(false);
    expect(isFinished(day, TZ, at('2026-11-02', '12:00'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────── the service

const ACTOR = { type: 'USER' as const, id: 'u-mgr' };

function service(db: Record<string, unknown>, resolve: ScheduleDay[] = [], audit: object = { append: vi.fn(), appendMany: vi.fn() }) {
  const base = { company: { findUnique: vi.fn().mockResolvedValue({ timezone: TZ }) }, ...db };
  const schedule = {
    resolve: vi.fn().mockResolvedValue(resolve),
    resolveMany: vi.fn().mockResolvedValue(new Map([['e1', resolve]])),
  };
  return new AttendanceService(base as never, schedule as never, audit as never);
}

describe('staff recording punches', () => {
  const now = at('2026-11-02', '12:00');
  const db = () => ({
    attendanceDay: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), createMany: vi.fn() },
    attendanceEvent: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    leaveRequest: { findMany: vi.fn().mockResolvedValue([]) },
    employee: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 'e1' }) },
    $transaction: vi.fn(),
  });
  const withTx = (d: ReturnType<typeof db>) => {
    d.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(d));
    return d;
  };

  it('stores local times as instants, marked MANUAL with who entered them', async () => {
    const d = withTx(db());
    await service(d, [sched('2026-11-01', [MORNING])]).recordPunches('co', 'e1', { date: '2026-11-01', inTime: '08:05', outTime: '16:00', note: 'device down' }, ACTOR, now);
    expect(d.attendanceEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'IN', at: at('2026-11-01', '08:05'), source: 'MANUAL', note: 'device down', createdById: 'u-mgr' }) });
    expect(d.attendanceEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'OUT', at: at('2026-11-01', '16:00') }) });
  });

  it("a night shift's clock-out lands on the next morning", async () => {
    const d = withTx(db());
    await service(d, [sched('2026-11-01', [NIGHT])]).recordPunches('co', 'e1', { date: '2026-11-01', outTime: '06:00' }, ACTOR, now);
    expect(d.attendanceEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'OUT', at: at('2026-11-02', '06:00') }) });
  });

  it('needs at least one time, and never a day or time still to come', async () => {
    const svc = service(withTx(db()), [sched('2026-11-02', [MORNING])]);
    await expect(svc.recordPunches('co', 'e1', { date: '2026-11-01' }, ACTOR, now)).rejects.toMatchObject({ code: 'NEEDS_TIME' });
    await expect(svc.recordPunches('co', 'e1', { date: '2999-01-01', inTime: '08:00' }, ACTOR, now)).rejects.toMatchObject({ code: 'FUTURE_DATE' });
    await expect(svc.recordPunches('co', 'e1', { date: '2026-11-02', inTime: '08:00', outTime: '16:00' }, ACTOR, now)).rejects.toMatchObject({ code: 'FUTURE_TIME' });
  });

  it('refuses a day payroll has locked', async () => {
    const d = withTx(db());
    d.attendanceDay.findUnique.mockResolvedValue({ locked: true });
    await expect(service(d).recordPunches('co', 'e1', { date: '2026-11-01', inTime: '08:00' }, ACTOR, now)).rejects.toMatchObject({ code: 'DAY_LOCKED' });
  });

  it('only punches entered by hand can be deleted', async () => {
    const d = { attendanceEvent: { findFirst: vi.fn().mockResolvedValue({ id: 'ev', source: 'DEVICE', at: now }) } };
    await expect(service(d).deletePunch('co', 'e1', 'ev', ACTOR)).rejects.toMatchObject({ code: 'NOT_MANUAL' });
  });
});

describe('re-judging a reviewed day', () => {
  const day = sched('2026-11-01', [MORNING]);
  const late = [{ employeeId: 'e1', kind: 'IN', at: at('2026-11-01', '08:30') }, { employeeId: 'e1', kind: 'OUT', at: at('2026-11-01', '16:00') }];
  const now = at('2026-11-03', '09:00');
  const reviewed = { employeeId: 'e1', date: new Date('2026-11-01T00:00:00Z'), locked: false, status: 'PRESENT', workedMinutes: 420, lateMinutes: 30, earlyLeaveMinutes: 0, overtimeMinutes: 0, review: 'CONFIRMED', shiftCodes: 'M' };
  const db = (events: unknown[], existing: unknown[]) => ({
    attendanceEvent: { findMany: vi.fn().mockResolvedValue(events) },
    leaveRequest: { findMany: vi.fn().mockResolvedValue([]) },
    employee: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 'e1' }) },
    attendanceDay: { findMany: vi.fn().mockResolvedValue(existing), update: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  });

  it('keeps HR’s decision when nothing changed', async () => {
    const d = db(late, [reviewed]);
    expect(await service(d, [day]).recompute('co', ['e1'], '2026-11-01', '2026-11-01', now)).toBe(0);
    expect(d.attendanceDay.update).not.toHaveBeenCalled();
    expect(d.attendanceDay.createMany).not.toHaveBeenCalled();
  });

  it('a day judged for the first time is inserted with the others in one batch', async () => {
    const d = db(late, []);
    expect(await service(d, [day]).recompute('co', ['e1'], '2026-11-01', '2026-11-01', now)).toBe(1);
    expect(d.attendanceDay.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ companyId: 'co', employeeId: 'e1', status: 'PRESENT', lateMinutes: 30, review: 'PENDING' })],
      skipDuplicates: true,
    });
    expect(d.attendanceDay.update).not.toHaveBeenCalled();
  });

  it('asks again when an approved correction changed the day', async () => {
    const d = db([{ employeeId: 'e1', kind: 'IN', at: at('2026-11-01', '08:00') }, ...late], [{ ...reviewed, id: 'day-1', lateMinutes: 45 }]);
    await service(d, [day]).recompute('co', ['e1'], '2026-11-01', '2026-11-01', now);
    expect(d.attendanceDay.update).toHaveBeenCalledWith({ where: { id: 'day-1' }, data: expect.objectContaining({ review: 'NONE', lateMinutes: 0 }) });
  });

  it('a day before the hire date is never judged — one judged earlier is taken back', async () => {
    const d = db(late, [{ ...reviewed, id: 'day-1', review: 'PENDING', status: 'ABSENT' }]);
    (d as Record<string, unknown>)['employee'] = { findMany: vi.fn().mockResolvedValue([{ id: 'e1', hireDate: new Date('2026-11-02T00:00:00Z') }]) };
    (d.attendanceDay as Record<string, unknown>)['delete'] = vi.fn().mockResolvedValue({});
    await service(d, [day]).recompute('co', ['e1'], '2026-11-01', '2026-11-01', now);
    expect(d.attendanceDay.update).not.toHaveBeenCalled();
    expect(d.attendanceDay.createMany).not.toHaveBeenCalled();
    expect((d.attendanceDay as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith({ where: { id: 'day-1' } });
  });

  it('never touches a day payroll has locked', async () => {
    const d = db(late, [{ ...reviewed, locked: true, lateMinutes: 99 }]);
    expect(await service(d, [day]).recompute('co', ['e1'], '2026-11-01', '2026-11-01', now)).toBe(0);
  });
});

describe('HR reviewing flagged days', () => {
  const flagged = (id: string) => ({ id, employeeId: `e-${id}`, date: new Date('2026-11-01T00:00:00Z'), locked: false, review: 'PENDING', status: 'ABSENT', lateMinutes: 0, earlyLeaveMinutes: 0 });

  it('a selection is decided in one update, each day still in the audit trail', async () => {
    const d: Record<string, unknown> & { attendanceDay: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } } = { attendanceDay: { findMany: vi.fn().mockResolvedValue([flagged('1'), flagged('2')]), updateMany: vi.fn().mockResolvedValue({ count: 2 }) }, $transaction: (fn: (tx: unknown) => unknown) => fn(d) };
    const audit = { append: vi.fn(), appendMany: vi.fn() };
    expect(await service(d, [], audit).review('co', ['1', '2'], 'CONFIRMED', 'no call', ACTOR, undefined)).toBe(2);
    expect(d.attendanceDay.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['1', '2'] }, locked: false, review: { not: 'NONE' } },
      data: expect.objectContaining({ review: 'CONFIRMED', reviewedById: 'u-mgr', reviewNote: 'no call' }),
    });
    expect(audit.appendMany.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ action: 'ATTENDANCE_CONFIRMED', employeeId: 'e-1', companyId: 'co' }),
      expect.objectContaining({ action: 'ATTENDANCE_CONFIRMED', employeeId: 'e-2' }),
    ]);
  });

  it('a day payroll locked in the meantime stops the action, and nothing is logged', async () => {
    const d: Record<string, unknown> & { attendanceDay: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } } = { attendanceDay: { findMany: vi.fn().mockResolvedValue([flagged('1'), flagged('2')]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, $transaction: (fn: (tx: unknown) => unknown) => fn(d) };
    const audit = { append: vi.fn(), appendMany: vi.fn() };
    await expect(service(d, [], audit).review('co', ['1', '2'], 'EXCUSED', undefined, ACTOR, undefined)).rejects.toMatchObject({ code: 'DAY_LOCKED' });
    expect(audit.appendMany).not.toHaveBeenCalled();
  });
});

describe('deciding overtime', () => {
  const request = { id: 'o1', employeeId: 'e1', minutes: 60, date: new Date('2026-11-01T00:00:00Z') };

  it('a request decided by someone else first is refused', async () => {
    const d = {
      overtimeRequest: { findFirst: vi.fn().mockResolvedValue(request), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      attendanceDay: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(service(d).decideOvertime('co', 'o1', true, undefined, undefined, ACTOR, undefined)).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  it('cannot approve more overtime than was asked', async () => {
    const d = { overtimeRequest: { findFirst: vi.fn().mockResolvedValue(request) } };
    await expect(service(d).decideOvertime('co', 'o1', true, 90, undefined, ACTOR, undefined)).rejects.toBeInstanceOf(GuardFailedError);
  });

  it('records who approved and how many minutes', async () => {
    const d = {
      overtimeRequest: { findFirst: vi.fn().mockResolvedValue(request), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({}) },
      attendanceDay: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await service(d).decideOvertime('co', 'o1', true, 45, 'ok', ACTOR, undefined);
    expect(d.overtimeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'APPROVED', approvedMinutes: 45, decidedById: 'u-mgr', decisionNote: 'ok' }),
    });
  });
});
