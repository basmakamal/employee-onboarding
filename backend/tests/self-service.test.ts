/**
 * Employee self-service accounts: they sign in only while employed, live in
 * their employee's company with no staff permission, are refused by every
 * staff route, and "My space" only ever reads their own record.
 */
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { staffOnly } from '../src/auth/authz/authorize.js';
import { errorHandler } from '../src/common/http.js';
import { meRouter } from '../src/modules/self-service/me.routes.js';
import type { UserRepository } from '../src/auth/user.repository.js';

const SECRETS = { access: 'test-access-secret', refresh: 'test-refresh-secret' };
let hash: string;
beforeAll(async () => {
  hash = await AuthService.hashPassword('Passw0rd!');
});

function users(employee: { id: string; companyId: string | null; status: string } | null, extra: Record<string, unknown> = {}) {
  const user = {
    id: 'acc1',
    email: 'sara@x.com',
    name: 'Sara Ali',
    role: 'EMPLOYEE',
    passwordHash: hash,
    active: true,
    employeeId: employee?.id ?? null,
    employee,
    // A stray global assignment must NOT widen an employee account.
    assignments: [{ companyId: null, orgUnitId: null, role: { code: 'SUPER_ADMIN', active: true, permissions: [{ permission: 'employees.read' }] } }],
    ...extra,
  };
  return {
    findByEmail: vi.fn(async (e: string) => (e === user.email ? user : null)),
    findById: vi.fn(async (id: string) => (id === user.id ? user : null)),
    update: vi.fn(async () => user),
  } as unknown as UserRepository;
}

const companies = {
  listActive: vi.fn(async () => [
    { id: 'co-a', code: 'A', nameAr: 'أ', nameEn: 'A' },
    { id: 'co-b', code: 'B', nameAr: 'ب', nameEn: 'B' },
  ]),
  listActiveByIds: vi.fn(async (ids: string[]) =>
    [{ id: 'co-a', code: 'A', nameAr: 'أ', nameEn: 'A' }, { id: 'co-b', code: 'B', nameAr: 'ب', nameEn: 'B' }].filter((c) => ids.includes(c.id)),
  ),
  unitPaths: vi.fn(async () => ({})),
};

describe('self-service sign-in', () => {
  it('works for an active employee: their company only, no staff permission, a scope that matches no one', async () => {
    const auth = new AuthService(users({ id: 'e1', companyId: 'co-a', status: 'ACTIVE' }), SECRETS, undefined, companies);
    const { user, accessToken } = await auth.login('sara@x.com', 'Passw0rd!');
    expect(user.employeeId).toBe('e1');
    expect(user.permissions).toEqual([]);
    expect(user.companies.map((c) => c.id)).toEqual(['co-a']);
    expect(user.activeCompany?.id).toBe('co-a');
    const session = await auth.authenticate(accessToken);
    expect(session.scope).toEqual({ companyId: 'co-a', all: false, orgUnitPaths: [] });
  });

  it.each(['CREATED', 'AWAITING_CONTRACT_APPROVAL', 'INACTIVE', 'WITHDRAWN'])(
    'is refused while the employee is %s',
    async (status) => {
      const auth = new AuthService(users({ id: 'e1', companyId: 'co-a', status }), SECRETS, undefined, companies);
      await expect(auth.login('sara@x.com', 'Passw0rd!')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
    },
  );

  it('closes an open session when the employment ends', async () => {
    const employee = { id: 'e1', companyId: 'co-a', status: 'ACTIVE' };
    const repo = users(employee);
    const auth = new AuthService(repo, SECRETS, undefined, companies);
    const { accessToken } = await auth.login('sara@x.com', 'Passw0rd!');
    employee.status = 'INACTIVE';
    await expect(auth.authenticate(accessToken)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
  });
});

describe('staff API fence', () => {
  function app(role: string) {
    const a = express();
    a.use((req, _res, next) => {
      req.actor = { type: 'USER', id: 'acc1', role, ...(role === 'EMPLOYEE' ? { employeeId: 'e1' } : {}), companyId: 'co-a' };
      next();
    });
    a.use(staffOnly());
    a.get(['/employees', '/employees/:id', '/reports', '/me/profile', '/notifications', '/notifications/log'], (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return a;
  }

  it.each(['/employees', '/employees/e2', '/reports'])('refuses an employee account on staff route %s', async (path) => {
    expect((await request(app('EMPLOYEE')).get(path)).status).toBe(403);
  });

  it.each(['/me/profile', '/notifications'])('lets an employee account reach %s', async (path) => {
    expect((await request(app('EMPLOYEE')).get(path)).status).toBe(200);
  });

  it('does not touch staff accounts', async () => {
    expect((await request(app('HR')).get('/employees')).status).toBe(200);
  });
});

describe('My space', () => {
  function app(employeeId?: string) {
    const db = {
      onboardingDocument: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
      employeeDocument: { findMany: vi.fn().mockResolvedValue([]) },
      employmentEvent: { findMany: vi.fn().mockResolvedValue([]) },
      employee: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'e1', firstName: 'Sara', lastName: 'Ali', nationalId: '1012345678', iban: 'SA0380000000608010167519',
          manager: null, contract: null,
        }),
      },
    };
    const a = express();
    a.use((req, _res, next) => {
      req.actor = { type: 'USER', id: 'acc1', role: employeeId ? 'EMPLOYEE' : 'HR', ...(employeeId ? { employeeId } : {}) };
      next();
    });
    a.use('/me', meRouter(db as never));
    a.use(errorHandler);
    return { a, db };
  }

  it('reads the signed-in employee only, whatever the URL says, and masks sensitive numbers', async () => {
    const { a, db } = app('e1');
    const res = await request(a).get('/me/profile?employeeId=e2');
    expect(res.status).toBe(200);
    expect(db.employee.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1' } }));
    expect(res.body.nationalId).toBe('••••••5678');
    expect(res.body.iban.endsWith('7519')).toBe(true);
    expect(res.body.iban).not.toContain('0608');

    await request(a).get('/me/documents/doc-of-someone-else/file');
    expect(db.onboardingDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'doc-of-someone-else', employeeId: 'e1', storageKey: { not: null } },
    });
  });

  it('is refused to a staff account (it has no employee record of its own)', async () => {
    const { a } = app();
    expect((await request(a).get('/me/profile')).status).toBe(403);
  });
});
