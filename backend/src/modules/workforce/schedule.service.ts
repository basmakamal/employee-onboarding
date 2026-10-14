import type { Prisma, PrismaClient, ShiftDefinition } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { localDay } from '../employees/employment-history.service.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface ShiftInput {
  code: string;
  nameAr: string;
  nameEn: string;
  kind?: 'FIXED' | 'FLEXIBLE' | undefined;
  startTime: string;
  endTime: string;
  breakMinutes?: number | undefined;
  graceMinutes?: number | undefined;
  requiredMinutes?: number | null | undefined;
  color?: string | null | undefined;
  active?: boolean | undefined;
}

export interface PatternInput {
  code: string;
  nameAr: string;
  nameEn: string;
  kind: 'WEEKLY' | 'ROTATION';
  cycleDays: number;
  /** shift ids per day of the cycle (Sunday first for WEEKLY). */
  days: string[][];
  active?: boolean | undefined;
}

export interface AssignInput {
  patternId: string;
  startDate: string;
  endDate?: string | null | undefined;
  temporary?: boolean | undefined;
  reason?: string | undefined;
}

/** One day of someone's schedule, as attendance will read it. */
export interface ScheduleDay {
  date: string;
  /** The assignment in force on this date (none = not scheduled at all). */
  assignmentId: string | null;
  patternCode: string | null;
  temporary: boolean;
  shifts: Array<Pick<ShiftDefinition, 'id' | 'code' | 'nameAr' | 'nameEn' | 'kind' | 'startTime' | 'endTime' | 'breakMinutes' | 'graceMinutes' | 'requiredMinutes' | 'color'> & { overnight: boolean; minutes: number }>;
  /** Scheduled but no shift on this day of the pattern. */
  rest: boolean;
  /** A public holiday for this person's company (or branch). */
  holiday: string | null;
}

// ─────────────────────────────────────────────────────────── time maths

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Length of a shift in minutes; an end at or before the start runs past midnight. */
export function shiftSpan(start: string, end: string): { minutes: number; overnight: boolean } {
  const s = minutesOf(start);
  const e = minutesOf(end);
  return e > s ? { minutes: e - s, overnight: false } : { minutes: 1440 - s + e, overnight: true };
}
/** [from, to) in minutes from the day's midnight; overnight shifts reach past 1440. */
function interval(sh: { startTime: string; endTime: string }): [number, number] {
  const s = minutesOf(sh.startTime);
  return [s, s + shiftSpan(sh.startTime, sh.endTime).minutes];
}
const dayValue = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => dayOf(new Date(dayValue(d).getTime() + n * DAY_MS));

/**
 * Work schedules: reusable shifts, weekly / rotating patterns, and who works
 * which pattern from when. `resolve` turns that into the day-by-day schedule
 * attendance will be checked against — always the assignment in force on
 * that date (a temporary one beats the regular one), never "the current shift".
 */
export class ScheduleService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditLogRepository,
  ) {}

  private log(companyId: string, actor: Actor, entity: string, entityId: string, action: string, metadata: Record<string, string | number | boolean | null>, employeeId?: string) {
    return this.audit.append({
      entity,
      entityId,
      action,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      ...(employeeId ? { employeeId } : {}),
      companyId,
      metadata,
    });
  }

  // ─────────────────────────────────────────────────────────── shifts

  listShifts(companyId: string) {
    return this.db.shiftDefinition.findMany({ where: { companyId }, orderBy: [{ active: 'desc' }, { startTime: 'asc' }] });
  }

  private validateShift(input: ShiftInput) {
    if (!TIME_RE.test(input.startTime)) throw new GuardFailedError('BAD_TIME', 'use a time like 08:00', 'startTime');
    if (!TIME_RE.test(input.endTime)) throw new GuardFailedError('BAD_TIME', 'use a time like 17:00', 'endTime');
    if (input.startTime === input.endTime) throw new GuardFailedError('ZERO_SHIFT', 'the shift must end at a different time than it starts', 'endTime');
    const { minutes } = shiftSpan(input.startTime, input.endTime);
    if ((input.breakMinutes ?? 0) >= minutes) throw new GuardFailedError('BREAK_TOO_LONG', 'the break must be shorter than the shift', 'breakMinutes');
    if (input.kind === 'FLEXIBLE') {
      const need = input.requiredMinutes ?? 0;
      if (need <= 0) throw new GuardFailedError('REQUIRED_MINUTES', 'a flexible shift needs the minutes to work', 'requiredMinutes');
      if (need > minutes) throw new GuardFailedError('REQUIRED_MINUTES', 'more minutes to work than the window allows', 'requiredMinutes');
    }
  }

  private shiftData(input: ShiftInput) {
    return {
      code: input.code.trim().toUpperCase(),
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn.trim(),
      kind: input.kind ?? 'FIXED',
      startTime: input.startTime,
      endTime: input.endTime,
      breakMinutes: input.breakMinutes ?? 0,
      graceMinutes: input.graceMinutes ?? 0,
      requiredMinutes: input.kind === 'FLEXIBLE' ? (input.requiredMinutes ?? null) : null,
      color: input.color ?? null,
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
  }

  async createShift(companyId: string, input: ShiftInput, actor: Actor) {
    this.validateShift(input);
    const data = this.shiftData(input);
    if (await this.db.shiftDefinition.findUnique({ where: { companyId_code: { companyId, code: data.code } } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a shift with code ${data.code} already exists`, 'code');
    }
    const row = await this.db.shiftDefinition.create({ data: { ...data, companyId } });
    await this.log(companyId, actor, 'SHIFT', row.id, 'SHIFT_CREATED', { code: row.code, start: row.startTime, end: row.endTime });
    return row;
  }

  async updateShift(companyId: string, id: string, input: ShiftInput, actor: Actor) {
    const existing = await this.db.shiftDefinition.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundError('shift', id);
    this.validateShift(input);
    const data = this.shiftData(input);
    if (data.code !== existing.code && (await this.db.shiftDefinition.findUnique({ where: { companyId_code: { companyId, code: data.code } } }))) {
      throw new GuardFailedError('DUPLICATE_CODE', `a shift with code ${data.code} already exists`, 'code');
    }
    const row = await this.db.shiftDefinition.update({ where: { id }, data });
    await this.log(companyId, actor, 'SHIFT', id, 'SHIFT_UPDATED', { code: row.code, start: row.startTime, end: row.endTime });
    return row;
  }

  /** Refused while a pattern still uses the shift — switch it off instead. */
  async deleteShift(companyId: string, id: string, actor: Actor) {
    const existing = await this.db.shiftDefinition.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundError('shift', id);
    const patterns = await this.db.shiftPattern.findMany({ where: { companyId }, select: { code: true, days: true } });
    const users = patterns.filter((p) => (p.days as string[][]).some((d) => d.includes(id))).map((p) => p.code);
    if (users.length) throw new GuardFailedError('SHIFT_IN_USE', `used by pattern(s) ${users.join(', ')} — deactivate it instead`);
    await this.db.shiftDefinition.delete({ where: { id } });
    await this.log(companyId, actor, 'SHIFT', id, 'SHIFT_DELETED', { code: existing.code });
  }

  // ─────────────────────────────────────────────────────────── patterns

  listPatterns(companyId: string) {
    return this.db.shiftPattern.findMany({
      where: { companyId },
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
    });
  }

  private async validatePattern(companyId: string, input: PatternInput) {
    const cycle = input.kind === 'WEEKLY' ? 7 : input.cycleDays;
    if (input.kind === 'ROTATION' && (cycle < 2 || cycle > 56)) {
      throw new GuardFailedError('BAD_CYCLE', 'a rotation repeats every 2 to 56 days', 'cycleDays');
    }
    if (input.days.length !== cycle) throw new GuardFailedError('BAD_DAYS', `the pattern needs exactly ${cycle} days`, 'days');
    const ids = [...new Set(input.days.flat())];
    const shifts = await this.db.shiftDefinition.findMany({ where: { companyId, id: { in: ids } } });
    if (shifts.length !== ids.length) throw new GuardFailedError('BAD_SHIFT', 'every shift must belong to this company', 'days');
    if (shifts.some((s) => !s.active)) throw new GuardFailedError('BAD_SHIFT', 'a pattern cannot use an inactive shift', 'days');
    if (ids.length === 0) throw new GuardFailedError('EMPTY_PATTERN', 'put at least one shift in the pattern', 'days');
    const byId = new Map(shifts.map((s) => [s.id, s]));
    input.days.forEach((day, i) => {
      const spans = day.map((id) => interval(byId.get(id)!)).sort((a, b) => a[0] - b[0]);
      for (let k = 1; k < spans.length; k += 1) {
        if (spans[k]![0] < spans[k - 1]![1]) {
          throw new GuardFailedError('SHIFTS_OVERLAP', `two shifts overlap on day ${i + 1} of the pattern`, 'days');
        }
      }
    });
    return cycle;
  }

  async createPattern(companyId: string, input: PatternInput, actor: Actor) {
    const cycleDays = await this.validatePattern(companyId, input);
    const code = input.code.trim().toUpperCase();
    if (await this.db.shiftPattern.findUnique({ where: { companyId_code: { companyId, code } } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a pattern with code ${code} already exists`, 'code');
    }
    const row = await this.db.shiftPattern.create({
      data: { companyId, code, nameAr: input.nameAr.trim(), nameEn: input.nameEn.trim(), kind: input.kind, cycleDays, days: input.days, active: input.active ?? true },
    });
    await this.log(companyId, actor, 'SHIFT_PATTERN', row.id, 'PATTERN_CREATED', { code, kind: input.kind, cycleDays });
    return row;
  }

  /**
   * Editing a pattern changes the schedule of everyone on it from now on —
   * past days already worked are judged by attendance records, not re-read.
   */
  async updatePattern(companyId: string, id: string, input: PatternInput, actor: Actor) {
    const existing = await this.db.shiftPattern.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundError('pattern', id);
    const cycleDays = await this.validatePattern(companyId, input);
    const code = input.code.trim().toUpperCase();
    if (code !== existing.code && (await this.db.shiftPattern.findUnique({ where: { companyId_code: { companyId, code } } }))) {
      throw new GuardFailedError('DUPLICATE_CODE', `a pattern with code ${code} already exists`, 'code');
    }
    const row = await this.db.shiftPattern.update({
      where: { id },
      data: { code, nameAr: input.nameAr.trim(), nameEn: input.nameEn.trim(), kind: input.kind, cycleDays, days: input.days, ...(input.active !== undefined ? { active: input.active } : {}) },
    });
    await this.log(companyId, actor, 'SHIFT_PATTERN', id, 'PATTERN_UPDATED', { code, kind: input.kind, cycleDays });
    return row;
  }

  async deletePattern(companyId: string, id: string, actor: Actor) {
    const existing = await this.db.shiftPattern.findFirst({ where: { id, companyId }, include: { _count: { select: { assignments: true } } } });
    if (!existing) throw new NotFoundError('pattern', id);
    if (existing._count.assignments > 0) {
      throw new GuardFailedError('PATTERN_IN_USE', `${existing._count.assignments} schedule assignment(s) use this pattern — deactivate it instead`);
    }
    await this.db.shiftPattern.delete({ where: { id } });
    await this.log(companyId, actor, 'SHIFT_PATTERN', id, 'PATTERN_DELETED', { code: existing.code });
  }

  // ─────────────────────────────────────────────────────── assignments

  listAssignments(employeeId: string) {
    return this.db.shiftAssignment.findMany({
      where: { employeeId },
      include: { pattern: { select: { id: true, code: true, nameAr: true, nameEn: true, kind: true } } },
      orderBy: [{ startDate: 'desc' }],
    });
  }

  /**
   * Put someone on a pattern from a date. A regular assignment closes the
   * regular one before it (it ends the day before); a later regular one is a
   * conflict. A temporary assignment overrides the regular one for its dates
   * and must not overlap another temporary one.
   */
  async assign(companyId: string, employeeId: string, input: AssignInput, actor: Actor) {
    if (!DAY_RE.test(input.startDate)) throw new GuardFailedError('BAD_DATE', 'pick a start date', 'startDate');
    if (input.endDate && !DAY_RE.test(input.endDate)) throw new GuardFailedError('BAD_DATE', 'pick a valid end date', 'endDate');
    if (input.endDate && input.endDate < input.startDate) throw new GuardFailedError('END_BEFORE_START', 'the end date is before the start date', 'endDate');
    if (input.temporary && !input.endDate) throw new GuardFailedError('TEMPORARY_NEEDS_END', 'a temporary schedule needs an end date', 'endDate');
    const pattern = await this.db.shiftPattern.findFirst({ where: { id: input.patternId, companyId } });
    if (!pattern || !pattern.active) throw new GuardFailedError('BAD_PATTERN', 'pick an active pattern of this company', 'patternId');

    const start = dayValue(input.startDate);
    const end = input.endDate ? dayValue(input.endDate) : null;
    const overlapping: Prisma.ShiftAssignmentWhereInput = {
      employeeId,
      temporary: !!input.temporary,
      ...(end ? { startDate: { lte: end } } : {}),
      OR: [{ endDate: null }, { endDate: { gte: start } }],
    };

    const row = await this.db.$transaction(async (tx) => {
      const clashes = await tx.shiftAssignment.findMany({ where: overlapping, orderBy: { startDate: 'asc' } });
      for (const c of clashes) {
        if (input.temporary || dayOf(c.startDate) >= input.startDate) {
          throw new GuardFailedError(
            'SCHEDULE_OVERLAP',
            `another ${input.temporary ? 'temporary ' : ''}schedule already covers ${dayOf(c.startDate)}${c.endDate ? ` – ${dayOf(c.endDate)}` : ' onwards'}`,
            'startDate',
          );
        }
        // A bounded regular schedule inside a longer one would cut the longer one short.
        if (end && (!c.endDate || c.endDate > end)) {
          throw new GuardFailedError('USE_TEMPORARY', 'for a limited period inside the current schedule, add a temporary schedule instead', 'temporary');
        }
        // The regular schedule before this one ends the day before it starts.
        await tx.shiftAssignment.update({ where: { id: c.id }, data: { endDate: dayValue(addDays(input.startDate, -1)) } });
      }
      return tx.shiftAssignment.create({
        data: {
          companyId,
          employeeId,
          patternId: pattern.id,
          startDate: start,
          endDate: end,
          temporary: !!input.temporary,
          reason: input.reason?.trim() || null,
          createdById: actor.id ?? null,
        },
      });
    });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'SCHEDULE_ASSIGNED', {
      pattern: pattern.code, from: input.startDate, to: input.endDate ?? null, temporary: !!input.temporary,
    }, employeeId);
    return row;
  }

  /** End a schedule on a date (it stays in the history). */
  async endAssignment(companyId: string, employeeId: string, assignmentId: string, endDate: string, actor: Actor) {
    const a = await this.db.shiftAssignment.findFirst({ where: { id: assignmentId, employeeId, companyId } });
    if (!a) throw new NotFoundError('schedule assignment', assignmentId);
    if (!DAY_RE.test(endDate) || endDate < dayOf(a.startDate)) throw new GuardFailedError('END_BEFORE_START', 'the end date is before the start date', 'endDate');
    const row = await this.db.shiftAssignment.update({ where: { id: a.id }, data: { endDate: dayValue(endDate) } });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'SCHEDULE_ENDED', { assignment: a.id, endDate }, employeeId);
    return row;
  }

  /** Remove a schedule that has not started yet; one already in force can only be ended. */
  async removeAssignment(companyId: string, employeeId: string, assignmentId: string, actor: Actor) {
    const a = await this.db.shiftAssignment.findFirst({ where: { id: assignmentId, employeeId, companyId } });
    if (!a) throw new NotFoundError('schedule assignment', assignmentId);
    const today = await this.today(companyId);
    if (dayOf(a.startDate) <= today) {
      throw new GuardFailedError('SCHEDULE_STARTED', 'this schedule has already started — end it instead of removing it');
    }
    await this.db.shiftAssignment.delete({ where: { id: a.id } });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'SCHEDULE_REMOVED', { assignment: a.id }, employeeId);
  }

  private async today(companyId: string, now = new Date()) {
    const c = await this.db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return localDay(c?.timezone ?? 'Asia/Riyadh', now);
  }

  /** Is there a schedule in force today? (readiness) */
  async hasScheduleToday(companyId: string, employeeId: string): Promise<boolean> {
    const today = dayValue(await this.today(companyId));
    return (await this.db.shiftAssignment.count({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
    })) > 0;
  }

  // ─────────────────────────────────────────────────────────── resolve

  /**
   * Day-by-day schedules for several employees between two dates (inclusive):
   * the assignment in force each day (temporary first), the shift(s) of that
   * day of the pattern, and any public holiday that applies to the person's
   * branch. One query per table, whatever the number of people.
   */
  async resolveMany(companyId: string, employeeIds: string[], from: string, to: string): Promise<Map<string, ScheduleDay[]>> {
    const out = new Map<string, ScheduleDay[]>();
    if (employeeIds.length === 0) return out;
    const [assignments, employees, holidays, units] = await Promise.all([
      this.db.shiftAssignment.findMany({
        where: { companyId, employeeId: { in: employeeIds }, startDate: { lte: dayValue(to) }, OR: [{ endDate: null }, { endDate: { gte: dayValue(from) } }] },
        include: { pattern: true },
      }),
      this.db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, orgUnitId: true } }),
      this.db.holiday.findMany({ where: { companyId, date: { gte: dayValue(from), lte: dayValue(to) } } }),
      this.db.orgUnit.findMany({ where: { companyId }, select: { id: true, path: true } }),
    ]);
    const shiftIds = [...new Set(assignments.flatMap((a) => (a.pattern.days as string[][]).flat()))];
    const shifts = new Map(
      (await this.db.shiftDefinition.findMany({ where: { id: { in: shiftIds } } })).map((s) => [s.id, s]),
    );
    const unitPath = new Map(units.map((u) => [u.id, u.path]));
    const unitOf = new Map(employees.map((e) => [e.id, e.orgUnitId]));

    for (const employeeId of employeeIds) {
      const mine = assignments.filter((a) => a.employeeId === employeeId);
      const path = unitPath.get(unitOf.get(employeeId) ?? '') ?? '';
      const days: ScheduleDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const covers = (a: (typeof mine)[number]) => dayOf(a.startDate) <= d && (!a.endDate || dayOf(a.endDate) >= d);
        const a = mine.find((x) => x.temporary && covers(x)) ?? mine.find((x) => !x.temporary && covers(x)) ?? null;
        const holiday = holidays.find((h) => dayOf(h.date) === d && (!h.orgUnitId || path.includes(`/${h.orgUnitId}/`)));
        let dayShifts: ScheduleDay['shifts'] = [];
        if (a) {
          const pattern = a.pattern;
          const cycle = pattern.days as string[][];
          const index =
            pattern.kind === 'WEEKLY'
              ? dayValue(d).getUTCDay()
              : (((Math.round((dayValue(d).getTime() - a.startDate.getTime()) / DAY_MS)) % pattern.cycleDays) + pattern.cycleDays) % pattern.cycleDays;
          dayShifts = (cycle[index] ?? [])
            .map((id) => shifts.get(id))
            .filter((s): s is ShiftDefinition => !!s)
            .map((s) => ({
              id: s.id, code: s.code, nameAr: s.nameAr, nameEn: s.nameEn, kind: s.kind, startTime: s.startTime, endTime: s.endTime,
              breakMinutes: s.breakMinutes, graceMinutes: s.graceMinutes, requiredMinutes: s.requiredMinutes, color: s.color,
              ...shiftSpan(s.startTime, s.endTime),
            }));
        }
        days.push({
          date: d,
          assignmentId: a?.id ?? null,
          patternCode: a?.pattern.code ?? null,
          temporary: !!a?.temporary,
          shifts: dayShifts,
          rest: !!a && dayShifts.length === 0,
          holiday: holiday?.name ?? null,
        });
      }
      out.set(employeeId, days);
    }
    return out;
  }

  async resolve(companyId: string, employeeId: string, from: string, to: string): Promise<ScheduleDay[]> {
    return (await this.resolveMany(companyId, [employeeId], from, to)).get(employeeId) ?? [];
  }
}
