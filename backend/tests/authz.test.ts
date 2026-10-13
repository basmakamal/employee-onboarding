/**
 * Centralised authorisation (multi-company Phase 3): scope resolution,
 * permission gates, the company-required gate, company selection, and the
 * Redis-failure fallback on login. Negative cases first — the brief asks
 * for boundaries, not happy paths.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { UserRepository } from '../src/auth/user.repository.js';
import {
  can,
  contextOf,
  permissionsOf,
  requireCompany,
  requirePermission,
  scopeWhere,
} from '../src/auth/authz/authorize.js';
import {
  allowedCompanies,
  effectivePermissions,
  mayUseCompany,
  pathInScope,
  resolveScope,
  roleCodes,
  type AssignmentView,
} from '../src/auth/authz/scope.js';
import type { Actor } from '../src/workflow/engine.js';

const SECRETS = { access: 'access-secret-for-tests', refresh: 'refresh-secret-for-tests' };

const a = (over: Partial<AssignmentView>): AssignmentView => ({
  roleCode: 'HR',
  permissions: ['employees.read', 'employees.write'],
  companyId: 'c1',
  orgUnitId: null,
  orgUnitPath: null,
  ...over,
});

// ───────────────────────────────────────────────────────────── scope

describe('scope resolution', () => {
  it('a company-wide assignment opens the whole company — but only that company', () => {
    const views = [a({ companyId: 'c1' })];
    expect(resolveScope(views, 'c1')).toEqual({ companyId: 'c1', all: true, orgUnitPaths: [] });
    expect(effectivePermissions(views, 'c2').size).toBe(0);
    expect(resolveScope(views, 'c2')).toEqual({ companyId: 'c2', all: false, orgUnitPaths: [] });
    expect(allowedCompanies(views)).toEqual(['c1']);
    expect(mayUseCompany(views, 'c2')).toBe(false);
  });

  it('a unit assignment reaches only that subtree', () => {
    const views = [a({ roleCode: 'UNIT_MANAGER', permissions: ['employees.read'], orgUnitId: 'u-b', orgUnitPath: '/u-a/u-b/' })];
    const scope = resolveScope(views, 'c1');
    expect(scope.all).toBe(false);
    expect(pathInScope(scope, '/u-a/u-b/u-c/')).toBe(true); // a child
    expect(pathInScope(scope, '/u-a/u-b/')).toBe(true); // the unit itself
    expect(pathInScope(scope, '/u-a/')).toBe(false); // the parent
    expect(pathInScope(scope, '/u-a/u-x/')).toBe(false); // a sibling
    expect(pathInScope(scope, null)).toBe(false); // unplaced employee
  });

  it('a unit assignment whose path is unknown opens nothing, never everything', () => {
    const views = [a({ orgUnitId: 'u-?', orgUnitPath: null })];
    expect(resolveScope(views, 'c1')).toEqual({ companyId: 'c1', all: false, orgUnitPaths: [] });
  });

  it('a global assignment applies in every company and unlocks all companies', () => {
    const views = [a({ roleCode: 'SUPER_ADMIN', permissions: ['companies.manage'], companyId: null })];
    expect(allowedCompanies(views)).toBe('all');
    expect(mayUseCompany(views, 'anything')).toBe(true);
    expect(effectivePermissions(views, 'c9').has('companies.manage')).toBe(true);
    expect(effectivePermissions(views, null).has('companies.manage')).toBe(true);
  });

  it('permissions and role codes are the union of what applies in the active company', () => {
    const views = [
      a({ roleCode: 'HR', permissions: ['employees.read'], companyId: 'c1' }),
      a({ roleCode: 'IT', permissions: ['assets.manage'], companyId: 'c1' }),
      a({ roleCode: 'FINANCE', permissions: ['settlement.approve'], companyId: 'c2' }),
    ];
    expect(roleCodes(views, 'c1').sort()).toEqual(['HR', 'IT']);
    expect([...effectivePermissions(views, 'c1')].sort()).toEqual(['assets.manage', 'employees.read']);
    expect(roleCodes(views, 'c2')).toEqual(['FINANCE']);
  });
});

// ─────────────────────────────────────────────────────── permissions

describe('permissionsOf / can', () => {
  it('uses the resolved permissions when the actor carries them', () => {
    const actor: Actor = { type: 'USER', id: 'u1', role: 'HR', permissions: ['reports.view'] };
    expect(can(actor, 'reports.view')).toBe(true);
    expect(can(actor, 'employees.write')).toBe(false); // even though legacy HR could
  });

  it('falls back to the legacy role bundle for actors without permissions (older tests, scripts)', () => {
    expect(can({ type: 'USER', id: 'u1', role: 'HR' }, 'employees.write')).toBe(true);
    expect(can({ type: 'USER', id: 'u1', role: 'HR' }, 'users.manage')).toBe(false);
    expect(can({ type: 'USER', id: 'u1', role: 'ADMIN' }, 'users.manage')).toBe(true);
    expect(can({ type: 'USER', id: 'u1', role: 'IT' }, 'assets.manage')).toBe(true);
  });

  it('link and system actors have no staff permissions', () => {
    expect(permissionsOf({ type: 'LINK', id: 't1' }).size).toBe(0);
    expect(permissionsOf({ type: 'SYSTEM' }).size).toBe(0);
    expect(permissionsOf(undefined).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────── route gates

function appWith(actor: Actor | undefined) {
  const app = express();
  app.use((req, _res, next) => {
    if (actor) req.actor = actor;
    next();
  });
  app.get('/perm', requirePermission('employees.read', 'reports.view'), (_req, res) => res.json({ ok: true }));
  app.get('/company', requireCompany(), (req, res) => res.json(scopeWhere(contextOf(req))));
  app.use(errorHandler);
  return app;
}

describe('requirePermission', () => {
  it('403 FORBIDDEN without any of the listed permissions, 200 with one', async () => {
    const denied = await request(appWith({ type: 'USER', id: 'u1', role: 'HR', permissions: ['assets.manage'] })).get('/perm');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const ok = await request(appWith({ type: 'USER', id: 'u1', role: 'HR', permissions: ['reports.view'] })).get('/perm');
    expect(ok.status).toBe(200);
  });

  it('refuses when there is no actor at all', async () => {
    expect((await request(appWith(undefined)).get('/perm')).status).toBe(403);
  });
});

describe('requireCompany + scopeWhere', () => {
  it('no selected company → 403 COMPANY_REQUIRED (never a fallback to all companies)', async () => {
    const res = await request(appWith({ type: 'USER', id: 'u1', role: 'HR', permissions: ['employees.read'] })).get('/company');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_REQUIRED');
  });

  it('company-wide scope → where { companyId } only', async () => {
    const res = await request(
      appWith({ type: 'USER', id: 'u1', role: 'HR', companyId: 'c1', scope: { companyId: 'c1', all: true, orgUnitPaths: [] } }),
    ).get('/company');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ companyId: 'c1' });
  });

  it('unit scope → company AND one of the subtree prefixes', async () => {
    const res = await request(
      appWith({
        type: 'USER', id: 'u1', role: 'UNIT_MANAGER', companyId: 'c1',
        scope: { companyId: 'c1', all: false, orgUnitPaths: ['/a/b/', '/a/c/'] },
      }),
    ).get('/company');
    expect(res.body).toEqual({
      companyId: 'c1',
      OR: [{ orgUnit: { path: { startsWith: '/a/b/' } } }, { orgUnit: { path: { startsWith: '/a/c/' } } }],
    });
  });

  it('unit scope with no known paths matches nothing', async () => {
    const res = await request(
      appWith({ type: 'USER', id: 'u1', role: 'UNIT_MANAGER', companyId: 'c1', scope: { companyId: 'c1', all: false, orgUnitPaths: [] } }),
    ).get('/company');
    expect(res.body.companyId).toBe('c1');
    expect(res.body.OR).toHaveLength(1);
    expect(res.body.OR[0].orgUnit.path.startsWith).not.toBe('/');
  });
});

// ────────────────────────────────────────────── session + selection

const COMPANIES = [
  { id: 'c1', code: 'RIYADA', nameAr: 'ريادة', nameEn: 'Riyada' },
  { id: 'c2', code: 'OTHER', nameAr: 'أخرى', nameEn: 'Other' },
];

function makeAuth(opts: {
  assignments?: Array<{ companyId: string | null; orgUnitId: string | null; role: { code: string; active: boolean; permissions: Array<{ permission: string }> } }>;
  activeCompanyId?: string | null;
  refreshStore?: { save: () => Promise<void>; consume: () => Promise<boolean>; revoke: () => Promise<void> };
}) {
  let user: Record<string, unknown> = {
    id: 'u1', email: 'x@example.com', name: 'X', role: 'HR', passwordHash: null, active: true,
    activeCompanyId: opts.activeCompanyId ?? null,
    assignments: opts.assignments ?? [],
  };
  const users = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(user)),
    findByEmail: vi.fn().mockImplementation(() => Promise.resolve(user)),
    update: vi.fn().mockImplementation((_id: string, data: Record<string, unknown>) => {
      user = { ...user, ...data };
      return Promise.resolve(user);
    }),
    setActiveCompany: vi.fn().mockImplementation((_id: string, companyId: string | null) => {
      user = { ...user, activeCompanyId: companyId };
      return Promise.resolve(user);
    }),
  };
  const companies = {
    listActive: vi.fn().mockResolvedValue(COMPANIES),
    listActiveByIds: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(COMPANIES.filter((c) => ids.includes(c.id)))),
    unitPaths: vi.fn().mockResolvedValue({ 'u-b': '/u-a/u-b/' }),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const auth = new AuthService(users as unknown as UserRepository, SECRETS, opts.refreshStore as never, companies, audit);
  return { auth, users, companies, audit };
}

const role = (code: string, permissions: string[]) => ({ code, active: true, permissions: permissions.map((permission) => ({ permission })) });

describe('AuthService session', () => {
  it('a single-company user is simply in their company; a global user must choose', async () => {
    const single = makeAuth({ assignments: [{ companyId: 'c1', orgUnitId: null, role: role('HR', ['employees.read']) }] });
    const session = await single.auth.selectCompany('u1', null);
    expect(session.companies.map((c) => c.code)).toEqual(['RIYADA']);
    expect(session.activeCompany?.id).toBe('c1');
    expect(session.permissions).toEqual(['employees.read']);

    const global = makeAuth({ assignments: [{ companyId: null, orgUnitId: null, role: role('SUPER_ADMIN', ['companies.manage']) }] });
    const g = await global.auth.selectCompany('u1', null);
    expect(g.companies.map((c) => c.code)).toEqual(['RIYADA', 'OTHER']);
    expect(g.activeCompany).toBeNull();
    expect(g.permissions).toContain('companies.manage');
  });

  it('selecting a company the user is not assigned to is refused and not stored', async () => {
    const { auth, users } = makeAuth({ assignments: [{ companyId: 'c1', orgUnitId: null, role: role('HR', ['employees.read']) }] });
    await expect(auth.selectCompany('u1', 'c2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(users.setActiveCompany).not.toHaveBeenCalled();
  });

  it('a stored company that is no longer allowed is ignored on the next request', async () => {
    const { auth } = makeAuth({
      assignments: [{ companyId: 'c1', orgUnitId: null, role: role('HR', ['employees.read']) }, { companyId: 'c2', orgUnitId: null, role: role('HR', ['employees.read']) }],
      activeCompanyId: 'c-gone',
    });
    const session = await auth.selectCompany('u1', null);
    expect(session.activeCompany).toBeNull();
    expect(session.companies).toHaveLength(2);
  });

  it('selecting a company is audited, and the unit scope is resolved for it', async () => {
    const { auth, audit } = makeAuth({
      assignments: [
        { companyId: 'c1', orgUnitId: 'u-b', role: role('UNIT_MANAGER', ['employees.read']) },
        { companyId: 'c2', orgUnitId: null, role: role('HR', ['employees.write']) },
      ],
    });
    const session = await auth.selectCompany('u1', 'c1');
    expect(session.activeCompany?.id).toBe('c1');
    expect(session.scope).toEqual({ companyId: 'c1', all: false, orgUnitPaths: ['/u-a/u-b/'] });
    expect(session.permissions).toEqual(['employees.read']); // c2's HR powers do not leak into c1
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPANY_SELECTED', companyId: 'c1', actorId: 'u1' }));
  });

  it('inactive roles grant nothing', async () => {
    const { auth } = makeAuth({ assignments: [{ companyId: 'c1', orgUnitId: null, role: { code: 'HR', active: false, permissions: [{ permission: 'employees.read' }] } }] });
    const session = await auth.selectCompany('u1', null);
    // No live assignment → legacy single-role fallback (HR), globally.
    expect(session.roles).toEqual(['HR']);
    expect(session.companies.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('Redis-resilient tokens', () => {
  it('login still succeeds when the refresh-token store throws', async () => {
    const broken = {
      save: vi.fn().mockRejectedValue(new Error('NOAUTH')),
      consume: vi.fn().mockRejectedValue(new Error('NOAUTH')),
      revoke: vi.fn().mockRejectedValue(new Error('NOAUTH')),
    };
    const hashed = await AuthService.hashPassword('Passw0rd!');
    const { auth, users } = makeAuth({ refreshStore: broken });
    users.findByEmail.mockImplementation(() => Promise.resolve({ id: 'u1', email: 'x@example.com', name: 'X', role: 'HR', passwordHash: hashed, active: true, assignments: [] }));

    const result = await auth.login('x@example.com', 'Passw0rd!');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(broken.save).toHaveBeenCalled();

    // …and the stateless refresh token is still honoured while the store is down.
    const rotated = await auth.refresh(result.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    await expect(auth.logout(result.refreshToken)).resolves.toBeUndefined();
  });
});
