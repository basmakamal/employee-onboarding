/**
 * Payroll engine — worked examples ("golden files"). Every amount below is
 * checked by hand; the engine must reproduce them to the halala. The GOSI
 * percentages here are TEST VALUES only — the app ships with no GOSI rate.
 */
import { describe, expect, it } from 'vitest';
import { calculate, prorationFactor, type EngineInput, type EnginePolicy } from '../src/modules/payroll/payroll-engine.js';
import { resolvePackage, type ComponentDef } from '../src/modules/payroll/compensation-calc.js';
import { PayrollService, runWarnings } from '../src/modules/payroll/payroll.service.js';
import { vi } from 'vitest';

const C = (id: string, code: string, extra: Partial<ComponentDef> = {}): ComponentDef => ({
  id, code, nameAr: code, nameEn: code, kind: 'EARNING', method: 'FIXED', gosiBase: false, hourlyBase: true, prorated: true, sortOrder: 50, ...extra,
});
const COMPONENTS = [
  C('b', 'BASIC', { gosiBase: true, sortOrder: 10 }),
  C('h', 'HOUSING', { gosiBase: true, sortOrder: 20 }),
  C('t', 'TRANSPORT', { sortOrder: 30 }),
  C('x', 'PHONE', { sortOrder: 40, prorated: false }),
];
const pkg = (basic: number, housing = 2000, transport = 500, phone = 0) =>
  resolvePackage(
    [{ componentId: 'b', amount: basic }, { componentId: 'h', amount: housing }, { componentId: 't', amount: transport }, ...(phone ? [{ componentId: 'x', amount: phone }] : [])],
    COMPONENTS,
  );

const POLICY: EnginePolicy = {
  proration: 'WORKING_DAYS', rateDaysPerMonth: 30, hoursPerDay: 8, overtimePremiumPct: 50,
  gosiSaudiEmployeePct: 9.75, gosiSaudiEmployerPct: 11.75, gosiNonSaudiEmployerPct: 2, gosiWageCap: 45000, deductionsMaxPct: 50,
};

function month(over: Partial<EngineInput> = {}): EngineInput {
  return {
    month: '2026-11', daysInMonth: 30, monthWorkingDays: 21,
    segments: [{ from: '2026-11-01', to: '2026-11-30', versionId: 'v1', pkg: pkg(8000), workingDays: 21 }],
    policy: POLICY, saudi: true, absentDays: 0, missingPunchDays: 0, lateEarlyMinutes: 0, leave: [], overtimeMinutes: 0, payments: [], instalments: [],
    ...over,
  };
}
const amount = (r: ReturnType<typeof calculate>, code: string) => r.items.find((i) => i.code === code)?.amount;

describe('a full month', () => {
  it('Saudi, 8,000 + 2,000 + 500: GOSI 9.75% of 10,000 deducted, 11.75% paid by the employer', () => {
    const r = calculate(month());
    expect(r.gross).toBe(10500);
    expect(amount(r, 'GOSI')).toBe(975);
    expect(amount(r, 'GOSI_EMPLOYER')).toBe(1175);
    expect(r).toMatchObject({ deductions: 975, net: 9525, employerCost: 1175, warnings: [] });
  });

  it('non-Saudi: no employee GOSI, the employer share at the non-Saudi rate', () => {
    const r = calculate(month({ saudi: false }));
    expect(amount(r, 'GOSI')).toBeUndefined();
    expect(r).toMatchObject({ net: 10500, employerCost: 200 });
  });

  it('GOSI rates not entered yet: nothing deducted, a warning instead', () => {
    const r = calculate(month({ policy: { ...POLICY, gosiSaudiEmployeePct: null, gosiSaudiEmployerPct: null } }));
    expect(r.net).toBe(10500);
    expect(r.warnings).toEqual([{ code: 'GOSI_RATES_MISSING', blocking: false }]);
  });

  it('the GOSI wage stops at the cap', () => {
    const r = calculate(month({ segments: [{ from: '2026-11-01', to: '2026-11-30', versionId: 'v1', pkg: pkg(60000, 0, 0), workingDays: 21 }] }));
    expect(amount(r, 'GOSI')).toBe(4387.5); // 45,000 × 9.75%
  });
});

describe('partial months (proration by working days)', () => {
  it('a joiner with 10 of 21 working days earns 10/21 of each prorated component', () => {
    const r = calculate(month({ segments: [{ from: '2026-11-16', to: '2026-11-30', versionId: 'v1', pkg: pkg(8000, 2000, 500, 300), workingDays: 10 }] }));
    // 8,000 × 10/21 = 3,809.52 · 2,000 × 10/21 = 952.38 · 500 × 10/21 = 238.10 · phone (not prorated) 300
    expect(r.items.filter((i) => i.kind === 'EARNING').map((i) => [i.code, i.amount])).toEqual([['BASIC', 3809.52], ['HOUSING', 952.38], ['TRANSPORT', 238.1], ['PHONE', 300]]);
    expect(r.gross).toBe(5300);
    // GOSI on the employed share of the GOSI wage: 10,000 × 10/21 × 9.75% = 464.29
    expect(amount(r, 'GOSI')).toBe(464.29);
  });

  it('a raise on the 16th: each part of the month at its own pay', () => {
    const r = calculate(month({
      segments: [
        { from: '2026-11-01', to: '2026-11-15', versionId: 'v1', pkg: pkg(8000, 2000, 500), workingDays: 11 },
        { from: '2026-11-16', to: '2026-11-30', versionId: 'v2', pkg: pkg(9000, 2250, 500), workingDays: 10 },
      ],
    }));
    // basic 8,000 × 11/21 + 9,000 × 10/21 = 4,190.48 + 4,285.71 = 8,476.19
    expect(amount(r, 'BASIC')).toBe(8476.19);
    expect(amount(r, 'HOUSING')).toBe(2119.05); // 1,047.62 + 1,071.43
    expect(amount(r, 'TRANSPORT')).toBe(500);
  });

  it('other proration methods', () => {
    const seg = { from: '2026-11-16', to: '2026-11-30', workingDays: 10 };
    expect(prorationFactor(seg, { daysInMonth: 30, monthWorkingDays: 21 }, 'CALENDAR_DAYS')).toBe(0.5);
    expect(prorationFactor(seg, { daysInMonth: 31, monthWorkingDays: 21 }, 'THIRTY_DAYS')).toBe(0.5);
    expect(prorationFactor({ ...seg, from: '2026-11-01' }, { daysInMonth: 30, monthWorkingDays: 21 }, 'WORKING_DAYS')).toBe(1);
  });
});

describe('deductions and additions', () => {
  it('confirmed absence, lateness, overtime (Art. 107) and unpaid leave', () => {
    const r = calculate(month({
      absentDays: 2,
      lateEarlyMinutes: 90,
      overtimeMinutes: 120,
      leave: [{ code: 'UNPAID', nameAr: 'بدون راتب', nameEn: 'Unpaid', days: 3, percent: 0 }, { code: 'SICK', nameAr: 'مرضية', nameEn: 'Sick', days: 2, percent: 75 }],
      policy: { ...POLICY, gosiSaudiEmployeePct: null, gosiSaudiEmployerPct: null },
    }));
    // daily 10,500 / 30 = 350 · hourly 43.75 · overtime hour 43.75 + 50% × 33.3333 = 60.4167
    expect(amount(r, 'ABSENCE')).toBe(700);
    expect(amount(r, 'LATE')).toBe(65.63);
    expect(amount(r, 'OVERTIME')).toBe(120.83);
    expect(amount(r, 'UNPAID')).toBe(1050);
    expect(amount(r, 'SICK')).toBe(175); // 2 days × 25% unpaid × 350
    expect(r.gross).toBe(10620.83);
    expect(r.deductions).toBe(1990.63);
    expect(r.net).toBe(8630.2);
  });

  it('loan instalment, bonus and penalty; Art. 92 warns when loans + penalties pass half the wage', () => {
    const r = calculate(month({
      policy: { ...POLICY, gosiSaudiEmployeePct: null, gosiSaudiEmployerPct: null, deductionsMaxPct: 10 },
      instalments: [{ id: 'i1', loanId: 'l1', kind: 'LOAN', amount: 1000 }],
      payments: [
        { id: 'p1', kind: 'EARNING', category: 'BONUS', amount: 500, labelAr: 'مكافأة', labelEn: 'Bonus' },
        { id: 'p2', kind: 'DEDUCTION', category: 'PENALTY', amount: 200, labelAr: 'جزاء', labelEn: 'Penalty' },
      ],
    }));
    expect(r).toMatchObject({ gross: 11000, deductions: 1200, net: 9800 });
    expect(r.warnings).toContainEqual({ code: 'DEDUCTIONS_OVER_LIMIT', blocking: false, detail: { limit: 1100, total: 1200 } });
  });

  it('a negative net blocks the run; no pay at all blocks it too', () => {
    expect(calculate(month({ instalments: [{ id: 'i', loanId: 'l', kind: 'LOAN', amount: 20000 }] })).warnings).toContainEqual({ code: 'NEGATIVE_NET', blocking: true });
    expect(calculate(month({ segments: [] })).warnings).toEqual([{ code: 'NO_PAY', blocking: true }]);
  });
});

describe('payroll runs', () => {
  it('the attendance period runs from the day after last month\'s cut-off', () => {
    expect(PayrollService.period('2026-11', 25)).toEqual({ from: '2026-10-26', to: '2026-11-25' });
    expect(PayrollService.period('2027-01', 20)).toEqual({ from: '2026-12-21', to: '2027-01-20' });
  });

  function service(run: object) {
    const db = { payrollRun: { findFirst: vi.fn().mockResolvedValue(run) } };
    return new PayrollService(db as never, {} as never, {} as never, { getCalendar: vi.fn() }, { append: vi.fn() } as never);
  }
  const base = { id: 'r1', status: 'CALCULATED', calculatedById: 'u-prep', calculatedAt: new Date(), month: '2026-11', periodFrom: new Date(), periodTo: new Date(), lines: [], warnings: [] };

  it('whoever calculated a run cannot approve it', async () => {
    await expect(service(base).approve('co', 'r1', undefined, { type: 'USER', id: 'u-prep' })).rejects.toMatchObject({ code: 'SAME_PERSON' });
  });

  it('a blocking warning (e.g. exceptions HR has not confirmed) stops approval', async () => {
    const run = { ...base, warnings: [{ code: 'EXCEPTIONS_PENDING', blocking: true, count: 3 }] };
    await expect(service(run).approve('co', 'r1', undefined, { type: 'USER', id: 'u-mgr' })).rejects.toMatchObject({ code: 'RUN_BLOCKED' });
  });

  it('a held person no longer blocks the others; unreviewed exceptions always do', () => {
    const noPay = [{ code: 'NO_PAY' as const, blocking: true }];
    expect(runWarnings([noPay, []], 0)).toEqual([{ code: 'NO_PAY', blocking: true, count: 1 }]);
    expect(runWarnings([[]], 0)).toEqual([]);
    expect(runWarnings([[]], 2)).toEqual([{ code: 'EXCEPTIONS_PENDING', blocking: true, count: 2 }]);
  });
});
