/**
 * {{formLink}} in an admin-created template: the trigger issues one fresh
 * data-form link for the employee and every recipient of that event gets the
 * same URL. Templates that do not mention it must not cause a link to be
 * issued, because issuing invalidates the link the employee already holds.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { TemplateService } from '../src/notifications/template.service.js';
import { TriggerService } from '../src/notifications/trigger.service.js';
import type { TransitionEvent } from '../src/workflow/engine.js';

const EVENT: TransitionEvent = {
  entity: 'EMPLOYEE', entityId: 'e1', action: 'SEND_FORM', from: 'CREATED', to: 'AWAITING_FORM', actorType: 'USER',
};

function row(body: string) {
  return {
    key: 'custom.form-nudge', name: 'Form nudge', audience: 'employee', active: true, version: 1,
    subjectAr: 'نموذجك', subjectEn: 'Your form', bodyAr: body, bodyEn: body, ctaLabelAr: null, ctaLabelEn: null,
  };
}

function setup(body: string) {
  const trigger = {
    id: 't1', processKey: 'EMPLOYEE', status: 'AWAITING_FORM', templateKey: 'custom.form-nudge',
    recipient: 'SUBJECT', role: null, active: true, ccEmails: 'hr@riyada-ksa.com',
  };
  const prisma = {
    emailTrigger: { findMany: vi.fn().mockResolvedValue([trigger]) },
    emailTemplate: { findMany: vi.fn().mockResolvedValue([row(body)]) },
    employee: { findUnique: vi.fn().mockResolvedValue({ firstName: 'Sara', lastName: 'Ali', email: 's@x.com' }) },
  };
  const templates = new TemplateService(prisma as unknown as PrismaClient, 'https://hr.example');
  const notifications = { notifyExternal: vi.fn().mockResolvedValue(undefined) };
  const links = { issue: vi.fn().mockResolvedValue({ url: 'https://hr.example/form/tok123' }) };
  const service = new TriggerService(
    prisma as unknown as PrismaClient,
    notifications as unknown as NotificationService,
    templates,
    links,
  );
  return { service, templates, notifications, links };
}

describe('{{formLink}} in custom templates', () => {
  it('is offered to the editor and turns the CTA button on', async () => {
    const { templates } = setup('Please open {{formLink}} and complete your data.');
    const detail = await templates.get('custom.form-nudge');
    expect(detail.placeholders.map((p) => p.key)).toContain('formLink');
    expect(detail.meta.hasCta).toBe(true);
  });

  it('issues one link per event and gives the same URL to the employee and the copy', async () => {
    const { service, notifications, links } = setup('Open {{formLink}} please.');
    await service.handle(EVENT);
    expect(links.issue).toHaveBeenCalledTimes(1);
    expect(links.issue).toHaveBeenCalledWith('DATA_FORM', { employeeId: 'e1' });
    const params = expect.objectContaining({ formLink: 'https://hr.example/form/tok123', linkUrl: 'https://hr.example/form/tok123' });
    expect(notifications.notifyExternal).toHaveBeenCalledWith('s@x.com', 'custom.form-nudge', params, expect.anything(), 'ar');
    expect(notifications.notifyExternal).toHaveBeenCalledWith('hr@riyada-ksa.com', 'custom.form-nudge', params, expect.anything());
  });

  it('renders the link inline and as the button', async () => {
    const { templates } = setup('Open {{formLink}} please.');
    const out = await templates.render('custom.form-nudge', 'en', { name: 'Sara', formLink: 'https://hr.example/form/tok123', linkUrl: 'https://hr.example/form/tok123' });
    expect(out.text).toContain('Open https://hr.example/form/tok123 please.');
    expect(out.html).toContain('https://hr.example/form/tok123');
  });

  it('does not issue a link when the template never mentions it', async () => {
    const { service, links } = setup('Hello {{name}}, your status is {{status}}.');
    await service.handle(EVENT);
    expect(links.issue).not.toHaveBeenCalled();
  });
});
