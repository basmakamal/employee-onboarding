/**
 * Loan schedules — pure functions. Instalments are equal to the halala; the
 * last one takes the rounding difference so the schedule always adds up to
 * exactly the loan.
 */

/** "2026-11" + 3 → "2027-02". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function buildSchedule(amount: number, count: number, startMonth: string): Array<{ seq: number; month: string; amount: number }> {
  const totalH = Math.round(amount * 100);
  const each = Math.floor(totalH / count);
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    month: addMonths(startMonth, i),
    amount: (i === count - 1 ? totalH - each * (count - 1) : each) / 100,
  }));
}

/** Is a monthly instalment within the share of the wage the law allows (Art. 92: 10%)? */
export function withinLimit(instalment: number, monthlyWage: number, maxPct: number | null): boolean {
  if (maxPct == null) return true;
  return Math.round(instalment * 100) <= Math.round((monthlyWage * maxPct) / 100 * 100);
}
