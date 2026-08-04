/**
 * Auth: service logic with a fake user repo, and route/middleware behavior
 * through a real Express app via supertest.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthService } from '../src/auth/auth.service.js';
import { requireAuth, requireRole } from '../src/auth/require-auth.middleware.js';
import { authRouter } from '../src/auth/auth.routes.js';
import { errorHandler } from '../src/common/http.js';
import type { UserRepository } from '../src/auth/user.repository.js';

const SECRETS = { access: 'test-access-secret', refresh: 'test-refresh-secret' };

let hashedPassword: string;

function makeUsers(overrides: Partial<Record<string, unknown>> = {}) {
  const user = {
    id: 'u1',
    email: 'hr@example.com',
    name: 'HR Officer',
    role: 'HR',
    passwordHash: hashedPassword,
    active: true,
    ...overrides,
  };
  return {
    findByEmail: vi.fn().mockImplementation((email: string) =>
      Promise.resolve(email === user.email ? user : null),
    ),
    findById: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === user.id ? user : null),
    ),
  } as unknown as UserRepository;
}

beforeAll(async () => {
  hashedPassword = await AuthService.hashPassword('Passw0rd!');
});

describe('AuthService', () => {
  it('logs in with correct credentials and returns both tokens', async () => {
    const auth = new AuthService(makeUsers(), SECRETS);
    const result = await auth.login('HR@example.com', 'Passw0rd!');

    expect(result.user).toEqual({ id: 'u1', name: 'HR Officer', email: 'hr@example.com', role: 'HR' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it.each([
    ['wrong password', 'hr@example.com', 'nope'],
    ['unknown email', 'ghost@example.com', 'Passw0rd!'],
  ])('rejects %s with the same generic error', async (_label, email, password) => {
    const auth = new AuthService(makeUsers(), SECRETS);
    await expect(auth.login(email, password)).rejects.toThrow('invalid email or password');
  });

  it('rejects a deactivated account even with a valid token', async () => {
    const active = new AuthService(makeUsers(), SECRETS);
    const { accessToken } = await active.login('hr@example.com', 'Passw0rd!');

    const deactivated = new AuthService(makeUsers({ active: false }), SECRETS);
    await expect(deactivated.authenticate(accessToken)).rejects.toThrow('account unavailable');
  });

  it('a refresh token cannot be used as an access token (kind claim)', async () => {
    const auth = new AuthService(makeUsers(), SECRETS);
    const { refreshToken } = await auth.login('hr@example.com', 'Passw0rd!');
    await expect(auth.authenticate(refreshToken)).rejects.toThrow('invalid or expired token');
  });

  it('refresh rotates the pair from a valid refresh token', async () => {
    const auth = new AuthService(makeUsers(), SECRETS);
    const first = await auth.login('hr@example.com', 'Passw0rd!');
    const rotated = await auth.refresh(first.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    await expect(auth.authenticate(rotated.accessToken)).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('auth routes + guards', () => {
  function makeApp() {
    const auth = new AuthService(makeUsers(), SECRETS);
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter(auth));
    app.get('/api/protected', requireAuth(auth), requireRole('HR'), (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/api/admin-only', requireAuth(auth), requireRole('ADMIN'), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it('login sets the httpOnly refresh cookie and returns the access token', async () => {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .send({ email: 'hr@example.com', password: 'Passw0rd!' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('protected route: 401 without token, 200 with it, 403 for wrong role', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/protected')).status).toBe(401);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hr@example.com', password: 'Passw0rd!' });
    const bearer = `Bearer ${login.body.accessToken}`;

    expect((await request(app).get('/api/protected').set('Authorization', bearer)).status).toBe(200);
    expect((await request(app).get('/api/admin-only').set('Authorization', bearer)).status).toBe(403);
  });

  it('refresh endpoint works from the cookie alone', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hr@example.com', password: 'Passw0rd!' });
    const cookie = login.headers['set-cookie']?.[0] ?? '';

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
  });
});
