/**
 * How attendance numbers read on screen: minutes as "7:05", punch instants
 * as the company's local clock time (never the browser's), dates as
 * "Sun 1 Nov", and one colour per day status / review state.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export interface AttendanceDayRow {
  id: string;
  date: string;
  status: string;
  shiftCodes: string | null;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  review: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  locked: boolean;
}

export const STATUS_COLOR: Record<string, string> = {
  PRESENT: 'success',
  ABSENT: 'error',
  INCOMPLETE: 'warning',
  REST: 'grey',
  HOLIDAY: 'info',
  UNSCHEDULED: 'grey',
};
export const REVIEW_COLOR: Record<string, string> = { PENDING: 'warning', CONFIRMED: 'error', EXCUSED: 'success' };
export const REQUEST_COLOR: Record<string, string> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', CANCELLED: 'grey' };

export function useAttendanceFormat() {
  const { locale } = useI18n();
  const ar = computed(() => locale.value.startsWith('ar'));
  /** 425 → "7:05" (hours:minutes), 0 → "—". */
  const minutes = (n: number | null | undefined) => (n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : '—');
  const time = (iso: string | null | undefined, timeZone: string) =>
    iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—';
  /** A DATE column ("2026-11-01T00:00:00.000Z" or "2026-11-01") as "Sun 1 Nov". */
  const day = (d: string, withYear = false) =>
    new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  const stamp = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return { ar, minutes, time, day, stamp };
}

/** Local YYYY-MM-DD of the browser — for default filter ranges only. */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
