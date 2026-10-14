/**
 * The audit trail: each entry knows where it came from and which request
 * caused it; edits carry before / after values with identity and bank
 * numbers masked; the trail is readable per company and never writable.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogRepository } from '../src/workflow/audit-log.repository.js';
import { requestContext, withContext } from '../src/common/request-context.js';
import { profileChanges } from '../src/modules/employees/employee.service.js';
import { auditRouter } from '../src/modules/audit/audit.routes.js';
import { errorHandler } from '../src/common/http.js';

function fakeDb() {
  return { auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => data) } };
}

describe('audit entries', () => {
  it('are stamped with the request id and WEB source of the request that caused them', async () => {
    const db = fakeDb();
    const repo = new AuditLogRepository(db as never);
    const app = express();
    app.use(requestContext());
    app.post('/api/employees/e1', async (_req, res) => {
      await Promise.resolve(); // context survives awaits
      await repo.append({ entity: 'EMPLOYEE', entityId: 'e1', action: 'UPDATE_PROFILE', actorType: 'USER' });
      res.json({});
    });
    const res = await request(app).post('/api/employees/e1');
    const data = db.auditLog.create.mock.calls[0]![0].data as { source: string; requestId: string };
    expect(data.source).toBe('WEB');
    expect(data.requestId).toBe(res.headers['x-request-id']);
  });

  it('from a signed link are marked LINK', async () => {
    const db = fakeDb();
    const repo = new AuditLogRepository(db as never);
    const app = express();
    app.use(requestContext());
    app.post('/api/link/tok/form', async (_req, res) => {
      await repo.append({ entity: 'EMPLOYEE', entityId: 'e1', action: 'SUBMIT_FORM', actorType: 'LINK' });
      res.json({});
    });
    await request(app).post('/api/link/tok/form');
    expect(db.auditLog.create.mock.calls[0]![0].data).toMatchObject({ source: 'LINK' });
  });

  it('written by the scheduler are marked SCHEDULER', async () => {
    const db = fakeDb();
    const repo = new AuditLogRepository(db as never);
    await withContext({ requestId: 'tick-1', source: 'SCHEDULER' }, () =>
      repo.append({ entity: 'EMPLOYEE', entityId: 'e1', action: 'SLA_REMINDER', actorType: 'SYSTEM' }),
    );
    expect(db.auditLog.create.mock.calls[0]![0].data).toMatchObject({ source: 'SCHEDULER', requestId: 'tick-1' });
  });
});

describe('profile edit changes', () => {
  it('keep only what changed, and never the identity or bank numbers themselves', () => {
    const before = { firstName: 'Sara', phone: '0500000000', nationalId: '1012345678', iban: 'SA03800000006080', hireDate: new Date('2026-01-01T00:00:00Z') };
    const after = { firstName: 'Sarah', phone: '0500000000', nationalId: '1099999999', iban: 'SA03800000006080', hireDate: new Date('2026-02-01T00:00:00Z'), companyId: 'co' };
    const changes = profileChanges(before, after);
    expect(changes).toEqual({
      firstName: { from: 'Sara', to: 'Sarah' },
      nationalId: { from: '•••', to: '•••' },
      hireDate: { from: '2026-01-01', to: '2026-02-01' },
    });
    expect(JSON.stringify(changes)).not.toContain('1099999999');
  });
});

describe('audit API', () => {
  function app(permissions: string[]) {
    const db = {
      auditLog: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    const a = express();
    a.use((req, _res, next) => {
      req.actor = { type: 'USER', id: 'u1', role: 'HR', permissions, companyId: 'co-a', scope: { companyId: 'co-a', all: true, orgUnitPaths: [] } };
      next();
    });
    a.use('/audit', auditRouter(db as never));
    a.use(errorHandler);
    return { a, db };
  }

  it('needs audit.read', async () => {
    expect((await request(app([]).a).get('/audit')).status).toBe(403);
  });

  it("reads only the selected company's trail", async () => {
    const { a, db } = app(['audit.read']);
    expect((await request(a).get('/audit?source=SCHEDULER')).status).toBe(200);
    const where = db.auditLog.findMany.mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('co-a');
    expect(where.AND).toEqual(expect.arrayContaining([{ source: 'SCHEDULER' }]));
  });
});
