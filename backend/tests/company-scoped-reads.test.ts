/**
 * Dashboard, reports and exports read only the actor's company (and a
 * manager's subtree), and their caches never replay one company's numbers
 * to another. Records every query the services send to a fake client.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { ReportsService } from '../src/modules/reports/reports.service.js';
import { auditScope, withScope, type EmployeeScope } from '../src/auth/authz/authorize.js';

const A: EmployeeScope = { companyId: 'cA' };
const B: EmployeeScope = { companyId: 'cB' };
const BRANCH: EmployeeScope = { companyId: 'cA', OR: [{ orgUnit: { path: { startsWith: '/hq/cs/' } } }] };

/** A Prisma stand-in that records every `where` and returns empty results. */
function recordingPrisma() {
  const calls: Array<{ model: string; op: string; where: unknown }> = [];
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => (args: { where?: unknown } = {}) => {
          calls.push({ model: name, op, where: args.where });
          return Promise.resolve(op === 'count' ? 0 : []);
        },
      },
    );
  const prisma = new Proxy({}, { get: (_t, name: string) => model(name) });
  return { prisma, calls };
}

const mentions = (where: unknown, companyId: string) => JSON.stringify(where ?? null).includes(`"companyId":"${companyId}"`);

describe('withScope / auditScope', () => {
  it('ANDs the scope onto a filter, so two ORs (search + subtree) never overwrite each other', () => {
    const search = { OR: [{ firstName: { contains: 'sa' } }] };
    expect(withScope(search, BRANCH)).toEqual({ AND: [search, BRANCH] });
    expect(withScope(search, undefined)).toBe(search);
  });

  it('a company-wide audit scope includes company-level rows; a branch scope only its employees', () => {
    expect(auditScope(A)).toEqual({ OR: [{ employee: { companyId: 'cA' } }, { companyId: 'cA', employeeId: null }] });
    expect(auditScope(BRANCH)).toEqual({ employee: BRANCH });
  });
});

describe('DashboardService', () => {
  it('every query it sends is limited to the company', async () => {
    const { prisma, calls } = recordingPrisma();
    await new DashboardService(prisma as never).summary(A);
    expect(calls.length).toBeGreaterThanOrEqual(13);
    const unscoped = calls.filter((c) => !mentions(c.where, 'cA'));
    expect(unscoped).toEqual([]);
  });

  it('a branch manager\'s dashboard carries the subtree too', async () => {
    const { prisma, calls } = recordingPrisma();
    await new DashboardService(prisma as never).summary(BRANCH);
    const employeeReads = calls.filter((c) => c.model === 'employee');
    expect(employeeReads.length).toBeGreaterThan(0);
    for (const c of employeeReads) expect(JSON.stringify(c.where)).toContain('/hq/cs/');
  });

  it('the cache is per company: B is computed fresh, never served A\'s numbers', async () => {
    const { prisma, calls } = recordingPrisma();
    const service = new DashboardService(prisma as never);
    await service.summary(A);
    const afterA = calls.length;
    await service.summary(A); // cached
    expect(calls.length).toBe(afterA);
    await service.summary(B); // different company → real queries, all for B
    const forB = calls.slice(afterA);
    expect(forB.length).toBe(afterA);
    expect(forB.every((c) => mentions(c.where, 'cB'))).toBe(true);
  });
});

describe('ReportsService', () => {
  it('the on-screen summary is limited to the company, with a per-company cache', async () => {
    const { prisma, calls } = recordingPrisma();
    const service = new ReportsService(prisma as never);
    await service.summary(A);
    expect(calls.filter((c) => !mentions(c.where, 'cA'))).toEqual([]);
    const afterA = calls.length;
    await service.summary(B);
    expect(calls.slice(afterA).every((c) => mentions(c.where, 'cB'))).toBe(true);
  });

  it.each([
    ['employees', (s: ReportsService, out: PassThrough) => s.streamEmployees(out, A)],
    ['onboarding', (s: ReportsService, out: PassThrough) => s.streamOnboarding(out, A)],
    ['expiring documents', (s: ReportsService, out: PassThrough) => s.streamExpiringDocuments(out, A)],
    ['audit', (s: ReportsService, out: PassThrough) => s.streamAudit(out, 30, A)],
  ])('the %s export only reads the company', async (_name, run) => {
    const { prisma, calls } = recordingPrisma();
    const out = new PassThrough();
    out.resume();
    await run(new ReportsService(prisma as never), out);
    const reads = calls.filter((c) => c.op === 'findMany');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => mentions(c.where, 'cA'))).toBe(true);
  });
});
