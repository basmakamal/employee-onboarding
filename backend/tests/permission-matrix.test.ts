/**
 * Release check — who reaches what. Every workforce, leave, payroll, payslip
 * and report route is mounted with stand-in services and called for real as
 * each built-in role. A role without the route's permission must get 403
 * before anything else runs (validation included); a role with it must not.
 *
 * On top of that mechanical check, the business rules in plain words:
 * salaries stay with the people who handle pay, only a company manager or
 * the super admin approves a payroll run, and requests are approved by
 * managers — not by the HR officer who entered them.
 */
import { Router, type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { listRoutes } from '../src/docs/openapi.js';
import { SYSTEM_ROLES } from '../src/auth/authz/permissions.js';
import { approvalsRouter } from '../src/modules/workforce/approvals.routes.js';
import { attendanceRouter, employeeAttendanceRouter } from '../src/modules/workforce/attendance.routes.js';
import { employeeLeaveRouter, leaveRouter } from '../src/modules/workforce/leave.routes.js';
import { employeeScheduleRouter, workforceRouter } from '../src/modules/workforce/workforce.routes.js';
import { employeeCompensationRouter, payrollSetupRouter } from '../src/modules/payroll/compensation.routes.js';
import { employeeLoanRouter, loanRouter } from '../src/modules/payroll/loan.routes.js';
import { payrollRunRouter } from '../src/modules/payroll/payroll.routes.js';
import { employeePayslipRouter, payslipRouter } from '../src/modules/payroll/payslip.routes.js';
import { workforceReportsRouter } from '../src/modules/reports/workforce-reports.routes.js';

/** Any method of any service resolves to nothing — the handler may then fail; only the gate matters here. */
const stub = new Proxy({}, { get: () => () => Promise.resolve(null) }) as never;
/** A Prisma stand-in: every model, every operation, empty. */
const db = new Proxy({}, { get: () => new Proxy({}, { get: (_t, op: string) => () => Promise.resolve(op === 'count' ? 0 : []) }) }) as never;

const ROLE_CODES = SYSTEM_ROLES.map((r) => r.code);
const permissionsOf = (role: string) => SYSTEM_ROLES.find((r) => r.code === role)!.permissions;

function appAs(role: string): Express {
  const staff = Router();
  staff.use((req, _res, next) => {
    const unit = role === 'UNIT_MANAGER';
    req.actor = {
      type: 'USER', id: 'u-1', roles: [role], permissions: [...permissionsOf(role)], companyId: 'c-1',
      scope: { companyId: 'c-1', all: !unit, orgUnitPaths: unit ? ['/branch/'] : [] },
    };
    next();
  });
  staff.use('/workforce', workforceRouter(stub, db));
  staff.use('/employees', employeeScheduleRouter(stub));
  staff.use('/attendance', attendanceRouter(stub, db));
  staff.use('/employees', employeeAttendanceRouter(stub));
  staff.use('/leave', leaveRouter(stub, db));
  staff.use('/employees', employeeLeaveRouter(stub));
  staff.use('/approvals', approvalsRouter(db));
  staff.use('/payroll', payrollSetupRouter(stub));
  staff.use('/employees', employeeCompensationRouter(stub));
  staff.use('/payroll', loanRouter(stub));
  staff.use('/payroll', payrollRunRouter(stub));
  staff.use('/payroll', payslipRouter(stub));
  staff.use('/employees', employeePayslipRouter(stub));
  staff.use('/hr-reports', workforceReportsRouter(stub));
  staff.use('/employees', employeeLoanRouter(stub));
  return createApp({ staffRouter: staff });
}

const apps = new Map(ROLE_CODES.map((r) => [r, appAs(r)]));
const ROUTES = listRoutes(apps.get('SUPER_ADMIN')!)
  .filter((r) => !['/api/health', '/api/ready'].includes(r.path)) // public probes, not part of the staff API
  .map((r) => ({
  method: r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: r.path,
  name: `${r.method.toUpperCase()} ${r.path}`,
  permissions: r.docs.flatMap((d) => d.permissions ?? []),
}));

const mayReach = (role: string, route: { permissions: readonly string[] }) => route.permissions.some((p) => (permissionsOf(role) as readonly string[]).includes(p));
const route = (name: string) => {
  const found = ROUTES.find((r) => r.name === name);
  if (!found) throw new Error(`no route ${name}`);
  return found;
};
const whoReaches = (name: string) => ROLE_CODES.filter((role) => mayReach(role, route(name)));

describe('every route has a gate', () => {
  it('the modules were found and none is open to every signed-in user', () => {
    expect(ROUTES.length).toBeGreaterThan(80);
    expect(ROUTES.filter((r) => r.permissions.length === 0).map((r) => r.name)).toEqual([]);
  });
});

describe('the gate runs first, for every role on every route', () => {
  for (const role of ROLE_CODES) {
    it(role, async () => {
      const wrong: string[] = [];
      for (const r of ROUTES) {
        const url = r.path.replace(/:[A-Za-z]+/g, 'x');
        const res = await request(apps.get(role)!)[r.method](url).send({});
        const allowed = mayReach(role, r);
        if (allowed && res.status === 403) wrong.push(`${r.name}: refused but should pass`);
        if (!allowed && res.status !== 403) wrong.push(`${r.name}: answered ${res.status}, should be 403`);
      }
      expect(wrong).toEqual([]);
    }, 30_000);
  }
});

describe('business rules', () => {
  const MANAGERS = ['SUPER_ADMIN', 'COMPANY_MANAGER'];
  const PAY_PEOPLE = ['SUPER_ADMIN', 'COMPANY_MANAGER', 'HR', 'PAYROLL_OFFICER'];

  it('salaries, payslips, IBANs and the bank list stay with the people who handle pay', () => {
    for (const name of [
      'GET /api/employees/:id/compensation', 'GET /api/employees/:id/iban', 'GET /api/employees/:id/payslips',
      'GET /api/payroll/runs', 'GET /api/payroll/runs/:id', 'GET /api/hr-reports/payroll/:runId/register.xlsx',
      'GET /api/hr-reports/payroll/:runId/bank.xlsx', 'GET /api/employees/:id/loans',
    ]) expect(whoReaches(name), name).toEqual(PAY_PEOPLE);
  });

  it('a branch manager, insurance, IT and finance reach no pay route except approving requests', () => {
    const payRoute = (n: string) => /\/(payroll|compensation|iban|payslips?|loans|payments)\b|hr-reports\/payroll/.test(n);
    const allowedForApprovers = ['GET /api/payroll/money', 'POST /api/payroll/loans/:id/decision', 'POST /api/payroll/payments/:id/decision'];
    for (const role of ['UNIT_MANAGER', 'INSURANCE', 'IT', 'FINANCE']) {
      const reached = ROUTES.filter((r) => payRoute(r.name) && mayReach(role, r)).map((r) => r.name);
      expect(reached, role).toEqual(role === 'UNIT_MANAGER' ? allowedForApprovers : []);
    }
  });

  it('only a company manager or the super admin approves or reopens a payroll run', () => {
    expect(whoReaches('POST /api/payroll/runs/:id/approve')).toEqual(MANAGERS);
    expect(whoReaches('POST /api/payroll/runs/:id/reopen')).toEqual(MANAGERS);
  });

  it('HR and the payroll officer prepare a run but cannot approve it', () => {
    expect(whoReaches('POST /api/payroll/runs')).toEqual(PAY_PEOPLE);
    expect(whoReaches('POST /api/payroll/runs/:id/recalculate')).toEqual(PAY_PEOPLE);
  });

  it('leave, overtime, loans and one-time payments are approved by managers, never by HR who entered them', () => {
    for (const name of [
      'POST /api/leave/requests/:id/decision', 'POST /api/attendance/overtime/:id/decision',
      'POST /api/payroll/loans/:id/decision', 'POST /api/payroll/payments/:id/decision',
    ]) expect(whoReaches(name), name).toEqual(['SUPER_ADMIN', 'COMPANY_MANAGER', 'UNIT_MANAGER']);
  });

  it('only HR and the managers above it change shifts, record attendance and enter leave', () => {
    for (const name of ['POST /api/employees/:id/attendance/punches', 'POST /api/employees/:id/leave/requests', 'POST /api/employees/:id/leave/adjustments']) {
      expect(whoReaches(name), name).toEqual(['SUPER_ADMIN', 'COMPANY_MANAGER', 'HR']);
    }
  });
});
