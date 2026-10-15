/**
 * Attendance arithmetic — pure functions, no database. Everything here works
 * in instants (UTC) and turns local dates and "08:00" shift times into
 * instants through the company time zone, so a punch at 01:00 Riyadh time
 * lands on the right day and a night shift may end the next morning.
 */
import type { ScheduleDay } from './schedule.service.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY_MS = 24 * HOUR;

export type PunchKind = 'IN' | 'OUT';
export interface Punch {
  kind: PunchKind;
  at: Date;
}

export type DayStatus = 'PRESENT' | 'ABSENT' | 'INCOMPLETE' | 'REST' | 'HOLIDAY' | 'UNSCHEDULED';

export interface DayResult {
  status: DayStatus;
  shiftCodes: string | null;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  firstIn: Date | null;
  lastOut: Date | null;
  /** Absent, missing punch, late or left early — waits for HR's decision. */
  exception: boolean;
}

// ─────────────────────────────────────────────────────────── time zone

/** How far the zone's wall clock is ahead of UTC at an instant (ms). */
function offsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant of a local wall-clock time ("2026-11-01", "08:00") in a zone. */
export function zonedInstant(day: string, hhmm: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T${hhmm}:00.000Z`);
  let at = guess - offsetMs(timeZone, guess);
  // A second pass settles daylight-saving edges (none in Saudi Arabia, but cheap).
  at = guess - offsetMs(timeZone, at);
  return new Date(at);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The local "HH:MM" of an instant in a zone. */
export function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

// ─────────────────────────────────────────────────────────── windows

/**
 * The stretch of time a day "owns": from the first shift's start to the
 * last shift's end, or 09:00–17:00 local on a day without shifts. A punch
 * belongs to the day whose window is nearest, which puts the 06:05 clock-out
 * of a night shift on the night it started, not on the next day.
 */
export function windowOf(day: ScheduleDay, timeZone: string): { start: Date; end: Date; scheduled: boolean } {
  const shifts = day.holiday ? [] : day.shifts;
  if (shifts.length === 0) {
    return { start: zonedInstant(day.date, '09:00', timeZone), end: zonedInstant(day.date, '17:00', timeZone), scheduled: false };
  }
  const spans = shifts.map((s) => {
    const start = zonedInstant(day.date, s.startTime, timeZone).getTime();
    return [start, start + s.minutes * MIN] as const;
  });
  return {
    start: new Date(Math.min(...spans.map((x) => x[0]))),
    end: new Date(Math.max(...spans.map((x) => x[1]))),
    scheduled: true,
  };
}

/** Hand each punch to the day whose window it is nearest to (inside = distance 0). */
export function assignPunches<P extends Punch>(days: ScheduleDay[], punches: P[], timeZone: string): Map<string, P[]> {
  const windows = days.map((d) => ({ date: d.date, ...windowOf(d, timeZone) }));
  const out = new Map<string, P[]>(days.map((d) => [d.date, []]));
  for (const p of punches) {
    const t = p.at.getTime();
    let best: (typeof windows)[number] | undefined;
    let bestDistance = Infinity;
    for (const w of windows) {
      const distance = t < w.start.getTime() ? w.start.getTime() - t : t > w.end.getTime() ? t - w.end.getTime() : 0;
      if (distance < bestDistance) {
        best = w;
        bestDistance = distance;
      }
    }
    if (best) out.get(best.date)!.push(p);
  }
  return out;
}

/** A day is judged once its window has been closed for six hours (late clock-outs still arrive). */
export function isFinished(day: ScheduleDay, timeZone: string, now: Date): boolean {
  const w = windowOf(day, timeZone);
  const closes = w.scheduled ? w.end.getTime() : zonedInstant(addDays(day.date, 1), '00:00', timeZone).getTime();
  return now.getTime() >= closes + 6 * HOUR;
}

// ─────────────────────────────────────────────────────────── the day

/**
 * Judge one day against its schedule.
 *
 * - Punches pair up in time order: IN opens, OUT closes; a second IN while
 *   open and an OUT with nothing open are ignored, and an unclosed IN (or a
 *   lone OUT) makes the day INCOMPLETE.
 * - The break is not working time, but is only taken off what was worked
 *   beyond the scheduled net minutes (someone who leaves at noon took no
 *   break), and only for the part not already spent clocked out.
 * - Late counts the whole delay once it exceeds the grace minutes; leaving
 *   early counts from the scheduled end. A flexible shift has no fixed
 *   start: it is short by what was not worked of the required minutes.
 * - Overtime is worked minus scheduled; on a rest day or holiday every
 *   minute worked is overtime. Nothing here pays anything — approval and
 *   rates belong to the overtime request and payroll.
 */
export function judgeDay(day: ScheduleDay, punches: Punch[], timeZone: string): DayResult {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const pairs: Array<[number, number]> = [];
  let open: number | null = null;
  let strayOut = 0;
  for (const p of sorted) {
    const t = p.at.getTime();
    if (p.kind === 'IN') {
      if (open === null) open = t;
    } else if (open !== null) {
      pairs.push([open, t]);
      open = null;
    } else {
      strayOut += 1;
    }
  }
  const incomplete = open !== null || (strayOut > 0 && pairs.length === 0);
  const raw = pairs.reduce((sum, [a, b]) => sum + Math.floor((b - a) / MIN), 0);
  let gaps = 0;
  for (let i = 1; i < pairs.length; i += 1) gaps += Math.floor((pairs[i]![0] - pairs[i - 1]![1]) / MIN);
  const firstIn = sorted.find((p) => p.kind === 'IN')?.at ?? null;
  const lastOut = [...sorted].reverse().find((p) => p.kind === 'OUT')?.at ?? null;

  const shifts = day.holiday ? [] : day.shifts;
  const base = { firstIn, lastOut, shiftCodes: day.shifts.map((s) => s.code).join('+') || null };

  if (shifts.length === 0) {
    const status: DayStatus = day.holiday ? 'HOLIDAY' : day.rest ? 'REST' : 'UNSCHEDULED';
    const worked = raw;
    return {
      ...base,
      status,
      scheduledMinutes: 0,
      workedMinutes: worked,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      // Work on a rest day or holiday is overtime; without any schedule there is nothing to exceed.
      overtimeMinutes: status === 'UNSCHEDULED' || incomplete ? 0 : worked,
      exception: false,
    };
  }

  const flexible = shifts.some((s) => s.kind === 'FLEXIBLE');
  const scheduled = shifts.reduce(
    (sum, s) => sum + (s.kind === 'FLEXIBLE' ? (s.requiredMinutes ?? s.minutes - s.breakMinutes) : s.minutes - s.breakMinutes),
    0,
  );
  const breakTotal = shifts.reduce((sum, s) => sum + s.breakMinutes, 0);
  const deduction = Math.min(Math.max(0, breakTotal - gaps), Math.max(0, raw - scheduled));
  const worked = Math.max(0, raw - deduction);

  if (sorted.length === 0) {
    return { ...base, status: 'ABSENT', scheduledMinutes: scheduled, workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, exception: true };
  }

  const w = windowOf(day, timeZone);
  let late = 0;
  let early = 0;
  if (flexible) {
    if (!incomplete) early = Math.max(0, scheduled - worked);
  } else {
    const grace = shifts[0]!.graceMinutes;
    if (firstIn) {
      const delay = Math.floor((firstIn.getTime() - w.start.getTime()) / MIN);
      late = delay > grace ? delay : 0;
    }
    if (lastOut && !incomplete) {
      early = Math.max(0, Math.floor((w.end.getTime() - lastOut.getTime()) / MIN));
    }
  }
  const overtime = incomplete ? 0 : Math.max(0, worked - scheduled);
  const status: DayStatus = incomplete ? 'INCOMPLETE' : 'PRESENT';
  return {
    ...base,
    status,
    scheduledMinutes: scheduled,
    workedMinutes: worked,
    lateMinutes: late,
    earlyLeaveMinutes: early,
    overtimeMinutes: overtime,
    exception: incomplete || late > 0 || early > 0,
  };
}
