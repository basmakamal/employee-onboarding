/**
 * The generic status-change template must render without an admin override
 * (a trigger pointing at it used to fail silently), and a trigger's copy
 * recipients must still receive their mail when the group send fails.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { TemplateService } from '../src/notifications/template.service.js';
import { renderTemplate } from '../src/notifications/templates.js';
import { TriggerService } from '../src/notifications/trigger.service.js';
import type { TransitionEvent } from '../src/workflow/engine.js';

describe('custom.status_change', () => {
  it('has a built-in text in both languages', () => {
    const en = renderTemplate('custom.status_change', 'en', { name: 'Sara Ali', status: 'FORM_RECEIVED' });
    const ar = renderTemplate('custom.status_change', 'ar', { name: 'Sara Ali', status: 'FORM_RECEIVED' });
    expect(en.subject).toContain('Sara Ali');
    expect(en.text).toContain('FORM_RECEIVED');
    expect(ar.subject).toContain('Sara Ali');
  });

  it('renders through the template service with no override saved', async () => {
    const prisma = { emailTemplate: { findMany: vi.fn().mockResolvedValue([]) } };
    const svc = new TemplateService(prisma as unknown as PrismaClient, 'https://hr.example');
    const out = await svc.render('custom.status_change', 'en', { name: 'Sara', status: 'CREATED' });
    expect(out.templateVersion).toBeNull();
    expect(out.subject).toContain('Sara');
  });
});

describe('trigger sends are isolated', () => {
  it('copies still go out when the group send throws', async () => {
    const trigger = {
      id: 't1', processKey: 'EMPLOYEE', status: 'FORM_RECEIVED', templateKey: 'custom.status_change',
      recipient: 'ROLE', role: 'HR', active: true, ccEmails: 'basma@riyada-ksa.com',
    };
    const prisma = {
      emailTrigger: { findMany: vi.fn().mockResolvedValue([trigger]) },
      employee: { findUnique: vi.fn().mockResolvedValue({ firstName: 'Sara', lastName: 'Ali', email: 's@x.com' }) },
    };
    const notifications = {
      notifyRole: vi.fn().mockRejectedValue(new Error('template exploded')),
      notifyExternal: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TriggerService(prisma as unknown as PrismaClient, notifications as unknown as NotificationService);
    const event: TransitionEvent = {
      entity: 'EMPLOYEE', entityId: 'e1', action: 'SUBMIT_FORM', from: 'AWAITING_FORM', to: 'FORM_RECEIVED', actorType: 'LINK',
    };

    await expect(service.handle(event)).resolves.toBeUndefined();
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'basma@riyada-ksa.com', 'custom.status_change', expect.anything(), expect.anything(),
    );
  });
});
