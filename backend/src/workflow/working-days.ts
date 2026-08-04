/**
 * Working-day math for the SLA engine (BRD: "بعد يومي عمل", "بعد ٥ أيام عمل").
 * Weekend days are system-configurable (admin calendar settings); the
 * default is Friday + Saturday (Saudi Arabia). Public holidays come from
 * the holidays table. These functions stay pure — configuration is passed in.
 *
 * Day numbers follow JS getUTCDay(): 0=Sun … 5=Fri, 6=Sat.
 */

export const DEFAULT_WEEKEND: readonly number[] = [5, 6]; // Fri + Sat

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isWorkingDay(
  date: Date,
  holidays: Date[] = [],
  weekend: readonly number[] = DEFAULT_WEEKEND,
): boolean {
  if (weekend.includes(date.getUTCDay())) return false;
  const key = dateKey(date);
  return !holidays.some((h) => dateKey(h) === key);
}

/** The moment `n` working days after `start` (same wall-clock time). */
export function addWorkingDays(
  start: Date,
  n: number,
  holidays: Date[] = [],
  weekend: readonly number[] = DEFAULT_WEEKEND,
): Date {
  const result = new Date(start);
  let remaining = n;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isWorkingDay(result, holidays, weekend)) remaining -= 1;
  }
  return result;
}

/** Whole working days elapsed between two moments (order-safe). */
export function workingDaysBetween(
  from: Date,
  to: Date,
  holidays: Date[] = [],
  weekend: readonly number[] = DEFAULT_WEEKEND,
): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > to) break;
    if (isWorkingDay(cursor, holidays, weekend)) count += 1;
  }
  return count;
}
