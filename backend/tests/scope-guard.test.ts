/**
 * Scope at the edges: every /employees/:id/... route sees only employees of
 * the selected company and the actor's branches, and the company registers
 * (contracts, documents, offboardings) list only those.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { employeeScopeGuard } from '../src/modules/employees/employee-scope.guard.js';
import { registersRouter } from '../src/modules/registers/registers.routes.js';

const actorOf = (companyId: string, branch?: string) => ({
  type: 'USER' as const,
  id: 'u1',
  role: 'ADMIN',
  permissions: ['contracts.write', 'documents.read', 'offboarding.manage'],
  companyId,
  scope: branch ? { companyId, all: false, orgUnitPaths: [branch] } : { companyId, all: true, orgUnitPaths: [] },
});

describe('employee scope guard', () => {
  function app(companyId: string) {
    const employees = {
      findById: vi.fn(async (id: string, scope?: { companyId: string }) => (id === 'e-a' && scope?.companyId === 'co-a' ? { id } : null)),
    };
    const a = express();
    a.use((req, _res, next) => {
      req.actor = actorOf(companyId);
      next();
    });
    a.use('/employees/:id', employeeScopeGuard(employees));
    a.get(['/employees/:id/documents', '/employees/changes', '/employees/options'], (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return { a, employees };
  }

  it('lets an employee of the selected company through', async () => {
    expect((await request(app('co-a').a).get('/employees/e-a/documents')).status).toBe(200);
  });

  it("answers 404 for another company's employee — the same as an unknown id", async () => {
    expect((await request(app('co-b').a).get('/employees/e-a/documents')).status).toBe(404);
  });

  it('does not treat fixed paths as an employee id', async () => {
    const { a, employees } = app('co-a');
    expect((await request(a).get('/employees/changes')).status).toBe(200);
    expect((await request(a).get('/employees/options')).status).toBe(200);
    expect(employees.findById).not.toHaveBeenCalled();
  });
});

describe('company registers', () => {
  function app(branch?: string) {
    const db = {
      contract: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', status: 'ACTIVE', details: { startDate: '2026-01-01', durationMonths: 12, salary: '9000' }, employee: {} }]), count: vi.fn().mockResolvedValue(1) },
      employeeDocument: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      offboarding: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    };
    const a = express();
    a.use((req, _res, next) => {
      req.actor = actorOf('co-a', branch);
      next();
    });
    a.use('/registers', registersRouter(db as never));
    a.use(errorHandler);
    return { a, db };
  }

  it("lists contracts of the actor's company without exposing the salary, and computes the end date", async () => {
    const { a, db } = app();
    const res = await request(a).get('/registers/contracts');
    expect(res.status).toBe(200);
    const where = db.contract.findMany.mock.calls[0]![0].where;
    expect(where.employee).toMatchObject({ companyId: 'co-a' });
    expect(res.body.items[0]).toMatchObject({ startDate: '2026-01-01', durationMonths: 12, endDate: '2026-12-31' });
    expect(JSON.stringify(res.body)).not.toContain('9000');
  });

  it("limits a branch manager's documents to their branch", async () => {
    const { a, db } = app('/u-branch/');
    await request(a).get('/registers/documents?window=expired');
    const where = db.employeeDocument.findMany.mock.calls[0]![0].where;
    expect(JSON.stringify(where.employee)).toContain('/u-branch/');
    expect(where.expiryDate).toHaveProperty('lt');
  });

  it('shows open offboardings by default', async () => {
    const { a, db } = app();
    await request(a).get('/registers/offboardings');
    expect(db.offboarding.findMany.mock.calls[0]![0].where.status).toEqual({ notIn: ['CLOSED', 'CANCELLED'] });
  });
});
