/**
 * Staff invitations: create-with-invite emails a temporary password, resend
 * works only until the person has set their own password, and changing the
 * password ends the invitation phase.
 */
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { usersRouter } from '../src/auth/users.routes.js';
import { AuthService } from '../src/auth/auth.service.js';

const SECRETS = { access: 'a'.repeat(32), refresh: 'r'.repeat(32) };

function fakeUsers(existing: Record<string, unknown> | null = null) {
  const store = new Map<string, Record<string, unknown>>();
  if (existing) store.set(existing['id'] as string, existing);
  return {
    store,
    findById: vi.fn().mockImplementation((id: string) => Promise.resolve(store.get(id) ?? null)),
    findByEmail: vi.fn().mockImplementation((email: string) =>
      Promise.resolve([...store.values()].find((u) => u['email'] === email) ?? null),
    ),
    create: vi.fn().mockImplementation((data: Record<string, unknown>) => {
      const row = { id: 'u-new', active: true, passwordChangedAt: null, lastLoginAt: null, ...data };
      store.set('u-new', row);
      return Promise.resolve(row);
    }),
    update: vi.fn().mockImplementation((id: string, data: Record<string, unknown>) => {
      const row = { ...(store.get(id) ?? {}), ...data };
      store.set(id, row);
      return Promise.resolve(row);
    }),
    listPaged: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
}

function appFor(users: ReturnType<typeof fakeUsers>) {
  const notifications = { notifyExternal: vi.fn().mockResolvedValue(undefined) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: 'USER', id: 'admin1', role: 'ADMIN' } as typeof req.actor;
    next();
  });
  app.use('/users', usersRouter(users as never, notifications as never, 'https://hr.example'));
  app.use(errorHandler);
  return { app, notifications };
}

const INVITED = {
  id: 'u1',
  name: 'Sara',
  email: 'sara@example.com',
  role: 'HR',
  active: true,
  passwordHash: 'x',
  mustChangePassword: true,
  invitedAt: new Date(),
  passwordChangedAt: null,
  lastLoginAt: null,
};

describe('POST /users with sendInvitation', () => {
  it('generates a temporary password, emails it, and never echoes it back', async () => {
    const users = fakeUsers();
    const { app, notifications } = appFor(users);

    const res = await request(app)
      .post('/users')
      .send({ name: 'Sara', email: 'Sara@Example.com', role: 'HR', sendInvitation: true });

    expect(res.status).toBe(201);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.invitedAt).toBeTruthy();
    expect(res.body).not.toHaveProperty('tempPassword');
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'sara@example.com',
      'staff.invitation',
      expect.objectContaining({
        name: 'Sara',
        email: 'sara@example.com',
        tempPassword: expect.stringMatching(/^[A-Za-z0-9]{12}$/),
        linkUrl: 'https://hr.example/login',
      }),
      { entity: 'USER', entityId: 'u-new' },
    );
    // The stored hash matches the emailed password.
    const sent = notifications.notifyExternal.mock.calls[0]?.[2] as { tempPassword: string };
    const created = users.create.mock.calls[0]?.[0] as { passwordHash: string };
    expect(await bcrypt.compare(sent.tempPassword, created.passwordHash)).toBe(true);
  });

  it('without an invitation, a generated password is returned once to the admin', async () => {
    const users = fakeUsers();
    const { app, notifications } = appFor(users);

    const res = await request(app).post('/users').send({ name: 'Sara', email: 'sara@example.com', role: 'IT' });

    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(res.body.mustChangePassword).toBe(true);
    expect(notifications.notifyExternal).not.toHaveBeenCalled();
  });

  it('a password typed by the admin is used but still counts as temporary', async () => {
    const users = fakeUsers();
    const { app } = appFor(users);

    const res = await request(app)
      .post('/users')
      .send({ name: 'Sara', email: 'sara@example.com', role: 'HR', password: 'Typed12345' });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('tempPassword');
    const created = users.create.mock.calls[0]?.[0] as { passwordHash: string; mustChangePassword: boolean };
    expect(created.mustChangePassword).toBe(true);
    expect(await bcrypt.compare('Typed12345', created.passwordHash)).toBe(true);
  });
});

describe('POST /users/:id/invite (resend)', () => {
  it('issues a fresh temporary password while the person has not set their own', async () => {
    const users = fakeUsers(INVITED);
    const { app, notifications } = appFor(users);

    const res = await request(app).post('/users/u1/invite');

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(notifications.notifyExternal).toHaveBeenCalledTimes(1);
    const patch = users.update.mock.calls[0]?.[1] as { passwordHash: string; mustChangePassword: boolean };
    expect(patch.passwordHash).not.toBe('x');
    expect(patch.mustChangePassword).toBe(true);
  });

  it('refuses once the person has signed in and chosen a password', async () => {
    const users = fakeUsers({ ...INVITED, mustChangePassword: false, passwordChangedAt: new Date() });
    const { app, notifications } = appFor(users);

    const res = await request(app).post('/users/u1/invite');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALREADY_ACTIVE');
    expect(notifications.notifyExternal).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses for a deactivated account', async () => {
    const users = fakeUsers({ ...INVITED, active: false });
    const { app } = appFor(users);
    expect((await request(app).post('/users/u1/invite')).status).toBe(422);
  });

  it('admin password reset also forces a change at next sign-in', async () => {
    const users = fakeUsers(INVITED);
    const { app } = appFor(users);
    expect((await request(app).post('/users/u1/reset-password').send({ password: 'NewTemp123' })).status).toBe(200);
    const patch = users.update.mock.calls[0]?.[1] as { mustChangePassword: boolean };
    expect(patch.mustChangePassword).toBe(true);
  });
});

describe('AuthService.changePassword', () => {
  it('replaces the temporary password and ends the invitation phase', async () => {
    const hash = await AuthService.hashPassword('Temp12345678');
    const users = fakeUsers({ ...INVITED, passwordHash: hash });
    const auth = new AuthService(users as never, SECRETS);

    const user = await auth.changePassword('u1', 'Temp12345678', 'MyOwnPassw0rd');

    expect(user.mustChangePassword).toBe(false);
    const patch = users.update.mock.calls[0]?.[1] as {
      passwordHash: string;
      mustChangePassword: boolean;
      passwordChangedAt: Date;
    };
    expect(patch.mustChangePassword).toBe(false);
    expect(patch.passwordChangedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare('MyOwnPassw0rd', patch.passwordHash)).toBe(true);
  });

  it('rejects a wrong current password without touching the account', async () => {
    const hash = await AuthService.hashPassword('Temp12345678');
    const users = fakeUsers({ ...INVITED, passwordHash: hash });
    const auth = new AuthService(users as never, SECRETS);

    await expect(auth.changePassword('u1', 'nope', 'MyOwnPassw0rd')).rejects.toThrow(/current password/);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('login reports mustChangePassword so the app can force the screen', async () => {
    const hash = await AuthService.hashPassword('Temp12345678');
    const users = fakeUsers({ ...INVITED, passwordHash: hash });
    const auth = new AuthService(users as never, SECRETS);

    const result = await auth.login('sara@example.com', 'Temp12345678');
    expect(result.user.mustChangePassword).toBe(true);
  });
});
