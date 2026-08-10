/**
 * NotificationService — persistence-first sending, failure isolation,
 * in-app fan-out. EventBus — handler isolation.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../src/notifications/notification.service.js';
import { renderTemplate } from '../src/notifications/templates.js';
import { EventBus } from '../src/events/event-bus.js';

function makeService(sendImpl?: () => Promise<void>) {
  const rows: Array<Record<string, unknown>> = [];
  const notifications = {
    create: vi.fn().mockImplementation((data: Record<string, unknown>) => {
      const row = { id: `n${rows.length + 1}`, ...data };
      rows.push(row);
      return Promise.resolve(row);
    }),
    markSent: vi.fn().mockResolvedValue({}),
    markFailed: vi.fn().mockResolvedValue({}),
  };
  const users = {
    listActiveByRole: vi
      .fn()
      .mockResolvedValue([{ id: 'u1', email: 'hr@example.com', role: 'HR' }]),
  };
  const notifier = { send: vi.fn().mockImplementation(sendImpl ?? (() => Promise.resolve())) };
  const service = new NotificationService(notifications as never, users as never, notifier);
  return { service, notifications, notifier, users };
}

describe('NotificationService', () => {
  it('persists the email first, sends, then marks SENT', async () => {
    const { service, notifications, notifier } = makeService();

    await service.notifyExternal('sara@example.com', 'employee.form_reminder', { name: 'Sara' });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'EMAIL', recipientEmail: 'sara@example.com' }),
    );
    expect(notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sara@example.com' }),
    );
    expect(notifications.markSent).toHaveBeenCalled();
  });

  it('a failing mailer marks FAILED and does NOT throw (workflow-safe)', async () => {
    const { service, notifications } = makeService(() => Promise.reject(new Error('smtp down')));

    await expect(
      service.notifyExternal('sara@example.com', 'employee.form_reminder', {}),
    ).resolves.toBeUndefined();
    expect(notifications.markFailed).toHaveBeenCalled();
  });

  it('notifyHr creates an in-app row AND an email per active HR user', async () => {
    const { service, notifications } = makeService();

    await service.notifyHr('hr.contract_approved', { name: 'Sara' });

    const channels = notifications.create.mock.calls.map(
      (c) => (c[0] as { channel: string }).channel,
    );
    expect(channels).toEqual(['IN_APP', 'EMAIL']);
  });
});

describe('templates', () => {
  it('renders both locales with parameters', () => {
    const ar = renderTemplate('employee.form_reminder', 'ar', { name: 'سارة' });
    const en = renderTemplate('employee.form_reminder', 'en', { name: 'Sara' });

    expect(ar.subject).toContain('تذكير');
    expect(ar.text).toContain('سارة');
    expect(en.subject).toContain('Reminder');
    expect(en.text).toContain('Sara');
  });

  it('throws on an unknown template key', () => {
    expect(() => renderTemplate('nope', 'ar', {})).toThrow(/unknown notification template/);
  });
});

describe('EventBus', () => {
  it('a failing handler does not affect other handlers or the publisher', async () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.on('x', () => {
      throw new Error('boom');
    });
    bus.on('x', good);

    expect(() => bus.publish({ type: 'x', payload: {} })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // let microtasks drain
    expect(good).toHaveBeenCalled();
  });
});
