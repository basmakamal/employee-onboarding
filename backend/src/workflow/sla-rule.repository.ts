import type { Db } from '../common/prisma.js';

export class SlaRuleRepository {
  constructor(private readonly db: Db) {}

  /** All active rules for a state machine — the scheduler's work list. */
  listActive(processKey: string) {
    return this.db.slaRule.findMany({ where: { processKey, active: true } });
  }

  list() {
    return this.db.slaRule.findMany({ orderBy: [{ processKey: 'asc' }, { status: 'asc' }] });
  }

  setActive(id: string, active: boolean) {
    return this.db.slaRule.update({ where: { id }, data: { active } });
  }
}

export class HolidayRepository {
  constructor(private readonly db: Db) {}

  /** Holidays inside a range — input to working-day math. */
  listBetween(from: Date, to: Date) {
    return this.db.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
  }

  add(date: Date, name: string) {
    return this.db.holiday.create({ data: { date, name } });
  }

  remove(id: string) {
    return this.db.holiday.delete({ where: { id } });
  }
}
