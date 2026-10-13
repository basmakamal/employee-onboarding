/**
 * Every refusal leaves the API with a stable, translatable code — and for
 * input problems, the field it belongs to. Nothing technical leaks.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler, validate } from '../src/common/http.js';
import { GuardFailedError } from '../src/workflow/errors.js';

function appThrowing(err: unknown) {
  const app = express();
  app.use(express.json());
  app.get('/boom', () => {
    throw err;
  });
  app.post(
    '/form',
    validate(z.object({ name: z.string().min(2).max(5), email: z.string().email(), age: z.number().int().positive() })),
    (_req, res) => res.json({ ok: true }),
  );
  app.post('/json', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('validation errors carry one translatable issue per field, with the numbers a message needs', async () => {
    const res = await request(appThrowing(null)).post('/form').send({ name: 'x', email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const byPath = Object.fromEntries(res.body.error.details.map((d: { path: string }) => [d.path, d]));
    expect(byPath.name).toMatchObject({ code: 'too_small', params: { minimum: 2, type: 'string' } });
    expect(byPath.email).toMatchObject({ code: 'invalid_string', params: { validation: 'email' } });
    expect(byPath.age).toMatchObject({ code: 'required' });
  });

  it('business rules keep their own code and status', async () => {
    const res = await request(appThrowing(new GuardFailedError('UNIT_IN_USE', 'still has 2 employee(s)'))).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({ code: 'UNIT_IN_USE', message: 'still has 2 employee(s)' });
  });

  it('a business rule about one input names that field, so the form can outline it', async () => {
    const res = await request(appThrowing(new GuardFailedError('DUPLICATE_CODE', 'code taken', 'code'))).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: 'DUPLICATE_CODE',
      message: 'code taken',
      details: [{ path: 'code', code: 'DUPLICATE_CODE', message: 'code taken' }],
    });
  });

  it('a malformed JSON body is a 400, not a crash', async () => {
    const res = await request(appThrowing(null)).post('/json').set('Content-Type', 'application/json').send('{"oops":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('an oversized upload is a 413 FILE_TOO_LARGE on the file field', async () => {
    const err = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE', field: 'document' });
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'document', code: 'FILE_TOO_LARGE' })]);
  });

  it('a database unique clash is a 409 DUPLICATE on the right field (companyId is not "the field")', async () => {
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['companyId', 'email'] } });
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'email', code: 'DUPLICATE' })]);
  });

  it('a foreign-key refusal is 409 IN_USE; a missing row is 404', async () => {
    const fk = Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003', meta: { field_name: 'x' } });
    expect((await request(appThrowing(fk)).get('/boom')).body.error.code).toBe('IN_USE');
    const gone = Object.assign(new Error('Record to update not found'), { code: 'P2025' });
    const res = await request(appThrowing(gone)).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('anything else is a 500 with a safe message — no SQL, stack or path', async () => {
    const res = await request(appThrowing(new Error("SELECT * FROM users WHERE secret='x' at C:\\\\app\\\\db.ts:12"))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|secret|db\.ts|stack/i);
  });
});
