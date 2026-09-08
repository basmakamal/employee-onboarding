import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { TemplateService } from '../src/notifications/template.service.js';
import { renderTemplate } from '../src/notifications/templates.js';
import { TriggerService } from '../src/notifications/trigger.service.js';
import type { TransitionEvent } from '../src/workflow/engine.js';
import { GuardFailedError } from '../src/workflow/errors.js';

// ── template service ─────────────────────────────────────────────────────────

function overrideRow(over: Record<string, unknown> = {}) {
  return {
    key: 'staff.record_stalled',
    name: 'Stalled record',
    subjectAr: 'متابعة {{name}}',
    subjectEn: 'Follow-up on {{name}} ({{status}})',
    bodyAr: 'مرحبًا {{name}}',
    bodyEn: 'Hello {{name}},\n\nThe record has waited {{daysWaiting}} days. {{notAPlaceholder}}\n\nThanks',
    ctaLabelAr: null,
    ctaLabelEn: null,
    active: true,
    version: 3,
    updatedAt: new Date(),
    updatedById: null,
    ...over,
  };
}

function templates(rows: unknown[]) {
  const prisma = {
    emailTemplate: {
      findMany: vi.fn().mockResolvedValue(rows),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return new TemplateService(prisma as unknown as PrismaClient, 'https://hr.example');
}

describe('TemplateService.render', () => {
  const params = { name: 'Sara Ali', status: 'CREATED', daysWaiting: 2 };

  it('falls back to the built-in template when nothing is overridden', async () => {
    const out = await templates([]).render('staff.record_stalled', 'en', params);
    const code = renderTemplate('staff.record_stalled', 'en', params);
    expect(out.subject).toBe(code.subject);
    expect(out.text).toBe(code.text);
    expect(out.templateVersion).toBeNull();
    expect(out.templateKey).toBe('staff.record_stalled');
  });

  it('uses an active override, fills placeholders, drops unknown ones, stamps the version', async () => {
    const out = await templates([overrideRow()]).render('staff.record_stalled', 'en', params);
    expect(out.subject).toBe('Follow-up on Sara Ali (CREATED)');
    expect(out.text).toContain('Hello Sara Ali,');
    expect(out.text).toContain('waited 2 days');
    expect(out.text).not.toContain('{{');
    expect(out.templateVersion).toBe(3);
    expect(out.html).toContain('waited 2 days');
  });

  it('ignores an override that was switched off', async () => {
    const out = await templates([overrideRow({ active: false })]).render(
      'staff.record_stalled',
      'en',
      params,
    );
    expect(out.templateVersion).toBeNull();
    expect(out.subject).toBe(renderTemplate('staff.record_stalled', 'en', params).subject);
  });

  it('escapes HTML coming from data so a name cannot inject markup', async () => {
    const out = await templates([overrideRow()]).render('staff.record_stalled', 'en', {
      ...params,
      name: '<script>alert(1)</script>',
    });
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toContain('<script>');
  });

  it('adds the link button when the message carries a link', async () => {
    const out = await templates([overrideRow({ ctaLabelEn: 'Open form' })]).render(
      'staff.record_stalled',
      'en',
      { ...params, linkUrl: 'https://hr.example/form/abc' },
    );
    expect(out.text).toContain('Open form: https://hr.example/form/abc');
    expect(out.html).toContain('href="https://hr.example/form/abc"');
  });

  it('previews an unsaved draft with sample data', async () => {
    const out = await templates([]).preview('custom.status_change', 'en', {
      subjectEn: 'Update for {{name}}',
      bodyEn: 'Now {{status}}.',
    });
    expect(out.subject).toMatch(/^Update for \S/);
    expect(out.subject).not.toContain('{{');
    expect(out.text).not.toContain('{{');
  });

  it('refuses a draft missing a subject or body in either language', async () => {
    await expect(
      templates([]).upsert('staff.record_stalled', {
        name: 'x',
        subjectAr: 'a',
        subjectEn: 'b',
        bodyAr: 'c',
        bodyEn: '   ',
      }),
    ).rejects.toBeInstanceOf(GuardFailedError);
  });
});

// ── trigger service ──────────────────────────────────────────────────────────

function triggerSetup(triggers: Array<Record<string, unknown>>) {
  const employee = {
    firstName: 'Sara',
    lastName: 'Ali',
    email: 'sara@example.com',
    employeeNo: 'EMP-7',
    department: 'Finance',
    jobTitle: 'Analyst',
  };
  const prisma = {
    emailTrigger: { findMany: vi.fn().mockResolvedValue(triggers) },
    employee: { findUnique: vi.fn().mockResolvedValue(employee) },
  };
  const notifications = { notifyExternal: vi.fn(), notifyRole: vi.fn() };
  const service = new TriggerService(
    prisma as unknown as PrismaClient,
    notifications as unknown as NotificationService,
  );
  return { service, prisma, notifications };
}

const baseTrigger = {
  id: 't1',
  processKey: 'EMPLOYEE',
  status: 'CREATED',
  templateKey: 'custom.status_change',
  recipient: 'SUBJECT',
  role: null,
  active: true,
  createdAt: new Date(),
  createdById: null,
};

function event(over: Partial<TransitionEvent> = {}): TransitionEvent {
  return {
    entity: 'EMPLOYEE',
    entityId: 'e1',
    action: 'create',
    from: 'NEW',
    to: 'CREATED',
    actorType: 'USER',
    ...over,
  };
}

describe('TriggerService.handle', () => {
  it('emails the employee when a record enters the watched status', async () => {
    const { service, notifications } = triggerSetup([baseTrigger]);
    await service.handle(event());
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'sara@example.com',
      'custom.status_change',
      expect.objectContaining({
        name: 'Sara Ali',
        status: 'CREATED',
        employeeNo: 'EMP-7',
        department: 'Finance',
      }),
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
    expect(notifications.notifyRole).not.toHaveBeenCalled();
  });

  it('stays quiet for statuses nobody asked about', async () => {
    const { service, notifications, prisma } = triggerSetup([baseTrigger]);
    await service.handle(event({ to: 'CONTRACT_SENT' }));
    expect(notifications.notifyExternal).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('sends staff-group triggers through notifyRole', async () => {
    const { service, notifications } = triggerSetup([
      { ...baseTrigger, recipient: 'ROLE', role: 'IT' },
    ]);
    await service.handle(event());
    expect(notifications.notifyRole).toHaveBeenCalledWith(
      'IT',
      'custom.status_change',
      expect.objectContaining({ name: 'Sara Ali' }),
      expect.anything(),
    );
  });

  it('resolves the employee through the event for sub-process machines', async () => {
    const { service, prisma } = triggerSetup([
      { ...baseTrigger, processKey: 'GOSI', status: 'REGISTERED' },
    ]);
    await service.handle(
      event({ entity: 'GOSI', entityId: 'g1', to: 'REGISTERED', employeeId: 'e1' }),
    );
    expect(prisma.employee.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e1' } }),
    );
  });

  it('does not let one failing trigger block the others', async () => {
    const { service, notifications } = triggerSetup([
      baseTrigger,
      { ...baseTrigger, id: 't2', recipient: 'ROLE', role: 'HR' },
    ]);
    notifications.notifyExternal.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.handle(event())).resolves.toBeUndefined();
    expect(notifications.notifyRole).toHaveBeenCalledTimes(1);
  });
});
