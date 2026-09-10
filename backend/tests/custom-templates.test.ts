/**
 * Admin-created templates: created with a unique key, listed after the
 * built-ins, usable by triggers, and protected from deletion while in use.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { TemplateService } from '../src/notifications/template.service.js';
import { TriggerService } from '../src/notifications/trigger.service.js';
import { GuardFailedError } from '../src/workflow/errors.js';

function customRow(over: Record<string, unknown> = {}) {
  return {
    key: 'custom.welcome-pack', name: 'Welcome pack', audience: 'employee',
    subjectAr: 'أهلًا {{name}}', subjectEn: 'Welcome {{name}}', bodyAr: 'نص', bodyEn: 'Body {{status}}',
    ctaLabelAr: null, ctaLabelEn: null, active: true, version: 1, updatedAt: new Date(), updatedById: null,
    ...over,
  };
}

function setup(rows: unknown[] = [], usage = { triggers: 0, rules: 0 }) {
  const prisma = {
    emailTemplate: {
      findMany: vi.fn().mockResolvedValue(rows),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...customRow(), ...data, version: 1, updatedAt: new Date() }),
      ),
      upsert: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    emailTrigger: { count: vi.fn().mockResolvedValue(usage.triggers) },
    slaRule: { count: vi.fn().mockResolvedValue(usage.rules) },
  };
  return { prisma, svc: new TemplateService(prisma as unknown as PrismaClient, 'https://hr.example') };
}

const draft = { name: 'Welcome pack', subjectAr: 'أهلًا', subjectEn: 'Welcome', bodyAr: 'نص', bodyEn: 'Body' };

describe('TemplateService custom templates', () => {
  it('create derives a custom.* key from the name and stores the audience', async () => {
    const { svc, prisma } = setup();
    await svc.create({ ...draft, audience: 'employee' }, 'u1');
    const data = (prisma.emailTemplate.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data['key']).toBe('custom.welcome-pack');
    expect(data['audience']).toBe('employee');
    expect(data['updatedById']).toBe('u1');
  });

  it('keeps keys unique when a name repeats', async () => {
    const { svc, prisma } = setup([customRow()]);
    await svc.create({ ...draft, audience: 'staff' });
    const data = (prisma.emailTemplate.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data['key']).toBe('custom.welcome-pack-2');
  });

  it('lists custom templates after the built-ins, flagged as custom', async () => {
    const { svc } = setup([customRow()]);
    const list = await svc.list();
    const last = list[list.length - 1]!;
    expect(last.key).toBe('custom.welcome-pack');
    expect(last.custom).toBe(true);
    expect(last.audience).toBe('employee');
    expect(list.filter((t) => t.custom)).toHaveLength(1);
  });

  it('renders a custom template and fills its placeholders', async () => {
    const { svc } = setup([customRow()]);
    const out = await svc.render('custom.welcome-pack', 'en', { name: 'Sara', status: 'ACTIVE' });
    expect(out.subject).toBe('Welcome Sara');
    expect(out.text).toContain('Body ACTIVE');
    expect(out.templateVersion).toBe(1);
  });

  it('refuses to render a custom template that is switched off', async () => {
    const { svc } = setup([customRow({ active: false })]);
    await expect(svc.render('custom.welcome-pack', 'en', { name: 'Sara' })).rejects.toBeInstanceOf(GuardFailedError);
  });

  it('will not delete a custom template still used by a trigger', async () => {
    const { svc, prisma } = setup([customRow()], { triggers: 1, rules: 0 });
    await expect(svc.revert('custom.welcome-pack')).rejects.toThrow(/used by 1 trigger/);
    expect(prisma.emailTemplate.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes an unused custom template', async () => {
    const { svc, prisma } = setup([customRow()]);
    await svc.revert('custom.welcome-pack');
    expect(prisma.emailTemplate.deleteMany).toHaveBeenCalledWith({ where: { key: 'custom.welcome-pack' } });
  });

  it('a trigger may point at a custom template, and the picker offers it', async () => {
    const { svc } = setup([customRow()]);
    const prisma = { emailTrigger: { create: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 't1', ...data })) } };
    const triggers = new TriggerService(prisma as unknown as PrismaClient, {} as NotificationService, svc);
    const created = await triggers.create({
      processKey: 'EMPLOYEE', status: 'CREATED', templateKey: 'custom.welcome-pack', recipient: 'SUBJECT',
    });
    expect(created.templateKey).toBe('custom.welcome-pack');
    const options = await triggers.options();
    expect(options.templates.some((t) => t.key === 'custom.welcome-pack')).toBe(true);
    await expect(
      triggers.create({ processKey: 'EMPLOYEE', status: 'CREATED', templateKey: 'custom.nope', recipient: 'SUBJECT' }),
    ).rejects.toBeInstanceOf(GuardFailedError);
  });
});
