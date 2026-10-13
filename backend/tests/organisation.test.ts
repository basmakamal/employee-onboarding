/**
 * Phase 5 — the organisation of one company: tree rules, titles, manager
 * seats and their assignments. In-memory fake of the Prisma client.
 */
import { describe, expect, it, vi } from 'vitest';
import { OrgService } from '../src/modules/organisation/org.service.js';
import { AssignmentService } from '../src/auth/assignment.service.js';
import type { CompanyContext } from '../src/auth/authz/authorize.js';

type Row = Record<string, unknown>;

/** Just enough Prisma to exercise the services: filters by equality / startsWith, counts, transactions. */
function fakePrisma() {
  const tables: Record<string, Row[]> = {
    orgUnit: [], position: [], user: [
      { id: 'u-mgr', active: true }, { id: 'u-old', active: true }, { id: 'u-off', active: false },
    ],
    userAssignment: [], roleDefinition: [
      { id: 'r-cm', code: 'COMPANY_MANAGER', active: true, system: true, level: 'COMPANY' },
      { id: 'r-um', code: 'UNIT_MANAGER', active: true, system: true, level: 'UNIT' },
      { id: 'r-hr', code: 'HR', active: true, system: true, level: 'COMPANY' },
    ],
    rolePermission: [], company: [{ id: 'c1' }, { id: 'c2' }], employee: [],
  };
  let seq = 0;
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'companyId_code') { const w = v as Row; return row['companyId'] === w['companyId'] && row['code'] === w['code']; }
      if (v && typeof v === 'object' && 'startsWith' in (v as Row)) return String(row[k]).startsWith(String((v as Row)['startsWith']));
      return row[k] === v;
    });
  const withCounts = (name: string, row: Row): Row => {
    if (name === 'orgUnit') {
      return {
        ...row,
        manager: row['managerId'] ? { id: row['managerId'], name: 'M', email: 'm@x' } : null,
        _count: {
          children: tables.orgUnit!.filter((r) => r['parentId'] === row['id']).length,
          employees: tables.employee!.filter((r) => r['orgUnitId'] === row['id']).length,
        },
      };
    }
    if (name === 'position') return { ...row, _count: { employees: tables.employee!.filter((r) => r['positionId'] === row['id']).length } };
    if (name === 'roleDefinition') return { ...row, permissions: tables.rolePermission!.filter((r) => r['roleId'] === row['id']), _count: { assignments: tables.userAssignment!.filter((r) => r['roleId'] === row['id']).length } };
    return row;
  };
  const model = (name: string) => ({
    findMany: vi.fn(async ({ where }: { where?: Row } = {}) => tables[name]!.filter((r) => matches(r, where)).map((r) => withCounts(name, r))),
    findFirst: vi.fn(async ({ where }: { where?: Row }) => { const r = tables[name]!.find((x) => matches(x, where)); return r ? withCounts(name, r) : null; }),
    findUnique: vi.fn(async ({ where }: { where: Row }) => { const r = tables[name]!.find((x) => matches(x, where)); return r ? withCounts(name, r) : null; }),
    count: vi.fn(async ({ where }: { where?: Row } = {}) => tables[name]!.filter((r) => matches(r, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `${name}-${++seq}`, ...data }; tables[name]!.push(row); return withCounts(name, row); }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => { for (const d of data) tables[name]!.push({ id: `${name}-${++seq}`, ...d }); return { count: data.length }; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const r = tables[name]!.find((x) => matches(x, where)) as Row; Object.assign(r, data); return withCounts(name, r); }),
    delete: vi.fn(async ({ where }: { where: Row }) => { const i = tables[name]!.findIndex((x) => matches(x, where)); const [r] = tables[name]!.splice(i, 1); return r; }),
    deleteMany: vi.fn(async ({ where }: { where?: Row } = {}) => { const before = tables[name]!.length; tables[name] = tables[name]!.filter((r) => !matches(r, where)); return { count: before - tables[name]!.length }; }),
  });
  const db: Row = {};
  for (const name of Object.keys(tables)) db[name] = model(name);
  db['$transaction'] = async (fn: (tx: Row) => Promise<unknown>) => fn(db);
  return { db, tables };
}

function setup() {
  const { db, tables } = fakePrisma();
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const assignments = new AssignmentService(db as never, audit as never);
  const org = new OrgService(db as never, audit as never, assignments);
  const ctx = (companyId = 'c1'): CompanyContext => ({
    companyId,
    actor: { type: 'USER', id: 'u-admin', role: 'ADMIN' },
    scope: { companyId, all: true, orgUnitPaths: [] },
  });
  return { org, assignments, tables, audit, ctx };
}

describe('OrgService — the department tree', () => {
  it('builds materialised paths and depths, upper-cases codes, refuses a duplicate code', async () => {
    const { org, ctx } = setup();
    const cs = await org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'cs', nameAr: 'خدمة العملاء', nameEn: 'Customer Service' });
    const call = await org.createUnit(ctx(), { parentId: cs.id, type: 'DEPARTMENT', code: 'CS-CALL', nameAr: 'مركز الاتصال', nameEn: 'Call Center' });
    expect(cs.code).toBe('CS');
    expect(cs.path).toBe(`/${cs.id}/`);
    expect(call.path).toBe(`/${cs.id}/${call.id}/`);
    expect(call.depth).toBe(1);
    await expect(org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'cs', nameAr: 'x', nameEn: 'x' })).rejects.toMatchObject({ code: 'DUPLICATE_CODE' });
  });

  it('a parent from another company is simply not found', async () => {
    const { org, ctx } = setup();
    const other = await org.createUnit(ctx('c2'), { type: 'DEPARTMENT', code: 'DEV', nameAr: 'x', nameEn: 'Dev' });
    await expect(org.createUnit(ctx('c1'), { parentId: other.id, type: 'DEPARTMENT', code: 'BE', nameAr: 'x', nameEn: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(org.getUnit(ctx('c1'), other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('moving a unit rewrites every path in its subtree; moving under a descendant is a cycle', async () => {
    const { org, ctx, tables } = setup();
    const it_ = await org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'IT', nameAr: 'x', nameEn: 'IT' });
    const infra = await org.createUnit(ctx(), { parentId: it_.id, type: 'DEPARTMENT', code: 'IT-INFRA', nameAr: 'x', nameEn: 'Infra' });
    const net = await org.createUnit(ctx(), { parentId: infra.id, type: 'DEPARTMENT', code: 'IT-NET', nameAr: 'x', nameEn: 'Network' });
    const hq = await org.createUnit(ctx(), { type: 'BRANCH', code: 'HQ', nameAr: 'x', nameEn: 'HQ' });

    await expect(org.updateUnit(ctx(), it_.id, { parentId: net.id })).rejects.toMatchObject({ code: 'CYCLE' });
    await expect(org.updateUnit(ctx(), it_.id, { parentId: it_.id })).rejects.toMatchObject({ code: 'CYCLE' });

    await org.updateUnit(ctx(), it_.id, { parentId: hq.id });
    const byId = Object.fromEntries(tables.orgUnit!.map((r) => [r['id'], r]));
    expect(byId[it_.id]?.['path']).toBe(`/${hq.id}/${it_.id}/`);
    expect(byId[infra.id]?.['path']).toBe(`/${hq.id}/${it_.id}/${infra.id}/`);
    expect(byId[net.id]?.['path']).toBe(`/${hq.id}/${it_.id}/${infra.id}/${net.id}/`);
    expect(byId[net.id]?.['depth']).toBe(3);
  });

  it('a unit with children, employees or assignments cannot be deleted — the message says what blocks it', async () => {
    const { org, ctx, tables } = setup();
    const hr = await org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'HR', nameAr: 'x', nameEn: 'HR' });
    await org.createUnit(ctx(), { parentId: hr.id, type: 'DEPARTMENT', code: 'HR-OPS', nameAr: 'x', nameEn: 'Ops' });
    await expect(org.deleteUnit(ctx(), hr.id)).rejects.toMatchObject({ code: 'UNIT_IN_USE', message: expect.stringContaining('child unit') });

    const fin = await org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'FIN', nameAr: 'x', nameEn: 'Finance' });
    tables.employee!.push({ id: 'e1', orgUnitId: fin.id });
    await expect(org.deleteUnit(ctx(), fin.id)).rejects.toMatchObject({ message: expect.stringContaining('employee') });

    const empty = await org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'TMP', nameAr: 'x', nameEn: 'Tmp' });
    await org.deleteUnit(ctx(), empty.id);
    expect(tables.orgUnit!.some((r) => r['id'] === empty.id)).toBe(false);
  });
});

describe('manager seats ↔ assignments', () => {
  it('setting a unit manager creates a UNIT_MANAGER assignment for exactly that unit; changing it moves the seat', async () => {
    const { org, ctx, tables } = setup();
    const cs = await org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'CS', nameAr: 'x', nameEn: 'CS', managerId: 'u-old' });
    expect(tables.userAssignment).toEqual([expect.objectContaining({ userId: 'u-old', roleId: 'r-um', companyId: 'c1', orgUnitId: cs.id })]);

    await org.updateUnit(ctx(), cs.id, { managerId: 'u-mgr' });
    expect(tables.userAssignment).toEqual([expect.objectContaining({ userId: 'u-mgr', roleId: 'r-um', orgUnitId: cs.id })]);

    await org.updateUnit(ctx(), cs.id, { managerId: null });
    expect(tables.userAssignment).toEqual([]);
  });

  it('an inactive account cannot be a manager', async () => {
    const { org, ctx } = setup();
    await expect(org.createUnit(ctx(), { type: 'DEPARTMENT', code: 'X', nameAr: 'x', nameEn: 'x', managerId: 'u-off' })).rejects.toMatchObject({ code: 'BAD_MANAGER' });
  });

  it('the company manager seat works the same way, and never touches other assignments', async () => {
    const { assignments, tables } = setup();
    tables.userAssignment!.push({ id: 'a-hr', userId: 'u-old', roleId: 'r-hr', companyId: 'c1', orgUnitId: null });
    const actor = { type: 'USER' as const, id: 'u-admin' };
    await assignments.syncManager({ kind: 'COMPANY', companyId: 'c1' }, null, 'u-old', actor);
    expect(tables.userAssignment).toHaveLength(2);
    await assignments.syncManager({ kind: 'COMPANY', companyId: 'c1' }, 'u-old', 'u-mgr', actor);
    expect(tables.userAssignment!.map((a) => [a['userId'], a['roleId']])).toEqual([['u-old', 'r-hr'], ['u-mgr', 'r-cm']]);
  });
});

describe('AssignmentService — explicit assignments', () => {
  it('validates role, company and that the unit belongs to the company; replaces the whole list', async () => {
    const { assignments, tables, org, ctx } = setup();
    tables.user!.push({ id: 'u-x', active: true });
    const unitC2 = await org.createUnit(ctx('c2'), { type: 'DEPARTMENT', code: 'DEV', nameAr: 'x', nameEn: 'x' });
    const actor = { type: 'USER' as const, id: 'u-admin' };

    await expect(assignments.replaceForUser('u-x', [{ roleCode: 'NOPE', companyId: 'c1' }], actor)).rejects.toMatchObject({ code: 'BAD_ROLE' });
    await expect(assignments.replaceForUser('u-x', [{ roleCode: 'HR', companyId: 'c-ghost' }], actor)).rejects.toMatchObject({ code: 'BAD_COMPANY' });
    await expect(assignments.replaceForUser('u-x', [{ roleCode: 'UNIT_MANAGER', companyId: 'c1', orgUnitId: unitC2.id }], actor)).rejects.toMatchObject({ code: 'BAD_SCOPE' });
    await expect(assignments.replaceForUser('u-x', [{ roleCode: 'UNIT_MANAGER', orgUnitId: unitC2.id }], actor)).rejects.toMatchObject({ code: 'BAD_SCOPE' });

    const rows = await assignments.replaceForUser('u-x', [{ roleCode: 'HR', companyId: 'c1' }, { roleCode: 'HR', companyId: 'c1' }], actor);
    expect(rows).toHaveLength(1); // duplicates collapse
    await assignments.replaceForUser('u-x', [], actor);
    expect(tables.userAssignment!.filter((a) => a['userId'] === 'u-x')).toEqual([]);
  });

  it('roles: system roles can be re-bundled but not deleted; unknown permission codes are refused', async () => {
    const { assignments } = setup();
    const actor = { type: 'USER' as const, id: 'u-admin' };
    await expect(assignments.updateRole('r-hr', { permissions: ['not.a.permission'] }, actor)).rejects.toMatchObject({ code: 'BAD_PERMISSION' });
    const updated = await assignments.updateRole('r-hr', { permissions: ['employees.read', 'employees.read'] }, actor);
    expect(updated.permissions.map((p: { permission: string }) => p.permission)).toEqual(['employees.read']);
    await expect(assignments.removeRole('r-hr', actor)).rejects.toMatchObject({ code: 'SYSTEM_ROLE' });
    await expect(assignments.updateRole('r-hr', { active: false }, actor)).rejects.toMatchObject({ code: 'SYSTEM_ROLE' });

    const custom = await assignments.createRole({ code: 'payroll', nameAr: 'رواتب', nameEn: 'Payroll', permissions: ['reports.view'] }, actor);
    expect(custom.code).toBe('PAYROLL');
    await assignments.removeRole(custom.id, actor);
  });
});
