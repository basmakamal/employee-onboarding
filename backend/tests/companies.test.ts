/**
 * Phase 4 — company administration and the company gate.
 *   - /companies works without a selected company, needs companies.manage,
 *     validates and audits, and never returns HR records.
 *   - every company-scoped prefix refuses without a selected company.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { COMPANY_SCOPED_PREFIXES, requireCompany } from '../src/auth/authz/authorize.js';
import { companyRouter } from '../src/modules/companies/company.routes.js';
import { CompanyService } from '../src/modules/companies/company.service.js';
import type { Actor } from '../src/workflow/engine.js';

function fakeDb() {
  const rows: Array<Record<string, unknown>> = [
    { id: 'c1', code: 'RIYADA', nameAr: 'ريادة', nameEn: 'Riyada', active: true, _count: { employees: 12, orgUnits: 3, assignments: 5 } },
  ];
  return {
    rows,
    company: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(rows)),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; code?: string } }) =>
        Promise.resolve(rows.find((r) => (where.id ? r.id === where.id : r.code === where.code)) ?? null),
      ),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `c${rows.length + 1}`, ...data, _count: { employees: 0, orgUnits: 0, assignments: 0 } };
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id) as Record<string, unknown>;
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };
}

function appFor(actor: Actor | undefined) {
  const db = fakeDb();
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (actor) req.actor = actor;
    next();
  });
  app.use('/companies', companyRouter(new CompanyService(db as never, audit as never)));
  app.use(errorHandler);
  return { app, db, audit };
}

const SUPER: Actor = { type: 'USER', id: 'u-admin', role: 'ADMIN', permissions: ['companies.manage'] };
const HR: Actor = { type: 'USER', id: 'u-hr', role: 'HR', permissions: ['employees.write'] };

describe('/companies', () => {
  it('lists companies with counts only — never HR records — without any selected company', async () => {
    const res = await request(appFor(SUPER).app).get('/companies');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ code: 'RIYADA', _count: { employees: 12 } });
    expect(JSON.stringify(res.body)).not.toMatch(/employeeNo|firstName|contract/);
  });

  it('is refused without companies.manage', async () => {
    expect((await request(appFor(HR).app).get('/companies')).status).toBe(403);
    expect((await request(appFor(HR).app).post('/companies').send({ code: 'X', nameAr: 'س', nameEn: 'X' })).status).toBe(403);
  });

  it('creates with an upper-cased code, audits, and refuses a duplicate code', async () => {
    const { app, audit } = appFor(SUPER);
    const created = await request(app).post('/companies').send({ code: 'north', nameAr: 'الشمال', nameEn: 'North' });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('NORTH');
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPANY_CREATED', actorId: 'u-admin', companyId: created.body.id }));

    const dup = await request(app).post('/companies').send({ code: 'riyada', nameAr: 'x', nameEn: 'x' });
    expect(dup.status).toBe(422); // GuardFailedError — the app's convention for business-rule conflicts
    expect(dup.body.error.code).toBe('DUPLICATE_CODE');
  });

  it('validates the body (bad code, missing names)', async () => {
    const { app } = appFor(SUPER);
    expect((await request(app).post('/companies').send({ code: '1-bad', nameAr: 'x', nameEn: 'x' })).status).toBe(400);
    expect((await request(app).post('/companies').send({ code: 'OK' })).status).toBe(400);
  });

  it('updates names / active but never the code; deactivation is audited as such', async () => {
    const { app, audit, db } = appFor(SUPER);
    const res = await request(app).put('/companies/c1').send({ nameEn: 'Riyada Co', active: false, code: 'HACK' });
    expect(res.status).toBe(200);
    expect(db.rows[0]?.code).toBe('RIYADA');
    expect(db.rows[0]?.nameEn).toBe('Riyada Co');
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPANY_DEACTIVATED', companyId: 'c1' }));
    expect((await request(app).put('/companies/nope').send({ nameEn: 'x' })).status).toBe(404);
  });
});

describe('company gate on scoped prefixes', () => {
  function gated(actor: Actor) {
    const app = express();
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use([...COMPANY_SCOPED_PREFIXES], requireCompany());
    for (const prefix of COMPANY_SCOPED_PREFIXES) app.get(prefix, (_req, res) => res.json({ ok: prefix }));
    app.get('/companies', (_req, res) => res.json({ ok: 'global' }));
    app.use(errorHandler);
    return app;
  }

  it.each([...COMPANY_SCOPED_PREFIXES])('%s → 403 COMPANY_REQUIRED without a company, 200 with one', async (prefix) => {
    const none = await request(gated({ type: 'USER', id: 'u1', role: 'HR', permissions: ['employees.read'] })).get(prefix);
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('COMPANY_REQUIRED');

    const some = await request(gated({ type: 'USER', id: 'u1', role: 'HR', permissions: ['employees.read'], companyId: 'c1' })).get(prefix);
    expect(some.status).toBe(200);
  });

  it('global administration stays reachable without a company', async () => {
    const res = await request(gated({ type: 'USER', id: 'u1', role: 'ADMIN' })).get('/companies');
    expect(res.status).toBe(200);
  });
});
