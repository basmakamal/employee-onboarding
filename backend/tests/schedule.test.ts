/**
 * Work schedules: shift lengths across midnight, which shift a date gets from
 * a weekly or rotating pattern, temporary schedules winning over regular
 * ones, branch holidays, and the overlap rules for assignments.
 */
import { describe, expect, it, vi } from 'vitest';
import { ScheduleService, shiftSpan } from '../src/modules/workforce/schedule.service.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('shift length', () => {
  it('handles day and overnight shifts', () => {
    expect(shiftSpan('08:00', '17:00')).toEqual({ minutes: 540, overnight: false });
    expect(shiftSpan('22:00', '06:00')).toEqual({ minutes: 480, overnight: true });
  });
});

const MORNING = { id: 'sh-m', code: 'M', nameAr: 'صباحي', nameEn: 'Morning', kind: 'FIXED', startTime: '08:00', endTime: '16:00', breakMinutes: 60, graceMinutes: 15, requiredMinutes: null, color: null };
const NIGHT = { id: 'sh-n', code: 'N', nameAr: 'ليلي', nameEn: 'Night', kind: 'FIXED', startTime: '22:00', endTime: '06:00', breakMinutes: 30, graceMinutes: 10, requiredMinutes: null, color: null };
// Sun–Thu mornings, Fri + Sat off.
const WEEKLY = { id: 'p-w', code: 'WEEK', kind: 'WEEKLY', cycleDays: 7, days: [['sh-m'], ['sh-m'], ['sh-m'], ['sh-m'], ['sh-m'], [], []] };
// 2 nights, 2 off.
const ROTA = { id: 'p-r', code: 'ROTA', kind: 'ROTATION', cycleDays: 4, days: [['sh-n'], ['sh-n'], [], []] };

function resolver(assignments: unknown[], holidays: unknown[] = []) {
  const db = {
    shiftAssignment: { findMany: vi.fn().mockResolvedValue(assignments) },
    employee: { findMany: vi.fn().mockResolvedValue([{ id: 'e1', orgUnitId: 'u-riyadh' }]) },
    holiday: { findMany: vi.fn().mockResolvedValue(holidays) },
    orgUnit: { findMany: vi.fn().mockResolvedValue([{ id: 'u-riyadh', path: '/u-hq/u-riyadh/' }]) },
    shiftDefinition: { findMany: vi.fn().mockResolvedValue([MORNING, NIGHT]) },
  };
  return new ScheduleService(db as never, { append: vi.fn() } as never);
}

describe('resolving a schedule', () => {
  it('a weekly pattern follows the day of the week (2026-11-01 is a Sunday)', async () => {
    const svc = resolver([{ id: 'a1', employeeId: 'e1', temporary: false, startDate: d('2026-10-01'), endDate: null, pattern: WEEKLY }]);
    const days = await svc.resolve('co', 'e1', '2026-11-01', '2026-11-07');
    expect(days.map((x) => x.shifts.map((s) => s.code).join() || (x.rest ? 'rest' : '-'))).toEqual(['M', 'M', 'M', 'M', 'M', 'rest', 'rest']);
  });

  it('a rotation counts from the assignment start, and night shifts are overnight', async () => {
    const svc = resolver([{ id: 'a1', employeeId: 'e1', temporary: false, startDate: d('2026-11-03'), endDate: null, pattern: ROTA }]);
    const days = await svc.resolve('co', 'e1', '2026-11-01', '2026-11-08');
    expect(days.map((x) => x.shifts.map((s) => s.code).join() || (x.assignmentId ? 'rest' : 'none'))).toEqual(['none', 'none', 'N', 'N', 'rest', 'rest', 'N', 'N']);
    expect(days[2]!.shifts[0]).toMatchObject({ overnight: true, minutes: 480 });
  });

  it('a temporary schedule overrides the regular one on its dates only', async () => {
    const svc = resolver([
      { id: 'reg', employeeId: 'e1', temporary: false, startDate: d('2026-10-01'), endDate: null, pattern: WEEKLY },
      { id: 'tmp', employeeId: 'e1', temporary: true, startDate: d('2026-11-02'), endDate: d('2026-11-03'), pattern: ROTA },
    ]);
    const days = await svc.resolve('co', 'e1', '2026-11-01', '2026-11-04');
    expect(days.map((x) => x.assignmentId)).toEqual(['reg', 'tmp', 'tmp', 'reg']);
    expect(days[1]!.temporary).toBe(true);
  });

  it("marks company holidays and holidays of the person's branch, not of other branches", async () => {
    const svc = resolver(
      [{ id: 'a1', employeeId: 'e1', temporary: false, startDate: d('2026-10-01'), endDate: null, pattern: WEEKLY }],
      [
        { date: d('2026-11-01'), name: 'Company day', orgUnitId: null },
        { date: d('2026-11-02'), name: 'Riyadh branch day', orgUnitId: 'u-riyadh' },
        { date: d('2026-11-03'), name: 'Jeddah branch day', orgUnitId: 'u-jeddah' },
      ],
    );
    const days = await svc.resolve('co', 'e1', '2026-11-01', '2026-11-03');
    expect(days.map((x) => x.holiday)).toEqual(['Company day', 'Riyadh branch day', null]);
  });
});

describe('assigning schedules', () => {
  function assigner(existing: Array<{ id: string; startDate: Date; endDate: Date | null }>) {
    const tx = {
      shiftAssignment: {
        findMany: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 'new', ...(data as object) })),
      },
    };
    const db = {
      shiftPattern: { findFirst: vi.fn().mockResolvedValue({ id: 'p-w', code: 'WEEK', active: true }) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { svc: new ScheduleService(db as never, { append: vi.fn() } as never), tx };
  }
  const actor = { type: 'USER' as const, id: 'u1' };

  it('a new regular schedule ends the previous one the day before', async () => {
    const { svc, tx } = assigner([{ id: 'old', startDate: d('2026-01-01'), endDate: null }]);
    await svc.assign('co', 'e1', { patternId: 'p-w', startDate: '2026-11-01' }, actor);
    expect(tx.shiftAssignment.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: { endDate: d('2026-10-31') } });
  });

  it('refuses a regular schedule that would start on or before a later one', async () => {
    const { svc } = assigner([{ id: 'later', startDate: d('2026-12-01'), endDate: null }]);
    await expect(svc.assign('co', 'e1', { patternId: 'p-w', startDate: '2026-11-01' }, actor)).rejects.toMatchObject({ code: 'SCHEDULE_OVERLAP' });
  });

  it('asks for a temporary schedule for a limited period inside the current one', async () => {
    const { svc } = assigner([{ id: 'old', startDate: d('2026-01-01'), endDate: null }]);
    await expect(svc.assign('co', 'e1', { patternId: 'p-w', startDate: '2026-11-01', endDate: '2026-11-07' }, actor)).rejects.toMatchObject({ code: 'USE_TEMPORARY' });
  });

  it('a temporary schedule needs an end date', async () => {
    const { svc } = assigner([]);
    await expect(svc.assign('co', 'e1', { patternId: 'p-w', startDate: '2026-11-01', temporary: true }, actor)).rejects.toMatchObject({ code: 'TEMPORARY_NEEDS_END' });
  });
});
