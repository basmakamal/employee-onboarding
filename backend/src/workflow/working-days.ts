/**
 * Working-day math for the SLA engine (BRD: "بعد يومي عمل", "بعد ٥ أيام عمل").
 * Weekend: Friday + Saturday (Saudi Arabia). Public holidays come from the
 * holidays table and are passed in — these functions stay pure.
 */

const FRIDAY = 5;
const SATURDAY = 6;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isWorkingDay(date: Date, holidays: Date[] = []): boolean {
  const day = date.getUTCDay();
  if (day === FRIDAY || day === SATURDAY) return false;
  const key = dateKey(date);
  return !holidays.some((h) => dateKey(h) === key);
}

/** The moment `n` working days after `start` (same wall-clock time). */
export function addWorkingDays(start: Date, n: number, holidays: Date[] = []): Date {
  const result = new Date(start);
  let remaining = n;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isWorkingDay(result, holidays)) remaining -= 1;
  }
  return result;
}

/** Whole working days elapsed between two moments (order-safe). */
export function workingDaysBetween(from: Date, to: Date, holidays: Date[] = []): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > to) break;
    if (isWorkingDay(cursor, holidays)) count += 1;
  }
  return count;
}
