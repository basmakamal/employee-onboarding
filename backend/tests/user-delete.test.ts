/**
 * Deleting a staff account: never yourself, and never an account whose
 * history the database must keep (the FK refusal becomes a friendly 422).
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { usersRouter } from '../src/auth/users.routes.js';

function appWith(users: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: 'USER', id: 'admin1', role: 'ADMIN' } as typeof req.actor;
    next();
  });
  app.use('/users', usersRouter(users as never, { notifyExternal: vi.fn() } as never, 'https://hr.example'));
  app.use(errorHandler);
  return app;
}

describe('DELETE /users/:id', () => {
  it('deletes another account', async () => {
    const users = { findById: vi.fn().mockResolvedValue({ id: 'u2' }), remove: vi.fn().mockResolvedValue({}) };
    expect((await request(appWith(users)).delete('/users/u2')).status).toBe(204);
    expect(users.remove).toHaveBeenCalledWith('u2');
  });

  it('refuses to delete yourself', async () => {
    const users = { findById: vi.fn(), remove: vi.fn() };
    const res = await request(appWith(users)).delete('/users/admin1');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SELF_LOCKOUT');
    expect(users.remove).not.toHaveBeenCalled();
  });

  it('turns a foreign-key refusal into USER_HAS_HISTORY', async () => {
    const fk = Object.assign(new Error('fk'), { code: 'P2003' });
    const users = { findById: vi.fn().mockResolvedValue({ id: 'u2' }), remove: vi.fn().mockRejectedValue(fk) };
    const res = await request(appWith(users)).delete('/users/u2');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('USER_HAS_HISTORY');
  });

  it('404s for an unknown account', async () => {
    const users = { findById: vi.fn().mockResolvedValue(null), remove: vi.fn() };
    expect((await request(appWith(users)).delete('/users/ghost')).status).toBe(404);
  });
});
