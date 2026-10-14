import { logger } from '../../common/logger.js';
import { DEFAULT_SLA_RULES } from '../../workflow/sla-defaults.js';
import { generateSaudiHolidays } from '../../workflow/saudi-holidays.js';
import type { HolidayRepository, SlaRuleRepository } from '../../workflow/sla-rule.repository.js';

/**
 * What a company needs before it can run on its own: the default automation
 * rules and a holiday calendar. Everything else per company (e-mail wording,
 * triggers, mail server, weekend days, lists) has a sensible default without
 * any row — built-in templates, the main company's mailbox, Fri + Sat, and
 * the list catalogue seeded on first use.
 */
export class CompanyDefaults {
  constructor(
    private readonly rules: Pick<SlaRuleRepository, 'count' | 'create'>,
    private readonly holidays: Pick<HolidayRepository, 'list' | 'add'>,
  ) {}

  /** The default automation rules, only when the company has none at all. */
  async ensureRules(companyId: string): Promise<number> {
    if ((await this.rules.count(companyId)) > 0) return 0;
    for (const { key: _key, processKey, notifyRole, ...rule } of DEFAULT_SLA_RULES) {
      await this.rules.create(companyId, {
        ...rule,
        processKey: processKey ?? 'EMPLOYEE',
        notifyRole: notifyRole ?? 'HR',
      });
    }
    return DEFAULT_SLA_RULES.length;
  }

  /** A new company: its rules plus the official holidays of this year and next. */
  async onCreated(companyId: string, now: Date = new Date()): Promise<void> {
    await this.ensureRules(companyId);
    if ((await this.holidays.list(companyId)).length > 0) return;
    const year = now.getUTCFullYear();
    for (const h of [...generateSaudiHolidays(year), ...generateSaudiHolidays(year + 1)]) {
      await this.holidays.add(companyId, h.date, h.name);
    }
  }

  /** Boot: any company without rules gets the defaults (never touches a company that has some). */
  async ensureAll(companyIds: string[]): Promise<void> {
    let created = 0;
    for (const id of companyIds) created += await this.ensureRules(id);
    if (created > 0) logger.info({ created }, 'default automation rules created');
  }
}
