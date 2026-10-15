/**
 * Loans and one-off payments: schedules that add up to the halala, the
 * Art. 92 instalment limit (other loans in the same months count), approval
 * creating the schedule, postponing a month, and the rules for cancelling.
 */
import { describe, expect, it, vi } from 'vitest';
import { addMonths, buildSchedule, withinLimit } from '../src/modules/payroll/loan-calc.js';
import { LoanService } from '../src/modules/payroll/loan.service.js';

describe('loan schedule', () => {
  it('equal instalments, the last one takes the rounding difference', () => {
    const s = buildSchedule(1000, 3, '2026-11');
    expect(s).toEqual([
      { seq: 1, month: '2026-11', amount: 333.33 },
      { seq: 2, month: '2026-12', amount: 333.33 },
      { seq: 3, month: '2027-01', amount: 333.34 },
    ]);
    expect(s.reduce((t, x) => t + Math.round(x.amount * 100), 0)).toBe(100000);
  });

  it('counts months across years', () => {
    expect(addMonths('2026-11', 14)).toBe('2028-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('Art. 92: an instalment stays within 10% of the wage', () => {
    expect(withinLimit(1050, 10500, 10)).toBe(true);
    expect(withinLimit(1050.01, 10500, 10)).toBe(false);
    expect(withinLimit(99999, 10500, null)).toBe(true);
  });
});

const ACTOR = { type: 'USER' as const, id: 'u-hr' };

function service(opts: { gross?: number | null; maxPct?: number | null; otherDue?: Array<{ month: string; amount: number }>; loan?: object | null } = {}) {
  const pay = {
    todayOf: vi.fn().mockResolvedValue('2026-10-15'),
    grossOn: vi.fn().mockResolvedValue(opts.gross === undefined ? 10500 : opts.gross),
    policyOn: vi.fn().mockResolvedValue({ loanInstalmentMaxPct: opts.maxPct === undefined ? 10 : opts.maxPct }),
  };
  const tx = {
    employeeLoan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() },
    loanInstalment: { createMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn(), deleteMany: vi.fn() },
  };
  const db = {
    employee: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    employeeLoan: {
      create: vi.fn().mockResolvedValue({ id: 'l1' }),
      findFirst: vi.fn().mockResolvedValue(opts.loan ?? null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({}),
    },
    loanInstalment: { findMany: vi.fn().mockResolvedValue(opts.otherDue ?? []) },
    oneTimePayment: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { svc: new LoanService(db as never, pay as never, { append: vi.fn() } as never), db, tx };
}

describe('asking for a loan', () => {
  it('refuses an instalment above 10% of the wage', async () => {
    const { svc } = service();
    // 6,000 over 5 months = 1,200 a month > 1,050.
    await expect(svc.requestLoan('co', 'e1', { kind: 'LOAN', amount: 6000, instalments: 5, startMonth: '2026-11', reason: 'car' }, ACTOR)).rejects.toMatchObject({ code: 'LOAN_OVER_LIMIT' });
  });

  it('counts another loan being repaid in the same months', async () => {
    const { svc } = service({ otherDue: [{ month: '2026-11', amount: 600 }] });
    // 3,000 over 6 = 500, plus 600 already due in November = 1,100 > 1,050.
    const e = await svc.evaluateLoan('co', 'e1', { kind: 'LOAN', amount: 3000, instalments: 6, startMonth: '2026-11', reason: 'x' });
    expect(e).toMatchObject({ monthlyTotal: 1100, limit: 1050, withinLimit: false });
  });

  it('needs the pay to be known, and never starts in a past month', async () => {
    await expect(service({ gross: null }).svc.evaluateLoan('co', 'e1', { kind: 'ADVANCE', amount: 500, instalments: 1, startMonth: '2026-11', reason: 'x' })).rejects.toMatchObject({ code: 'NO_PAY' });
    await expect(service().svc.evaluateLoan('co', 'e1', { kind: 'ADVANCE', amount: 500, instalments: 1, startMonth: '2026-09', reason: 'x' })).rejects.toMatchObject({ code: 'PAST_MONTH' });
  });

  it('an advance is always one instalment', async () => {
    const e = await service().svc.evaluateLoan('co', 'e1', { kind: 'ADVANCE', amount: 1000, instalments: 12, startMonth: '2026-11', reason: 'x' });
    expect(e.schedule).toHaveLength(1);
  });
});

describe('approving and repaying', () => {
  const pending = { id: 'l1', employeeId: 'e1', kind: 'LOAN', amount: 3000, instalmentCount: 3, startMonth: '2026-11', reason: 'x', status: 'PENDING' };

  it('approval creates the schedule and records the approver', async () => {
    const { svc, tx } = service({ loan: pending });
    await svc.decideLoan('co', 'l1', true, 'ok', { type: 'USER', id: 'u-mgr' }, undefined);
    expect(tx.employeeLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', decidedById: 'u-mgr' }) }));
    expect(tx.loanInstalment.createMany).toHaveBeenCalledWith({ data: [
      { loanId: 'l1', seq: 1, month: '2026-11', amount: 1000 },
      { loanId: 'l1', seq: 2, month: '2026-12', amount: 1000 },
      { loanId: 'l1', seq: 3, month: '2027-01', amount: 1000 },
    ] });
  });

  it('postponing moves the instalment after the last one', async () => {
    const loan = { ...pending, status: 'APPROVED', instalments: [
      { id: 'i1', seq: 1, month: '2026-11', amount: 1000, status: 'DUE' },
      { id: 'i2', seq: 2, month: '2026-12', amount: 1000, status: 'DUE' },
    ] };
    const { svc, tx } = service({ loan });
    await svc.postpone('co', 'e1', 'l1', 'i1', ACTOR);
    expect(tx.loanInstalment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ seq: 3, month: '2027-01', amount: 1000 }) });
  });

  it('once repayment has started, the loan cannot be cancelled — only settled', async () => {
    const loan = { ...pending, status: 'APPROVED', instalments: [{ id: 'i1', status: 'DEDUCTED' }] };
    await expect(service({ loan }).svc.cancelLoan('co', 'e1', 'l1', ACTOR)).rejects.toMatchObject({ code: 'REPAYMENT_STARTED' });
  });
});

describe('one-off payments', () => {
  it('the category must match earning or deduction', async () => {
    await expect(service().svc.requestPayment('co', 'e1', { kind: 'DEDUCTION', category: 'BONUS', amount: 100, month: '2026-11', reason: 'x' }, ACTOR)).rejects.toMatchObject({ code: 'BAD_CATEGORY' });
  });
});
