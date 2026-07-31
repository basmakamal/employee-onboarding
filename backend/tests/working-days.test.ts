/**
 * Working-day math — Friday/Saturday weekend (Saudi) + public holidays.
 * 2026-08-02 is a Sunday (a working day in Saudi Arabia).
 */
import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  isWorkingDay,
  workingDaysBetween,
} from '../src/workflow/working-days.js';

const d = (s: string) => new Date(`${s}T09:00:00Z`);

describe('isWorkingDay', () => {
  it('treats Friday and Saturday as weekend, Sunday–Thursday as working', () => {
    expect(isWorkingDay(d('2026-08-06'))).toBe(true); // Thursday
    expect(isWorkingDay(d('2026-08-07'))).toBe(false); // Friday
    expect(isWorkingDay(d('2026-08-08'))).toBe(false); // Saturday
    expect(isWorkingDay(d('2026-08-02'))).toBe(true); // Sunday
  });

  it('treats listed holidays as non-working', () => {
    expect(isWorkingDay(d('2026-09-23'), [d('2026-09-23')])).toBe(false); // National Day
  });
});

describe('addWorkingDays', () => {
  it('skips the weekend (BRD: "بعد يومي عمل")', () => {
    // Thursday + 2 working days → Sunday, Monday
    expect(addWorkingDays(d('2026-08-06'), 2).toISOString()).toBe(d('2026-08-10').toISOString());
  });

  it('skips holidays that fall inside the window', () => {
    // Wednesday + 2 working days, with Thursday a holiday → Sunday, Monday
    expect(addWorkingDays(d('2026-08-05'), 2, [d('2026-08-06')]).toISOString()).toBe(
      d('2026-08-10').toISOString(),
    );
  });
});

describe('workingDaysBetween', () => {
  it('counts only working days in the window', () => {
    // Thu → next Thu spans Fri+Sat weekend: Sun, Mon, Tue, Wed, Thu = 5
    expect(workingDaysBetween(d('2026-08-06'), d('2026-08-13'))).toBe(5);
  });

  it('is zero for reversed or equal ranges', () => {
    expect(workingDaysBetween(d('2026-08-13'), d('2026-08-06'))).toBe(0);
    expect(workingDaysBetween(d('2026-08-06'), d('2026-08-06'))).toBe(0);
  });
});
