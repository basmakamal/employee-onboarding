/**
 * The contract email used to arrive as two sentences: no terms, no link.
 * The terms HR recorded now travel as placeholders, and the message carries
 * a signed link to the contract page (where the document is downloaded).
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { contractParams } from '../src/notifications/contract-params.js';
import { renderTemplate } from '../src/notifications/templates.js';
import { TemplateService } from '../src/notifications/template.service.js';
import { TriggerService } from '../src/notifications/trigger.service.js';
import type { TransitionEvent } from '../src/workflow/engine.js';

const CONTRACT = {
  externalRef: 'C-2026-114',
  details: { salary: '9000', durationMonths: '12', startDate: '2026-10-01', terms: 'Full time' },
};

describe('contractParams', () => {
  it('maps the recorded terms and derives the end date', () => {
    expect(contractParams(CONTRACT)).toEqual({
      contractSalary: '9000',
      contractDuration: '12',
      contractStartDate: '2026-10-01',
      contractEndDate: '2027-09-30',
      contractTerms: 'Full time',
      contractRef: 'C-2026-114',
    });
  });

  it('leaves out what HR did not record, and never invents an end date', () => {
    expect(contractParams({ details: { salary: '5000' } })).toEqual({ contractSalary: '5000' });
    expect(contractParams(null)).toEqual({});
  });
});

describe('employee.contract_approval_reminder', () => {
  it('lists the terms and points the button at the contract page', () => {
    const message = renderTemplate('employee.contract_approval_reminder', 'en', {
      name: 'Sara Ali',
      ...contractParams(CONTRACT),
      contractLink: 'https://hr.example/contract/tok123',
    });
    expect(message.text).toContain('Salary: 9000');
    expect(message.text).toContain('End date: 2027-09-30');
    expect(message.text).toContain('View contract: https://hr.example/contract/tok123');
    expect(message.html).toContain('https://hr.example/contract/tok123');
    expect(message.html).toContain('C-2026-114');
  });

  it('still renders when nothing was recorded — no empty rows, no dead button', () => {
    const message = renderTemplate('employee.contract_approval_reminder', 'ar', { name: 'سارة' });
    expect(message.text).toContain('سارة');
    expect(message.text).not.toContain('undefined');
    expect(message.html).not.toContain('href="undefined"');
  });
});

describe('a trigger on the contract status', () => {
  function setup() {
    const trigger = {
      id: 't1', processKey: 'EMPLOYEE', status: 'AWAITING_CONTRACT_APPROVAL',
      templateKey: 'employee.contract_approval_reminder',
      recipient: 'SUBJECT', role: null, active: true, ccEmails: null,
    };
    const prisma = {
      emailTrigger: { findMany: vi.fn().mockResolvedValue([trigger]) },
      emailTemplate: { findMany: vi.fn().mockResolvedValue([]) },
      employee: {
        findUnique: vi.fn().mockResolvedValue({
          firstName: 'Sara', lastName: 'Ali', email: 's@x.com', preferredLanguage: 'EN',
          contract: CONTRACT,
        }),
      },
    };
    const templates = new TemplateService(prisma as unknown as PrismaClient, 'https://hr.example');
    const notifications = { notifyExternal: vi.fn().mockResolvedValue(undefined) };
    const links = { issue: vi.fn().mockResolvedValue({ url: 'https://hr.example/contract/tok123' }) };
    const service = new TriggerService(
      prisma as unknown as PrismaClient,
      notifications as unknown as NotificationService,
      templates,
      links,
    );
    return { service, notifications, links };
  }

  it('sends the terms plus a freshly issued contract link', async () => {
    const { service, notifications, links } = setup();
    const event: TransitionEvent = {
      entity: 'EMPLOYEE', entityId: 'e1', action: 'SUBMIT_CONTRACT',
      from: 'CONTRACT_CREATION', to: 'AWAITING_CONTRACT_APPROVAL', actorType: 'USER',
    };

    await service.handle(event);

    expect(links.issue).toHaveBeenCalledWith('CONTRACT_APPROVAL', { employeeId: 'e1' });
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      's@x.com',
      'employee.contract_approval_reminder',
      expect.objectContaining({
        contractSalary: '9000',
        contractRef: 'C-2026-114',
        contractLink: 'https://hr.example/contract/tok123',
        linkUrl: 'https://hr.example/contract/tok123',
      }),
      expect.anything(),
      'en',
    );
  });
});

describe('an admin-authored body', () => {
  it('keeps the line breaks of a typed list of terms', () => {
    const prisma = { emailTemplate: { findMany: vi.fn().mockResolvedValue([]) } };
    const svc = new TemplateService(prisma as unknown as PrismaClient, 'https://hr.example');
    const body = 'Hello {{name}},\n\nSalary: {{contractSalary}}\nDuration: {{contractDuration}}';
    const out = svc.renderDraft(
      { name: 'n', subjectAr: 's', subjectEn: 's', bodyAr: body, bodyEn: body },
      'en',
      { name: 'Sara', contractSalary: '9000', contractDuration: '12' },
    );
    expect(out.html).toContain('Salary: 9000<br>Duration: 12');
    expect(out.text).toContain('Salary: 9000\nDuration: 12');
  });
});
