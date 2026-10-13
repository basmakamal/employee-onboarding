/**
 * The organisation API's input rules: branch numbers (e.g. "52") are valid
 * unit / title codes; malformed codes are a 400, never a silent drop.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { orgRouter } from '../src/modules/organisation/org.routes.js';

function appWith() {
  const service = {
    createUnit: vi.fn().mockImplementation((_ctx, body) => Promise.resolve({ id: 'u1', ...body })),
    createPosition: vi.fn().mockImplementation((_ctx, body) => Promise.resolve({ id: 'p1', ...body })),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: 'USER', id: 'u-admin', role: 'ADMIN', permissions: ['org.manage'],
      companyId: 'c1', scope: { companyId: 'c1', all: true, orgUnitPaths: [] },
    };
    next();
  });
  app.use('/org', orgRouter(service as never));
  app.use(errorHandler);
  return { app, service };
}

const unit = (code: string) => ({ type: 'BRANCH', code, nameAr: 'الدمام', nameEn: 'Dammam' });

describe('organisation codes', () => {
  it.each(['52', 'DMM', 'CS-CALL', 'IT_SOFT', '7A'])('accepts unit code %s', async (code) => {
    const { app, service } = appWith();
    const res = await request(app).post('/org/units').send(unit(code));
    expect(res.status).toBe(201);
    expect(service.createUnit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code }));
  });

  it.each(['-52', '_X', 'CS CALL', 'دمام', ''])('rejects unit code %j with a 400', async (code) => {
    const { app, service } = appWith();
    const res = await request(app).post('/org/units').send(unit(code));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(service.createUnit).not.toHaveBeenCalled();
  });

  it('job titles follow the same rule', async () => {
    const { app } = appWith();
    expect((await request(app).post('/org/positions').send({ code: '101', titleAr: 'محاسب', titleEn: 'Accountant' })).status).toBe(201);
    expect((await request(app).post('/org/positions').send({ code: '-1', titleAr: 'x', titleEn: 'x' })).status).toBe(400);
  });
});
