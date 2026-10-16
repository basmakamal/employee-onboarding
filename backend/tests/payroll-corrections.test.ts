/**
 * Corrections after approval: reopening an approved run undoes what the
 * approval did (and is refused once paid or once payslips went out); a
 * correction of a paid month is a one-off payment in a later month that
 * names the month it corrects.
 */
import { describe, expect, it, vi } from 'vitest';
import { PayrollService } from '../src/modules/payroll/payroll.service.js';
import { LoanService } from '../src/modules/payroll/loan.service.js';

const ACTOR = { type: 'USER' as const, id: 'u-mgr' };
const RUN = { id: 'r1', companyId: 'co', month: '2026-10', status: 'APPROVED', periodFrom: new Date('2026-09-26'), periodTo: new Date('2026-10-25'), lines: [{ employeeId: 'e1', held: false }, { employeeId: 'e2', held: true }] };

function reopenService(run: object, sentDeliveries = 0) {
  const tx = {
    payrollRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    attendanceDay: { updateMany: vi.fn() },
    loanInstalment: { findMany: vi.fn().mockResolvedValue([{ loanId: 'l1' }]), updateMany: vi.fn() },
    employeeLoan: { updateMany: vi.fn() },
    oneTimePayment: { updateMany: vi.fn() },
    payslip: { deleteMany: vi.fn() },
  };
  const db = {
    payrollRun: { findFirst: vi.fn().mockResolvedValue(run) },
    payslipDelivery: { count: vi.fn().mockResolvedValue(sentDeliveries) },
    payslip: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const svc = new PayrollService(db as never, {} as never, {} as never, { getCalendar: vi.fn() }, { append: vi.fn() } as never);
  vi.spyOn(svc, 'get').mockResolvedValue({} as never);
  return { svc, tx };
}

describe('reopening an approved run', () => {
  it('undoes the approval: attendance unlocked, instalments and payments unpaid, payslips removed', async () => {
    const { svc, tx } = reopenService(RUN);
    await svc.reopen('co', 'r1', 'wrong allowance for two people', ACTOR);
    expect(tx.payrollRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CALCULATED', approvedById: null, reopenReason: 'wrong allowance for two people' }) }));
    expect(tx.attendanceDay.updateMany).toHaveBeenCalledWith({ where: { employeeId: { in: ['e1'] }, date: { gte: RUN.periodFrom, lte: RUN.periodTo } }, data: { locked: false } });
    expect(tx.loanInstalment.updateMany).toHaveBeenCalledWith({ where: { payrollRunId: 'r1' }, data: { status: 'DUE', payrollRunId: null, settledAt: null } });
    expect(tx.employeeLoan.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['l1'] }, status: 'SETTLED', closedById: null }, data: { status: 'APPROVED', closedAt: null } });
    expect(tx.oneTimePayment.updateMany).toHaveBeenCalledWith({ where: { payrollRunId: 'r1' }, data: { status: 'APPROVED', payrollRunId: null } });
    expect(tx.payslip.deleteMany).toHaveBeenCalledWith({ where: { runId: 'r1' } });
  });

  it('a paid run, or one whose payslips went out, is corrected in the next month instead', async () => {
    await expect(reopenService({ ...RUN, status: 'PAID' }).svc.reopen('co', 'r1', 'x y z', ACTOR)).rejects.toMatchObject({ code: 'RUN_PAID' });
    await expect(reopenService(RUN, 3).svc.reopen('co', 'r1', 'x y z', ACTOR)).rejects.toMatchObject({ code: 'PAYSLIPS_SENT' });
  });
});

describe('correcting a paid month', () => {
  function loanService(corrected: object | null) {
    const db = {
      employee: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      payrollRun: { findFirst: vi.fn().mockResolvedValue(corrected) },
      oneTimePayment: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
    };
    const pay = { todayOf: vi.fn().mockResolvedValue('2026-11-03') };
    return { svc: new LoanService(db as never, pay as never, { append: vi.fn() } as never), db };
  }
  const input = { kind: 'EARNING' as const, category: 'CORRECTION', amount: 250, month: '2026-11', reason: 'housing missed in October', correctsRunId: 'r1' };

  it('is a one-off payment in a later month, naming the month it corrects', async () => {
    const { svc, db } = loanService({ month: '2026-10' });
    await svc.requestPayment('co', 'e1', input, ACTOR);
    expect(db.oneTimePayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ category: 'CORRECTION', correctsRunId: 'r1', month: '2026-11' }) });
  });

  it('needs an approved month the person was in, and a later month to pay it', async () => {
    await expect(loanService(null).svc.requestPayment('co', 'e1', input, ACTOR)).rejects.toMatchObject({ code: 'BAD_RUN' });
    await expect(loanService({ month: '2026-11' }).svc.requestPayment('co', 'e1', input, ACTOR)).rejects.toMatchObject({ code: 'BAD_MONTH' });
    await expect(loanService({ month: '2026-10' }).svc.requestPayment('co', 'e1', { ...input, correctsRunId: undefined }, ACTOR)).rejects.toMatchObject({ code: 'BAD_CATEGORY' });
  });
});
