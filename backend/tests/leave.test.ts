/**
 * Leave: which days count (working vs calendar, half days), how sick-leave
 * pay steps down over the year, entitlement by years of service, monthly
 * accrual for joiners, and the service rules (balance, yearly limit, once
 * per service, overlap) plus the effect on attendance days.
 */
import { describe, expect, it, vi } from 'vitest';
import { countLeaveDays, monthlyAccrual, monthsBetween, payBreakdown, serviceMonths, yearlyEntitlement } from '../src/modules/workforce/leave-calc.js';
import { judgeDay, withLeave } from '../src/modules/workforce/attendance-calc.js';
import { LeaveService } from '../src/modules/workforce/leave.service.js';
import type { ScheduleDay } from '../src/modules/workforce/schedule.service.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const MORNING = { id: 'sh-m', code: 'M', nameAr: 'ص', nameEn: 'Morning', kind: 'FIXED', startTime: '08:00', endTime: '16:00', breakMinutes: 60, graceMinutes: 15, requiredMinutes: null, color: null, overnight: false, minutes: 480 };
const day = (date: string, shifts: ScheduleDay['shifts'], extra: Partial<ScheduleDay> = {}): ScheduleDay => ({
  date, assignmentId: 'a1', patternCode: 'P', temporary: false, shifts, rest: shifts.length === 0, holiday: null, ...extra,
});
// 1–7 Nov 2026: Sun–Thu mornings, Fri + Sat off.
const WEEK = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map((x, i) => day(x, i < 5 ? [MORNING] : []));
const FRI_SAT = [5, 6];

describe('counting leave days', () => {
  it('working days follow the schedule; calendar days count everything', () => {
    expect(countLeaveDays(WEEK, 'WORKING', FRI_SAT)).toBe(5);
    expect(countLeaveDays(WEEK, 'CALENDAR', FRI_SAT)).toBe(7);
  });

  it('a holiday is not a working day; without a schedule the company weekend applies', () => {
    const withHoliday = WEEK.map((x, i) => (i === 1 ? { ...x, holiday: 'National Day' } : x));
    expect(countLeaveDays(withHoliday, 'WORKING', FRI_SAT)).toBe(4);
    const unscheduled = WEEK.map((x) => ({ ...x, assignmentId: null, shifts: [], rest: false }));
    expect(countLeaveDays(unscheduled, 'WORKING', FRI_SAT)).toBe(5);
  });

  it('a half day counts 0.5', () => {
    expect(countLeaveDays([WEEK[0]!], 'WORKING', FRI_SAT, true)).toBe(0.5);
  });
});

describe('sick-leave pay (Art. 117)', () => {
  const TIERS = [{ days: 30, percent: 100 }, { days: 60, percent: 75 }, { days: 30, percent: 0 }];

  it('the first 30 days of the year are paid in full', () => {
    expect(payBreakdown(10, 0, TIERS, 100)).toEqual([{ days: 10, percent: 100 }]);
  });

  it('a leave crossing a step is split between the rates', () => {
    expect(payBreakdown(10, 25, TIERS, 100)).toEqual([{ days: 5, percent: 100 }, { days: 5, percent: 75 }]);
    expect(payBreakdown(10, 88, TIERS, 100)).toEqual([{ days: 2, percent: 75 }, { days: 8, percent: 0 }]);
  });

  it('without steps, one rate', () => {
    expect(payBreakdown(3, 0, null, 0)).toEqual([{ days: 3, percent: 0 }]);
  });
});

describe('entitlement and accrual (Art. 109)', () => {
  const ANNUAL = { daysPerYear: 21, seniorDaysPerYear: 30, seniorAfterYears: 5 };

  it('21 days a year, 30 once five full years are served', () => {
    expect(yearlyEntitlement(ANNUAL, d('2022-03-15'), d('2027-03-14'))).toBe(21);
    expect(yearlyEntitlement(ANNUAL, d('2022-03-15'), d('2027-03-15'))).toBe(30);
    expect(serviceMonths(d('2022-03-15'), d('2027-03-14'))).toBe(59);
  });

  it('a month earns a twelfth; a joiner earns the share of the month employed', () => {
    expect(monthlyAccrual(21, '2026-11', d('2020-01-01'))).toBe(1.75);
    // Joined 16 November (30-day month): 15 of 30 days.
    expect(monthlyAccrual(21, '2026-11', d('2026-11-16'))).toBe(0.88);
    expect(monthlyAccrual(21, '2026-10', d('2026-11-16'))).toBe(0);
  });

  it('lists months across a year end', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('leave on attendance days', () => {
  const TZ = 'Asia/Riyadh';
  it('a full day of leave is LEAVE, never absent', () => {
    const r = withLeave(judgeDay(WEEK[0]!, [], TZ), false);
    expect(r).toMatchObject({ status: 'LEAVE', exception: false });
  });
  it('a rest day stays a rest day', () => {
    expect(withLeave(judgeDay(WEEK[5]!, [], TZ), false).status).toBe('REST');
  });
  it('a half day still expects the other half', () => {
    expect(withLeave(judgeDay(WEEK[0]!, [], TZ), true)).toMatchObject({ status: 'ABSENT', exception: true });
  });
});

// ─────────────────────────────────────────────────────────── the service

const ANNUAL_TYPE = { id: 't-annual', companyId: 'co', code: 'ANNUAL', active: true, balanceMode: 'ACCRUAL', gender: 'ANY', countMode: 'WORKING', allowHalfDay: true, maxPerRequest: null, yearlyLimit: null, minServiceMonths: null, oncePerService: false, payTiers: null, paidPercent: 100 };

function service(opts: { type?: object; balance?: number; approvedThisYear?: number; pendingThisYear?: number; overlap?: object | null; approvedOnce?: number; employee?: object }) {
  const db = {
    company: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Riyadh' }) },
    leaveType: { findFirst: vi.fn().mockResolvedValue(opts.type ?? ANNUAL_TYPE) },
    employee: { findFirst: vi.fn().mockResolvedValue(opts.employee ?? { status: 'ACTIVE', gender: 'MALE', hireDate: d('2020-01-01') }) },
    leaveRequest: {
      count: vi.fn().mockResolvedValue(opts.approvedOnce ?? 0),
      findFirst: vi.fn().mockResolvedValue(opts.overlap ?? null),
      aggregate: vi.fn().mockImplementation(({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve({ _sum: { days: where.status.in.includes('PENDING') ? (opts.pendingThisYear ?? 0) : (opts.approvedThisYear ?? 0) } }),
      ),
    },
    leaveLedgerEntry: { aggregate: vi.fn().mockResolvedValue({ _sum: { days: opts.balance ?? 0 } }) },
  };
  const schedule = { resolve: vi.fn().mockResolvedValue(WEEK) };
  const calendar = { getCalendar: vi.fn().mockResolvedValue({ weekendDays: FRI_SAT }) };
  return new LeaveService(db as never, schedule as never, calendar, { append: vi.fn() } as never);
}
const WEEK_LEAVE = { leaveTypeId: 't-annual', startDate: '2026-11-01', endDate: '2026-11-07' };

describe('checking a leave', () => {
  it('counts the working days and what is left of the balance', async () => {
    const e = await service({ balance: 10 }).evaluate('co', 'e1', WEEK_LEAVE);
    expect(e).toMatchObject({ days: 5, balanceAfter: 5 });
  });

  it('refuses more days than the balance, counting other waiting requests', async () => {
    await expect(service({ balance: 6, pendingThisYear: 2 }).evaluate('co', 'e1', WEEK_LEAVE)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('refuses dates another leave already covers', async () => {
    const overlap = { startDate: d('2026-11-03'), endDate: d('2026-11-04') };
    await expect(service({ balance: 30, overlap }).evaluate('co', 'e1', WEEK_LEAVE)).rejects.toMatchObject({ code: 'LEAVE_OVERLAP' });
  });

  it('sick leave stops at the yearly limit', async () => {
    const SICK = { ...ANNUAL_TYPE, code: 'SICK', balanceMode: 'NONE', countMode: 'CALENDAR', yearlyLimit: 120 };
    await expect(service({ type: SICK, approvedThisYear: 117 }).evaluate('co', 'e1', WEEK_LEAVE)).rejects.toMatchObject({ code: 'YEARLY_LIMIT' });
  });

  it('Hajj: once in the employment, after two years of service', async () => {
    const HAJJ = { ...ANNUAL_TYPE, code: 'HAJJ', balanceMode: 'NONE', countMode: 'CALENDAR', oncePerService: true, minServiceMonths: 24 };
    await expect(service({ type: HAJJ, approvedOnce: 1 }).evaluate('co', 'e1', WEEK_LEAVE)).rejects.toMatchObject({ code: 'ONCE_ONLY' });
    await expect(service({ type: HAJJ, employee: { status: 'ACTIVE', gender: 'MALE', hireDate: d('2025-06-01') } }).evaluate('co', 'e1', WEEK_LEAVE)).rejects.toMatchObject({ code: 'NOT_ENOUGH_SERVICE' });
  });

  it('a type for women only is refused for a man', async () => {
    const MATERNITY = { ...ANNUAL_TYPE, code: 'MATERNITY', balanceMode: 'NONE', gender: 'FEMALE' };
    await expect(service({ type: MATERNITY }).evaluate('co', 'e1', WEEK_LEAVE)).rejects.toMatchObject({ code: 'WRONG_GENDER' });
  });

  it('a half day is a single day of a type that allows it', async () => {
    await expect(service({ balance: 10 }).evaluate('co', 'e1', { ...WEEK_LEAVE, halfDay: true })).rejects.toMatchObject({ code: 'NO_HALF_DAY' });
  });
});

describe('accrual', () => {
  const type = { ...ANNUAL_TYPE, accrual: 'MONTHLY', daysPerYear: 21, seniorDaysPerYear: 30, seniorAfterYears: 5, carryForwardMax: null, createdAt: d('2026-09-10') };

  it('credits each completed month since the type was set up, once', async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { leaveLedgerEntry: { findMany: vi.fn().mockResolvedValue([{ periodKey: '2026-09' }]), create, aggregate: vi.fn(), count: vi.fn() } };
    const svc = new LeaveService(db as never, {} as never, { getCalendar: vi.fn() }, { append: vi.fn() } as never);
    const n = await svc.accrueOne(type as never, 'e1', d('2024-01-01'), '2026-11-15');
    // September already credited; October done; November not complete yet. Under five years: 21 / 12.
    expect(n).toBe(1);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'ACCRUAL', days: 1.75, periodKey: '2026-10', date: d('2026-10-31') }) });
  });

  it('expires what exceeds the carry-forward cap at the turn of the year', async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = {
      leaveLedgerEntry: {
        findMany: vi.fn().mockResolvedValue(['2026-09', '2026-10', '2026-11', '2026-12'].map((periodKey) => ({ periodKey }))),
        create,
        aggregate: vi.fn().mockResolvedValue({ _sum: { days: 25 } }),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const svc = new LeaveService(db as never, {} as never, { getCalendar: vi.fn() }, { append: vi.fn() } as never);
    await svc.accrueOne({ ...type, carryForwardMax: 15 } as never, 'e1', d('2020-01-01'), '2027-01-02');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'EXPIRY', days: -10, periodKey: '2026-carry' }) });
  });
});
