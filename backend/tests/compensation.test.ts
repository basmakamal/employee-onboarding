/**
 * Pay: package totals (fixed and percent-of-basic lines, GOSI and hourly
 * bases), the Art. 107 overtime rate, and the rules for pay versions —
 * basic salary required, history never rewritten, amounts kept out of the
 * audit trail.
 */
import { describe, expect, it, vi } from 'vitest';
import { hourlyRates, resolvePackage, type ComponentDef } from '../src/modules/payroll/compensation-calc.js';
import { CompensationService } from '../src/modules/payroll/compensation.service.js';

const c = (id: string, code: string, extra: Partial<ComponentDef> = {}): ComponentDef => ({
  id, code, nameAr: code, nameEn: code, kind: 'EARNING', method: 'FIXED', gosiBase: false, hourlyBase: true, prorated: true, sortOrder: 50, ...extra,
});
const BASIC = c('c-basic', 'BASIC', { gosiBase: true, sortOrder: 10 });
const HOUSING = c('c-house', 'HOUSING', { gosiBase: true, method: 'PERCENT_OF_BASIC', sortOrder: 20 });
const TRANSPORT = c('c-trans', 'TRANSPORT', { sortOrder: 30 });
const CAR_LOAN = c('c-loan', 'CAR', { kind: 'DEDUCTION', hourlyBase: false, sortOrder: 90 });
const ALL = [BASIC, HOUSING, TRANSPORT, CAR_LOAN];

describe('a pay package', () => {
  const pkg = resolvePackage(
    [
      { componentId: 'c-trans', amount: 500 },
      { componentId: 'c-basic', amount: 8000 },
      { componentId: 'c-house', percent: 25 },
      { componentId: 'c-loan', amount: 300.1 },
    ],
    ALL,
  );

  it('works out percent lines from the basic salary and keeps the component order', () => {
    expect(pkg.lines.map((l) => [l.code, l.amount])).toEqual([['BASIC', 8000], ['HOUSING', 2000], ['TRANSPORT', 500], ['CAR', 300.1]]);
  });

  it('totals earnings, deductions, the GOSI wage (basic + housing) and the hourly-base wage', () => {
    expect(pkg).toMatchObject({ basic: 8000, earnings: 10500, deductions: 300.1, net: 10199.9, gosiWage: 10000, hourlyWage: 10500 });
  });

  it('adds money without floating-point dust', () => {
    const p = resolvePackage([{ componentId: 'c-basic', amount: 0.1 }, { componentId: 'c-trans', amount: 0.2 }], ALL);
    expect(p.earnings).toBe(0.3);
  });
});

describe('hourly rates (Art. 107)', () => {
  it('overtime = the hourly wage + 50% of the BASIC hourly wage', () => {
    // 10,500 / (30 × 8) = 43.75 per hour; basic 8,000 / 240 = 33.33; + 50% of that = 60.42.
    const r = hourlyRates({ basic: 8000, hourlyWage: 10500 }, { rateDaysPerMonth: 30, hoursPerDay: 8, overtimePremiumPct: 50 });
    expect(r).toEqual({ hourly: 43.75, basicHourly: 33.33, overtimeHourly: 60.42, daily: 350 });
  });
});

// ─────────────────────────────────────────────────────────── the service

const ACTOR = { type: 'USER' as const, id: 'u-hr' };
const ROWS = ALL.map((x) => ({ ...x, companyId: 'co', defaultPercent: null, system: true, active: true }));

function service(opts: { existing?: object | null; clash?: object | null; hireDate?: Date | null } = {}) {
  const audit = { append: vi.fn() };
  const db = {
    company: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Riyadh' }) },
    payComponent: { count: vi.fn().mockResolvedValue(4), findMany: vi.fn().mockResolvedValue(ROWS) },
    employee: { findFirst: vi.fn().mockResolvedValue({ hireDate: opts.hireDate === undefined ? new Date('2024-01-01') : opts.hireDate }) },
    employeeCompensation: {
      findUnique: vi.fn().mockResolvedValue(opts.clash ?? null),
      findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
      create: vi.fn().mockResolvedValue({ id: 'v1' }),
      delete: vi.fn(),
    },
  };
  return { svc: new CompensationService(db as never, audit as never), db, audit };
}

describe('changing pay', () => {
  it('needs a basic salary', async () => {
    const { svc } = service();
    await expect(svc.create('co', 'e1', { effectiveFrom: '2026-11-01', lines: [{ componentId: 'c-trans', amount: 500 }] }, ACTOR)).rejects.toMatchObject({ code: 'BASIC_REQUIRED' });
  });

  it('cannot start before the employment does', async () => {
    const { svc } = service({ hireDate: new Date('2026-10-13') });
    await expect(svc.create('co', 'e1', { effectiveFrom: '2026-10-01', lines: [{ componentId: 'c-basic', amount: 8000 }] }, ACTOR)).rejects.toMatchObject({ code: 'BEFORE_HIRE' });
  });

  it('stores only lines with an amount, and audits the change without the amounts', async () => {
    const { svc, db, audit } = service();
    await svc.create('co', 'e1', { effectiveFrom: '2026-11-01', lines: [{ componentId: 'c-basic', amount: 8000 }, { componentId: 'c-trans', amount: 0 }, { componentId: 'c-house', percent: 25 }] }, ACTOR);
    const data = db.employeeCompensation.create.mock.calls[0]![0].data;
    expect(data.lines.create).toEqual([{ componentId: 'c-basic', amount: 8000, percent: null }, { componentId: 'c-house', amount: null, percent: 25 }]);
    const logged = JSON.stringify(audit.append.mock.calls[0]![0]);
    expect(logged).not.toContain('8000');
    expect(audit.append.mock.calls[0]![0]).toMatchObject({ action: 'COMPENSATION_CHANGED', metadata: { effectiveFrom: '2026-11-01' } });
  });

  it('one change per date', async () => {
    const { svc } = service({ clash: { id: 'other' } });
    await expect(svc.create('co', 'e1', { effectiveFrom: '2026-11-01', lines: [{ componentId: 'c-basic', amount: 8000 }] }, ACTOR)).rejects.toMatchObject({ code: 'DUPLICATE_DATE' });
  });

  it('pay already in force is history: it cannot be removed or edited', async () => {
    const { svc } = service({ existing: { id: 'v1', effectiveFrom: new Date('2020-01-01') } });
    await expect(svc.remove('co', 'e1', 'v1', ACTOR)).rejects.toMatchObject({ code: 'IN_FORCE' });
    await expect(svc.update('co', 'e1', 'v1', { effectiveFrom: '2030-01-01', lines: [{ componentId: 'c-basic', amount: 1 }] }, ACTOR)).rejects.toMatchObject({ code: 'IN_FORCE' });
  });
});
