/**
 * Release check — one company never touches another's records. Each action
 * that takes a record id (decide a request, hold a line, approve a run,
 * download a payslip, reveal an IBAN…) is called as company B with ids that
 * belong elsewhere. The database stand-in finds nothing, so every action must
 * stop — after a lookup that carried company B (and the branch, for a branch
 * manager). Writes are allowed only as guarded updates that carry company B
 * too, so they can never match another company's row.
 */
import { describe, expect, it } from 'vitest';
import { LeaveService } from '../src/modules/workforce/leave.service.js';
import { AttendanceService } from '../src/modules/workforce/attendance.service.js';
import { LoanService } from '../src/modules/payroll/loan.service.js';
import { PayrollService } from '../src/modules/payroll/payroll.service.js';
import { PayslipService } from '../src/modules/payroll/payslip.service.js';
import { CompensationService } from '../src/modules/payroll/compensation.service.js';
import type { EmployeeScope } from '../src/auth/authz/authorize.js';

const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const ACTOR = { type: 'USER' as const, id: 'u-b' };
const BRANCH: EmployeeScope = { companyId: 'cB', OR: [{ orgUnit: { path: { startsWith: '/b-branch/' } } }] };

/** Finds nothing, records every call. */
function recordingDb() {
  const calls: Array<{ model: string; op: string; where: string }> = [];
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => (args: { where?: unknown } = {}) => {
        calls.push({ model: name, op, where: JSON.stringify(args.where ?? null) });
        if (op === 'count') return Promise.resolve(0);
        if (op === 'findMany') return Promise.resolve([]);
        if (op.startsWith('find')) return Promise.resolve(null);
        return Promise.resolve({ count: 0 });
      },
    });
  const db: unknown = new Proxy({}, {
    get: (_t, name: string) =>
      name === '$transaction' ? (fn: unknown) => (typeof fn === 'function' ? fn(db) : Promise.all(fn as unknown[])) : model(name),
  });
  return { db: db as never, calls };
}

const none = new Proxy({}, { get: () => () => Promise.resolve(null) }) as never;
const calendar = { getCalendar: () => Promise.resolve({ weekendDays: [5, 6] }) };

function services() {
  const { db, calls } = recordingDb();
  const pay = new CompensationService(db, none);
  return {
    calls,
    leave: new LeaveService(db, none, calendar, none),
    attendance: new AttendanceService(db, none, none),
    loans: new LoanService(db, pay, none),
    payroll: new PayrollService(db, pay, none, calendar, none),
    payslips: new PayslipService(db, pay, none, none),
    pay,
  };
}

type Svc = ReturnType<typeof services>;
/** `scope` is undefined for a company-wide manager (the case that relies on the company check alone). */
const CASES: Array<[string, string, (s: Svc, scope?: EmployeeScope) => Promise<unknown>]> = [
  ['decide a leave request', 'req-A', (s, scope) => s.leave.decide('cB', 'req-A', true, undefined, ACTOR, scope)],
  ['decide overtime', 'ot-A', (s, scope) => s.attendance.decideOvertime('cB', 'ot-A', true, undefined, undefined, ACTOR, scope)],
  ['decide a loan', 'loan-A', (s, scope) => s.loans.decideLoan('cB', 'loan-A', true, undefined, ACTOR, scope)],
  ['decide a one-time payment', 'pay-A', (s, scope) => s.loans.decidePayment('cB', 'pay-A', true, undefined, ACTOR, scope)],
  ['settle a loan', 'loan-A', (s) => s.loans.settle('cB', 'emp-A', 'loan-A', 'paid in cash', ACTOR)],
  ['postpone an instalment', 'loan-A', (s) => s.loans.postpone('cB', 'emp-A', 'loan-A', 'inst-A', ACTOR)],
  ['open a payroll run', 'run-A', (s) => s.payroll.get('cB', 'run-A')],
  ['hold a payroll line', 'line-A', (s) => s.payroll.hold('cB', 'run-A', 'line-A', true, 'waiting for papers', ACTOR)],
  ['approve a payroll run', 'run-A', (s) => s.payroll.approve('cB', 'run-A', undefined, ACTOR)],
  ['reopen a payroll run', 'run-A', (s) => s.payroll.reopen('cB', 'run-A', 'wrong overtime', ACTOR)],
  ['mark a run paid', 'run-A', (s) => s.payroll.markPaid('cB', 'run-A', ACTOR)],
  ['cancel a run', 'run-A', (s) => s.payroll.cancel('cB', 'run-A', ACTOR)],
  ['download a payslip', 'line-A', (s) => s.payslips.download('cB', 'line-A', ACTOR, {})],
  ['reveal an IBAN', 'emp-A', (s) => s.pay.revealIban('cB', 'emp-A', ACTOR)],
];

describe('another company\'s record id goes nowhere', () => {
  for (const [what, id, act] of CASES) {
    it(what, async () => {
      const s = services();
      // "not found", or — for a guarded one-step update — "not in that state"
      await expect(act(s)).rejects.toMatchObject({ code: expect.stringMatching(/^(NOT_FOUND|RUN_CLOSED)$/) });
      const lookups = s.calls.filter((c) => c.where.includes(`"${id}"`));
      expect(lookups.length, 'the record was looked up').toBeGreaterThan(0);
      for (const c of lookups) expect(c.where, `${c.model}.${c.op}`).toContain('"companyId":"cB"');
      const unguarded = s.calls.filter((c) => WRITES.has(c.op) && !c.where.includes('"companyId":"cB"'));
      expect(unguarded.map((c) => `${c.model}.${c.op}`)).toEqual([]);
    });
  }

  it('a branch manager\'s decisions only find requests in their branch', async () => {
    for (const [, id, act] of CASES.slice(0, 4)) {
      const s = services();
      await act(s, BRANCH).catch(() => undefined);
      expect(s.calls.find((c) => c.where.includes(`"${id}"`))!.where).toContain('/b-branch/');
    }
  });
});
