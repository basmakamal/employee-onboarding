/**
 * Leave arithmetic — pure functions, no database: which days of a period
 * count, how sick-leave pay steps down over the year, and how many days a
 * person earns by years of service. Amounts are in days with two decimals
 * (half days, monthly accrual of 21 / 12 = 1.75).
 */
import type { ScheduleDay } from './schedule.service.js';

export type CountMode = 'WORKING' | 'CALENDAR';
export interface PayTier {
  days: number;
  percent: number;
}
export interface PayPart {
  days: number;
  percent: number;
}

/** Round to two decimals (days are stored as DECIMAL(6,2)). */
export const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Is this day a working day for the person? With a schedule in force: a day
 * with a shift that is not a holiday. Without one: not a company weekend day
 * and not a holiday.
 */
export function isWorkingDay(day: ScheduleDay, weekendDays: number[]): boolean {
  if (day.holiday) return false;
  if (day.assignmentId) return day.shifts.length > 0;
  return !weekendDays.includes(new Date(`${day.date}T00:00:00Z`).getUTCDay());
}

/** Days a leave over these dates takes: every day, or only working days. Half a day counts 0.5. */
export function countLeaveDays(days: ScheduleDay[], mode: CountMode, weekendDays: number[], halfDay = false): number {
  const n = mode === 'CALENDAR' ? days.length : days.filter((d) => isWorkingDay(d, weekendDays)).length;
  return halfDay ? Math.min(n, 0.5) : n;
}

/**
 * How the days of a leave are paid, given the days of the same type already
 * taken this year. Sick leave (Art. 117): the first 30 days in full, the next
 * 60 at 75%, the next 30 unpaid. Without tiers, everything at one rate.
 */
export function payBreakdown(days: number, takenBefore: number, tiers: PayTier[] | null | undefined, paidPercent: number): PayPart[] {
  if (!tiers?.length) return days > 0 ? [{ days: r2(days), percent: paidPercent }] : [];
  const out: PayPart[] = [];
  let left = days;
  let start = 0;
  for (const tier of tiers) {
    const end = start + tier.days;
    // The part of this tier already used, then what this leave takes of it.
    const free = Math.max(0, end - Math.max(start, takenBefore));
    const take = Math.min(free, left);
    if (take > 0) {
      const last = out[out.length - 1];
      if (last && last.percent === tier.percent) last.days = r2(last.days + take);
      else out.push({ days: r2(take), percent: tier.percent });
      left = r2(left - take);
    }
    start = end;
    if (left <= 0) break;
  }
  // Beyond the last tier: unpaid.
  if (left > 0) out.push({ days: r2(left), percent: 0 });
  return out;
}

/** Whole months of service on a date. */
export function serviceMonths(hireDate: Date, on: Date): number {
  let months = (on.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 + (on.getUTCMonth() - hireDate.getUTCMonth());
  if (on.getUTCDate() < hireDate.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Yearly entitlement on a date: the senior rate once the years of service are reached (Art. 109: 30 after 5 years). */
export function yearlyEntitlement(
  type: { daysPerYear: number | null; seniorDaysPerYear: number | null; seniorAfterYears: number | null },
  hireDate: Date,
  on: Date,
): number {
  const base = type.daysPerYear ?? 0;
  if (type.seniorDaysPerYear != null && type.seniorAfterYears != null && serviceMonths(hireDate, on) >= type.seniorAfterYears * 12) {
    return type.seniorDaysPerYear;
  }
  return base;
}

/**
 * One month's accrual: a twelfth of the yearly entitlement, prorated by the
 * calendar days employed in that month (a joiner on the 16th of a 30-day
 * month earns half).
 */
export function monthlyAccrual(yearly: number, month: string, hireDate: Date): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = Date.UTC(y, m - 1, 1);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startDay = hireDate.getTime() > first ? hireDate.getUTCDate() : 1;
  if (hireDate.getTime() >= Date.UTC(y, m, 1)) return 0;
  const employed = daysInMonth - startDay + 1;
  return r2((yearly / 12) * (employed / daysInMonth));
}

/** Months "YYYY-MM" from `from` to `to`, both inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
