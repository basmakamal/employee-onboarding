/**
 * HTTP contract of the email module: template editor, triggers, and the
 * send log — role guards, validation, and what reaches the services.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/common/http.js';
import { emailTemplatesRouter, emailTriggersRouter } from '../src/notifications/email-admin.routes.js';
import { notificationRouter } from '../src/notifications/notification.routes.js';

function deps() {
  const templates = {
    list: vi.fn().mockResolvedValue([{ key: 'staff.record_stalled', customized: false }]),
    get: vi.fn().mockResolvedValue({ key: 'staff.record_stalled', row: null }),
    upsert: vi
      .fn()
      .mockImplementation((key: string, draft: object) => Promise.resolve({ key, ...draft, version: 2 })),
    revert: vi.fn().mockResolvedValue(undefined),
    preview: vi.fn().mockResolvedValue({ subject: 'Hi Sara', text: 'body', html: '<p>body</p>' }),
    sampleParams: vi.fn().mockReturnValue({ name: 'Sara' }),
  };
  const notifications = {
    notifyExternal: vi.fn().mockResolvedValue(undefined),
    resend: vi.fn().mockResolvedValue({ id: 'n2', channel: 'EMAIL', status: 'PENDING' }),
  };
  const users = { findById: vi.fn().mockResolvedValue({ id: 'u1', email: 'admin@example.com' }) };
  const triggers = {
    list: vi.fn().mockResolvedValue([]),
    options: vi.fn().mockReturnValue({ processes: { EMPLOYEE: ['CREATED'] }, roles: ['HR'], templates: [] }),
    create: vi.fn().mockImplementation((input: object) => Promise.resolve({ id: 't1', ...input })),
    update: vi.fn().mockImplementation((id: string, patch: object) => Promise.resolve({ id, ...patch })),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const repo = {
    listLog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listForUser: vi.fn().mockResolvedValue([]),
    unreadCount: vi.fn().mockResolvedValue(0),
    markAllRead: vi.fn().mockResolvedValue({ count: 0 }),
  };
  return { templates, notifications, users, triggers, repo };
}

function appFor(role: 'ADMIN' | 'HR', d = deps()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: 'USER', id: 'u1', role } as typeof req.actor;
    next();
  });
  app.use('/email-templates', emailTemplatesRouter(d.templates as never, d.notifications as never, d.users as never));
  app.use('/email-triggers', emailTriggersRouter(d.triggers as never));
  app.use('/notifications', notificationRouter(d.repo as never, d.notifications as never));
  app.use(errorHandler);
  return { app, d };
}

const validDraft = {
  name: 'Stalled',
  subjectAr: 'م',
  subjectEn: 'Follow-up {{name}}',
  bodyAr: 'ن',
  bodyEn: 'Hello {{name}}',
};

describe('email templates API', () => {
  it('is admin-only', async () => {
    const { app } = appFor('HR');
    expect((await request(app).get('/email-templates')).status).toBe(403);
    expect((await request(app).get('/email-triggers')).status).toBe(403);
  });

  it('lists templates for admins', async () => {
    const { app } = appFor('ADMIN');
    const res = await request(app).get('/email-templates');
    expect(res.status).toBe(200);
    expect(res.body[0].key).toBe('staff.record_stalled');
  });

  it('saves a draft, stamping the editor as author and dropping undefined keys', async () => {
    const { app, d } = appFor('ADMIN');
    const res = await request(app).put('/email-templates/staff.record_stalled').send(validDraft);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    const [key, draft, userId] = d.templates.upsert.mock.calls[0] as [string, object, string];
    expect(key).toBe('staff.record_stalled');
    expect(userId).toBe('u1');
    expect(Object.values(draft)).not.toContain(undefined);
  });

  it('rejects a draft missing a required field with field details', async () => {
    const { app, d } = appFor('ADMIN');
    const { bodyEn: _omit, ...incomplete } = validDraft;
    const res = await request(app).put('/email-templates/staff.record_stalled').send(incomplete);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((x: { path: string }) => x.path)).toContain('bodyEn');
    expect(d.templates.upsert).not.toHaveBeenCalled();
  });

  it('previews an unsaved draft in the requested language', async () => {
    const { app, d } = appFor('ADMIN');
    const res = await request(app)
      .post('/email-templates/custom.status_change/preview')
      .send({ locale: 'en', draft: { subjectEn: 'Hi {{name}}' } });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Hi Sara');
    expect(d.templates.preview).toHaveBeenCalledWith('custom.status_change', 'en', { subjectEn: 'Hi {{name}}' });
  });

  it('sends a test to the signed-in admin only', async () => {
    const { app, d } = appFor('ADMIN');
    const res = await request(app).post('/email-templates/staff.record_stalled/test').send({ locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sentTo: 'admin@example.com' });
    expect(d.notifications.notifyExternal).toHaveBeenCalledWith(
      'admin@example.com',
      'staff.record_stalled',
      { name: 'Sara' },
      { entity: 'TEMPLATE_TEST', entityId: 'staff.record_stalled' },
      'en',
    );
  });

  it('reverts to the built-in text', async () => {
    const { app, d } = appFor('ADMIN');
    expect((await request(app).delete('/email-templates/staff.record_stalled')).status).toBe(204);
    expect(d.templates.revert).toHaveBeenCalledWith('staff.record_stalled');
  });
});

describe('email triggers API', () => {
  it('creates a trigger', async () => {
    const { app, d } = appFor('ADMIN');
    const body = {
      processKey: 'EMPLOYEE', status: 'CREATED', templateKey: 'custom.status_change', recipient: 'SUBJECT',
    };
    const res = await request(app).post('/email-triggers').send(body);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('t1');
    expect(d.triggers.create).toHaveBeenCalledWith(body, 'u1');
  });

  it('rejects an unknown recipient kind', async () => {
    const { app } = appFor('ADMIN');
    const res = await request(app)
      .post('/email-triggers')
      .send({ processKey: 'EMPLOYEE', status: 'CREATED', templateKey: 'x', recipient: 'EVERYONE' });
    expect(res.status).toBe(400);
  });

  it('applies partial updates without touching other fields', async () => {
    const { app, d } = appFor('ADMIN');
    const res = await request(app).put('/email-triggers/t1').send({ active: false });
    expect(res.status).toBe(200);
    expect(d.triggers.update).toHaveBeenCalledWith('t1', { active: false });
  });

  it('exposes the option lists for the form', async () => {
    const { app } = appFor('ADMIN');
    const res = await request(app).get('/email-triggers/options');
    expect(res.status).toBe(200);
    expect(res.body.processes.EMPLOYEE).toEqual(['CREATED']);
  });
});

describe('email log API', () => {
  it('lets HR page and filter the send log', async () => {
    const { app, d } = appFor('HR');
    const res = await request(app).get('/notifications/log?page=2&limit=10&status=FAILED&q=sara');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0 });
    expect(d.repo.listLog).toHaveBeenCalledWith({ page: 2, limit: 10, status: 'FAILED', q: 'sara' });
  });

  it('clamps the page size', async () => {
    const { app } = appFor('HR');
    expect((await request(app).get('/notifications/log?limit=5000')).status).toBe(400);
  });

  it('resends as a new log row', async () => {
    const { app, d } = appFor('HR');
    const res = await request(app).post('/notifications/n1/resend');
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('n2');
    expect(d.notifications.resend).toHaveBeenCalledWith('n1');
  });
});
