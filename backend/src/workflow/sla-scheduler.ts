import type { SlaRule } from '../generated/prisma/client.js';
import type { SlaRuleRepository, HolidayRepository } from './sla-rule.repository.js';
import type { SlaFiringRepository } from './sla-firing.repository.js';
import type { AuditLogRepository } from './audit-log.repository.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { workingDaysBetween } from './working-days.js';
import { config } from '../common/config.js';
import { logger } from '../common/logger.js';

/** Daily reminders re-fire after this many hours (slightly under 24h so a
 *  tick that runs a little early still counts as "the next day"). */
const DAILY_REFIRE_HOURS = 20;

/** A record currently sitting in a watched status. */
export interface WatchedRecord {
  id: string;
  /** Display name for notification templates. */
  name: string;
  /** Subject's email (the employee / new hire) — omit when not applicable. */
  email?: string;
  /** When the record entered this status — the SLA anchor. */
  anchorAt: Date;
  employeeId?: string;
  /** Extra template parameters (e.g. daysLeft/docType for expiry alerts). */
  meta?: Record<string, string | number>;
}

/** One per state machine the SLA engine watches. */
export interface SlaWatcher {
  processKey: string; // EMPLOYEE | OFFBOARDING | GOSI | MEDICAL_INSURANCE | ...
  listInStatusSince(status: string, threshold: Date, limit?: number): Promise<WatchedRecord[]>;
  /**
   * Deadline-style dueness (e.g. "N days BEFORE a document expires").
   * When present it replaces the elapsed-time check entirely — the watcher
   * decides what is due; the scheduler still applies the firing memory.
   */
  listDue?(
    rule: { status: string; afterValue: number; afterUnit: string },
    now: Date,
    limit?: number,
  ): Promise<WatchedRecord[]>;
  /** Subject-facing template key per status (staff always get the generic one). */
  subjectTemplate?(status: string): string | undefined;
  /** Override the generic staff templates (stalled/escalation wording). */
  templates?: { stalled?: string; escalation?: string };
  /** EXPIRE support — transition through the machine (guarded + audited). */
  expire?(record: WatchedRecord, ruleId: string): Promise<void>;
}

/**
 * The automation engine, generalized: every tick it evaluates the active
 * sla_rules against their watcher and REMINDs (once), REMIND_DAILYs (max
 * once/day), ESCALATEs to a higher group (once), or EXPIREs — with
 * sla_firings as its exact memory, every action audited and every message
 * through the notifications table.
 */
export class SlaScheduler {
  private readonly watchers: Map<string, SlaWatcher>;

  constructor(
    private readonly deps: {
      rules: SlaRuleRepository;
      holidays: HolidayRepository;
      firings: SlaFiringRepository;
      audit: AuditLogRepository;
      notifications: NotificationService;
      /** System calendar: which weekdays are the weekend (admin-configured). */
      calendar?: { getCalendar(): Promise<{ weekendDays: number[] }> };
    },
    watchers: SlaWatcher[],
  ) {
    this.watchers = new Map(watchers.map((w) => [w.processKey, w]));
  }

  async tick(now: Date = new Date()): Promise<void> {
    const rules = await this.deps.rules.listAllActive();
    // Weekend config is the same for every rule — fetch once per tick.
    const weekend = (await this.deps.calendar?.getCalendar())?.weekendDays;
    for (const rule of rules) {
      try {
        await this.applyRule(rule, now, weekend);
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, 'SLA rule application failed');
      }
    }
  }

  private async applyRule(rule: SlaRule, now: Date, weekend?: number[]): Promise<void> {
    const watcher = this.watchers.get(rule.processKey);
    if (!watcher) return;

    const candidates = watcher.listDue
      ? await watcher.listDue(rule, now, config.SLA_BATCH_SIZE)
      : await watcher.listInStatusSince(
          rule.status,
          this.prefilterThreshold(rule, now),
          config.SLA_BATCH_SIZE,
        );
    if (candidates.length === 0) return;

    // The dedupe memory for ALL candidates in one GROUP BY — the old
    // per-candidate lookup was one query per row per rule per tick, forever.
    const lastFirings = await this.deps.firings.lastFirings(
      rule.id,
      candidates.map((c) => c.id),
    );

    // Working-day rules need the holiday table once, spanning the oldest
    // anchor — not one query per record.
    let holidays: Date[] = [];
    if (rule.afterUnit === 'WORKING_DAYS') {
      const oldest = candidates.reduce((min, c) => (c.anchorAt < min ? c.anchorAt : min), now);
      holidays = (await this.deps.holidays.listBetween(oldest, now)).map((h) => h.date);
    }

    for (const record of candidates) {
      // Cheap map lookup first — already-fired records cost nothing more.
      if (!this.firingAllowed(rule, lastFirings.get(record.id) ?? null, now)) continue;
      // Deadline watchers decide dueness themselves.
      if (!watcher.listDue && !this.elapsedEnough(rule, record, now, holidays, weekend)) continue;

      if (rule.action === 'EXPIRE') {
        if (!watcher.expire) continue;
        await watcher.expire(record, rule.id);
        await this.notifyStaff(rule, record, now, rule.notifyRole, 'staff.record_expired');
      } else if (rule.action === 'ESCALATE') {
        await this.notifyStaff(
          rule,
          record,
          now,
          rule.escalateToRole ?? 'ADMIN',
          watcher.templates?.escalation ?? 'staff.escalation',
        );
        await this.audit(rule, record, 'SLA_ESCALATION');
      } else {
        await this.remind(rule, record, watcher, now);
        await this.audit(rule, record, 'SLA_REMINDER');
      }
      await this.deps.firings.record(rule.id, record.id, now);
    }
  }

  /** Coarse DB filter; WORKING_DAYS is verified precisely per record. */
  private prefilterThreshold(rule: SlaRule, now: Date): Date {
    const t = new Date(now);
    if (rule.afterUnit === 'HOURS') t.setUTCHours(t.getUTCHours() - rule.afterValue);
    else t.setUTCDate(t.getUTCDate() - rule.afterValue); // calendar ≥ working days
    return t;
  }

  private elapsedEnough(
    rule: SlaRule,
    record: WatchedRecord,
    now: Date,
    holidays: Date[],
    weekend?: number[],
  ): boolean {
    if (rule.afterUnit !== 'WORKING_DAYS') return true; // hours/calendar prefiltered in SQL
    return workingDaysBetween(record.anchorAt, now, holidays, weekend) >= rule.afterValue;
  }

  private firingAllowed(rule: SlaRule, lastFiring: Date | null, now: Date): boolean {
    if (lastFiring === null) return true;
    if (rule.action !== 'REMIND_DAILY') return false; // one-shot already fired
    return (now.getTime() - lastFiring.getTime()) / 3_600_000 >= DAILY_REFIRE_HOURS;
  }

  private async remind(rule: SlaRule, record: WatchedRecord, watcher: SlaWatcher, now: Date) {
    const subjectTemplate = watcher.subjectTemplate?.(rule.status);
    if (rule.notifySubject && subjectTemplate && record.email) {
      await this.deps.notifications.notifyExternal(
        record.email,
        subjectTemplate,
        { name: record.name },
        this.ref(rule, record),
      );
    }
    if (rule.notifyHr) {
      await this.notifyStaff(
        rule,
        record,
        now,
        rule.notifyRole,
        watcher.templates?.stalled ?? 'staff.record_stalled',
      );
    }
  }

  private notifyStaff(
    rule: SlaRule,
    record: WatchedRecord,
    now: Date,
    role: string,
    template: string,
  ) {
    return this.deps.notifications.notifyRole(
      role,
      template,
      {
        name: record.name,
        status: rule.status,
        daysWaiting: Math.floor((now.getTime() - record.anchorAt.getTime()) / 86_400_000),
        ...record.meta,
      },
      this.ref(rule, record),
    );
  }

  private audit(rule: SlaRule, record: WatchedRecord, action: string) {
    return this.deps.audit.append({
      entity: rule.processKey,
      entityId: record.id,
      action,
      actorType: 'SYSTEM',
      ...(record.employeeId ? { employeeId: record.employeeId } : {}),
      metadata: { rule: rule.id, status: rule.status },
    });
  }

  private ref(rule: SlaRule, record: WatchedRecord) {
    return { entity: rule.processKey, entityId: record.id };
  }
}

/** Boot helper: run a tick now and then on an interval. Returns a stopper. */
export function startSlaScheduler(scheduler: SlaScheduler, intervalMinutes: number): () => void {
  const run = () =>
    scheduler.tick().catch((err: unknown) => logger.error({ err }, 'SLA tick failed'));
  run();
  const handle = setInterval(run, intervalMinutes * 60_000);
  handle.unref();
  return () => clearInterval(handle);
}
