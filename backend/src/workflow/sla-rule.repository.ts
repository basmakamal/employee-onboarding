import type { Db } from '../common/prisma.js';
import { NotFoundError } from './errors.js';

/** Automation rules — every company has its own set. */
export class SlaRuleRepository {
  constructor(private readonly db: Db) {}

  /** Every active rule across all companies and machines — the scheduler's work list. */
  listAllActive() {
    return this.db.slaRule.findMany({ where: { active: true } });
  }

  /** One company's rules, for the Automation page. */
  list(companyId: string) {
    return this.db.slaRule.findMany({
      where: { companyId },
      orderBy: [{ processKey: 'asc' }, { status: 'asc' }],
    });
  }

  /** How many rules a company has — none means it still needs the defaults. */
  count(companyId: string) {
    return this.db.slaRule.count({ where: { companyId } });
  }

  /** Admin-created automation rule (the seeded set is just the starting point). */
  create(
    companyId: string,
    data: {
      processKey: string;
      status: string;
      afterValue: number;
      afterUnit: 'HOURS' | 'CALENDAR_DAYS' | 'WORKING_DAYS';
      action: 'REMIND' | 'REMIND_DAILY' | 'ESCALATE' | 'EXPIRE';
      notifySubject: boolean;
      notifyHr?: boolean;
      notifyRole: string;
      escalateToRole?: string | null;
      subjectTemplateKey?: string | null;
      staffTemplateKey?: string | null;
      ccEmails?: string | null;
      active?: boolean;
    },
  ) {
    return this.db.slaRule.create({ data: { ...data, companyId } });
  }

  /** Change one of the company's rules; another company's rule is a 404. */
  async update(
    companyId: string,
    id: string,
    data: {
      afterValue?: number;
      afterUnit?: 'HOURS' | 'CALENDAR_DAYS' | 'WORKING_DAYS';
      notifySubject?: boolean;
      notifyHr?: boolean;
      notifyRole?: string;
      escalateToRole?: string | null;
      subjectTemplateKey?: string | null;
      staffTemplateKey?: string | null;
      ccEmails?: string | null;
      active?: boolean;
    },
  ) {
    const { count } = await this.db.slaRule.updateMany({ where: { id, companyId }, data });
    if (count === 0) throw new NotFoundError('automation rule', id);
    return this.db.slaRule.findUniqueOrThrow({ where: { id } });
  }
}

/** Public holidays — every company keeps its own calendar. */
export class HolidayRepository {
  constructor(private readonly db: Db) {}

  /** A company's holidays inside a range — input to working-day math. */
  listBetween(companyId: string, from: Date, to: Date) {
    return this.db.holiday.findMany({
      where: { companyId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
  }

  list(companyId: string) {
    return this.db.holiday.findMany({ where: { companyId }, orderBy: { date: 'asc' } });
  }

  add(companyId: string, date: Date, name: string) {
    return this.db.holiday.create({ data: { companyId, date, name } });
  }

  /** Remove one of the company's holidays; another company's is a 404. */
  async remove(companyId: string, id: string) {
    const { count } = await this.db.holiday.deleteMany({ where: { id, companyId } });
    if (count === 0) throw new NotFoundError('holiday', id);
  }
}
