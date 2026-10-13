/**
 * Phase 6 — company scope on the HR services, and placement validation.
 * Negative first: a branch manager must not reach a sibling branch, and no
 * id from a form is trusted against the active company.
 */
import { describe, expect, it, vi } from 'vitest';
import { actorScope } from '../src/auth/authz/authorize.js';
import { resolvePlacement } from '../src/modules/employees/org-placement.js';
import { EmployeeService } from '../src/modules/employees/employee.service.js';
import type { Actor } from '../src/workflow/engine.js';

const HR_RIYADA: Actor = {
  type: 'USER', id: 'u-hr', role: 'HR', permissions: ['employees.write'],
  companyId: 'c1', scope: { companyId: 'c1', all: true, orgUnitPaths: [] },
};
const BRANCH_MGR: Actor = {
  type: 'USER', id: 'u-bm', role: 'UNIT_MANAGER', permissions: ['employees.read'],
  companyId: 'c1', scope: { companyId: 'c1', all: false, orgUnitPaths: ['/hq/cs/'] },
};
const LEGACY: Actor = { type: 'USER', id: 'u-old', role: 'HR' };

describe('actorScope', () => {
  it('company-wide → companyId only; unit → companyId + subtree prefixes; no company → no filter', () => {
    expect(actorScope(HR_RIYADA)).toEqual({ companyId: 'c1' });
    expect(actorScope(BRANCH_MGR)).toEqual({ companyId: 'c1', OR: [{ orgUnit: { path: { startsWith: '/hq/cs/' } } }] });
    expect(actorScope(LEGACY)).toBeUndefined();
    expect(actorScope({ type: 'LINK', id: 't1' })).toBeUndefined();
  });
});

describe('resolvePlacement', () => {
  const lookups = {
    findOrgUnit: vi.fn(async (companyId: string, id: string) =>
      ({
        'c1:u-cs': { id: 'u-cs', path: '/hq/cs/', active: true, nameAr: 'خدمة العملاء', nameEn: 'Customer Service' },
        'c1:u-it': { id: 'u-it', path: '/hq/it/', active: true, nameAr: 'تقنية', nameEn: 'IT' },
        'c1:u-old': { id: 'u-old', path: '/hq/old/', active: false, nameAr: 'x', nameEn: 'Old' },
      })[`${companyId}:${id}`] ?? null,
    ),
    findPosition: vi.fn(async (companyId: string, id: string) =>
      ({ 'c1:p-csr': { id: 'p-csr', active: true, titleAr: 'ممثل', titleEn: 'Customer Service Representative' } })[`${companyId}:${id}`] ?? null,
    ),
    findColleague: vi.fn(async (companyId: string, id: string) =>
      ({ 'c1:e-boss': { id: 'e-boss', firstName: 'Faisal', lastName: 'Alharbi' } })[`${companyId}:${id}`] ?? null,
    ),
  };

  it('resolves ids inside the company and mirrors the legacy text columns', async () => {
    const out = await resolvePlacement(lookups, HR_RIYADA, { orgUnitId: 'u-cs', positionId: 'p-csr', managerId: 'e-boss' });
    expect(out).toEqual({
      companyId: 'c1', orgUnitId: 'u-cs', positionId: 'p-csr', managerId: 'e-boss',
      department: 'Customer Service', jobTitle: 'Customer Service Representative', directManager: 'Faisal Alharbi',
    });
  });

  it('refuses a unit / title / manager that is not in the company, or inactive', async () => {
    await expect(resolvePlacement(lookups, HR_RIYADA, { orgUnitId: 'u-other-company' })).rejects.toMatchObject({ code: 'BAD_ORG_UNIT' });
    await expect(resolvePlacement(lookups, HR_RIYADA, { orgUnitId: 'u-old' })).rejects.toMatchObject({ code: 'BAD_ORG_UNIT' });
    await expect(resolvePlacement(lookups, HR_RIYADA, { positionId: 'p-nope' })).rejects.toMatchObject({ code: 'BAD_POSITION' });
    await expect(resolvePlacement(lookups, HR_RIYADA, { managerId: 'e-nope' })).rejects.toMatchObject({ code: 'BAD_MANAGER' });
    await expect(resolvePlacement(lookups, HR_RIYADA, { managerId: 'e-self' }, { selfId: 'e-self' })).rejects.toMatchObject({ code: 'BAD_MANAGER' });
  });

  it('a branch manager can only place people inside their own subtree', async () => {
    await expect(resolvePlacement(lookups, BRANCH_MGR, { orgUnitId: 'u-it' })).rejects.toMatchObject({ code: 'OUT_OF_SCOPE' });
    const ok = await resolvePlacement(lookups, BRANCH_MGR, { orgUnitId: 'u-cs' });
    expect(ok.orgUnitId).toBe('u-cs');
  });

  it('null clears; undefined leaves a field alone; no company → nothing is set', async () => {
    expect(await resolvePlacement(lookups, HR_RIYADA, { orgUnitId: null })).toEqual({ companyId: 'c1', orgUnitId: null });
    expect(await resolvePlacement(lookups, HR_RIYADA, {})).toEqual({ companyId: 'c1' });
    expect(await resolvePlacement(lookups, LEGACY, { orgUnitId: 'u-cs' })).toEqual({});
  });
});

describe('EmployeeService under a scope', () => {
  function makeService() {
    const repos = {
      employees: {
        listPaged: vi.fn().mockResolvedValue({ items: [], total: 0 }),
        statusCounts: vi.fn().mockResolvedValue({ all: 0, onboarding: 0, active: 0, inactive: 0 }),
        findById: vi.fn().mockImplementation((id: string, scope?: { companyId: string }) =>
          // the fake "database": e1 is in c1, e2 in c2
          Promise.resolve(id === 'e1' && (!scope || scope.companyId === 'c1') ? { id: 'e1', companyId: 'c1', photoKey: null } : id === 'e2' && !scope ? { id: 'e2', companyId: 'c2' } : null),
        ),
        findWithDetails: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation((id: string, data: Record<string, unknown>) => Promise.resolve({ id, ...data })),
        findOrgUnit: vi.fn().mockResolvedValue(null),
        findPosition: vi.fn().mockResolvedValue(null),
        findColleague: vi.fn().mockResolvedValue(null),
        allocateEmployeeNo: vi.fn().mockResolvedValue('EMP-1'),
        createDirect: vi.fn().mockImplementation((data: Record<string, unknown>) => Promise.resolve({ id: 'new', ...data })),
      },
      requests: { create: vi.fn(), findById: vi.fn(), setDocument: vi.fn() },
      gosi: { findByEmployee: vi.fn() }, medical: { findByEmployee: vi.fn() }, criminal: { findByEmployee: vi.fn() },
      audit: { append: vi.fn().mockResolvedValue({}) },
    };
    const transact = (fn: (s: typeof repos) => Promise<unknown>) => fn(repos);
    const service = new EmployeeService(repos as never, transact as never);
    return { service, repos };
  }

  it('list and counts are filtered by the actor scope', async () => {
    const { service, repos } = makeService();
    await service.list({ page: 1, limit: 10, sortBy: 'createdAt', sortDir: 'desc' } as never, BRANCH_MGR);
    expect(repos.employees.listPaged).toHaveBeenCalledWith(expect.anything(), { companyId: 'c1', OR: [{ orgUnit: { path: { startsWith: '/hq/cs/' } } }] });
    expect(repos.employees.statusCounts).toHaveBeenCalledWith({ companyId: 'c1', OR: [{ orgUnit: { path: { startsWith: '/hq/cs/' } } }] });
  });

  it('an employee of another company is not found, even by exact id', async () => {
    const { service } = makeService();
    await expect(service.update('e2', { firstName: 'x' }, HR_RIYADA)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getPhotoKey('e2', HR_RIYADA)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // …while a legacy actor (no company) still reaches it
    await expect(service.update('e2', { firstName: 'x' }, LEGACY)).resolves.toBeTruthy();
  });

  it('createDirect stamps the actor company and never a company from the body', async () => {
    const { service, repos } = makeService();
    await service.createDirect({ firstName: 'A', lastName: 'B', email: 'a@b.c', ...({ companyId: 'c-evil' } as object) }, HR_RIYADA);
    expect(repos.employees.createDirect).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'c1' }));
  });

  it('a bad unit id on create is refused before anything is written', async () => {
    const { service, repos } = makeService();
    await expect(service.createDirect({ firstName: 'A', lastName: 'B', email: 'a@b.c', orgUnitId: 'u-ghost' }, HR_RIYADA)).rejects.toMatchObject({ code: 'BAD_ORG_UNIT' });
    expect(repos.employees.createDirect).not.toHaveBeenCalled();
  });
});
