import type { Trainee } from '../generated/prisma/client.js';
import type { SlaRule } from '../generated/prisma/client.js';
import type { TraineeStatus } from '../generated/prisma/enums.js';
import type { Workflow } from './engine.js';
import type { TraineeRepository } from '../modules/trainees/trainee.repository.js';
import type { SlaRuleRepository, HolidayRepository } from './sla-rule.repository.js';
import type { AuditLogRepository } from './audit-log.repository.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { workingDaysBetween } from './working-days.js';
import { logger } from '../common/logger.js';

/** Daily reminders re-fire after this many hours (a little under 24h so a
 *  tick that runs slightly early still counts as "the next day"). */
const DAILY_REFIRE_HOURS = 20;

const TEMPLATES: Record<string, { subject: string; hr: string }> = {
  AWAITING_FORM: { subject: 'trainee.form_reminder', hr: 'hr.trainee_waiting' },
  CONTRACT_CREATION: { subject: 'trainee.form_reminder', hr: 'hr.contract_creation_due' },
  AWAITING_CONTRACT_APPROVAL: {
    subject: 'trainee.contract_approval_reminder',
    hr: 'hr.trainee_waiting',
  },
};

/**
 * The BRD automation table, executed. Every tick:
 *   1. load active TRAINEE rules from sla_rules (config-driven — admins can
 *      change the numbers without a deploy)
 *   2. find records that have sat in the rule's status long enough
 *   3. REMIND (once) / REMIND_DAILY (max once per day) / EXPIRE (through the
 *      state machine, so it's guarded + audited like any other transition)
 *
 * Reminders are audited (SLA_REMINDER) and idempotent via lastReminderAt —
 * BRD rule "Expired stops all reminders" holds because expired records are
 * no longer in the rule's status.
 */
export class SlaScheduler {
  constructor(
    private readonly deps: {
      rules: SlaRuleRepository;
      holidays: HolidayRepository;
      trainees: TraineeRepository;
      workflow: Workflow<Trainee>;
      audit: AuditLogRepository;
      notifications: NotificationService;
    },
  ) {}

  async tick(now: Date = new Date()): Promise<void> {
    const rules = await this.deps.rules.listActive('TRAINEE');
    for (const rule of rules) {
      try {
        await this.applyRule(rule, now);
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, 'SLA rule application failed');
      }
    }
  }

  private async applyRule(rule: SlaRule, now: Date): Promise<void> {
    const candidates = await this.deps.trainees.listInStatusSince(
      rule.status as TraineeStatus,
      this.prefilterThreshold(rule, now),
    );

    for (const trainee of candidates) {
      if (!(await this.isDue(rule, trainee, now))) continue;

      if (rule.action === 'EXPIRE') {
        await this.expire(rule, trainee);
      } else {
        await this.remind(rule, trainee, now);
      }
    }
  }

  /** Coarse DB filter; WORKING_DAYS is verified precisely per record. */
  private prefilterThreshold(rule: SlaRule, now: Date): Date {
    const t = new Date(now);
    if (rule.afterUnit === 'HOURS') t.setUTCHours(t.getUTCHours() - rule.afterValue);
    else t.setUTCDate(t.getUTCDate() - rule.afterValue); // calendar ≥ working days
    return t;
  }

  private async isDue(rule: SlaRule, trainee: Trainee, now: Date): Promise<boolean> {
    if (rule.afterUnit === 'WORKING_DAYS') {
      const holidays = (
        await this.deps.holidays.listBetween(trainee.statusChangedAt, now)
      ).map((h) => h.date);
      if (workingDaysBetween(trainee.statusChangedAt, now, holidays) < rule.afterValue) {
        return false;
      }
    }

    if (rule.action === 'REMIND' && trainee.lastReminderAt !== null) return false; // one-shot
    if (rule.action === 'REMIND_DAILY' && trainee.lastReminderAt !== null) {
      const hoursSince = (now.getTime() - trainee.lastReminderAt.getTime()) / 3_600_000;
      if (hoursSince < DAILY_REFIRE_HOURS) return false;
    }
    return true;
  }

  private async remind(rule: SlaRule, trainee: Trainee, now: Date): Promise<void> {
    const name = `${trainee.firstName} ${trainee.lastName}`;
    const daysWaiting = Math.floor(
      (now.getTime() - trainee.statusChangedAt.getTime()) / 86_400_000,
    );
    const templates = TEMPLATES[rule.status];

    if (rule.notifySubject && templates) {
      await this.deps.notifications.notifyExternal(
        trainee.email,
        templates.subject,
        { name },
        { entity: 'TRAINEE', entityId: trainee.id },
      );
    }
    if (rule.notifyHr && templates) {
      await this.deps.notifications.notifyHr(
        templates.hr,
        { name, daysWaiting },
        { entity: 'TRAINEE', entityId: trainee.id },
      );
    }

    await this.deps.audit.append({
      entity: 'TRAINEE',
      entityId: trainee.id,
      action: 'SLA_REMINDER',
      actorType: 'SYSTEM',
      traineeId: trainee.id,
      metadata: { rule: rule.id, status: rule.status, daysWaiting },
    });
    await this.deps.trainees.markReminded(trainee.id, now);
  }

  private async expire(rule: SlaRule, trainee: Trainee): Promise<void> {
    // Through the state machine: guarded, race-safe, audited.
    await this.deps.workflow.transition(trainee, 'EXPIRE', { type: 'SYSTEM' }, { rule: rule.id });

    if (rule.notifyHr) {
      await this.deps.notifications.notifyHr(
        'hr.trainee_expired',
        { name: `${trainee.firstName} ${trainee.lastName}` },
        { entity: 'TRAINEE', entityId: trainee.id },
      );
    }
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
