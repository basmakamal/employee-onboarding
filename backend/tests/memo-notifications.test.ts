/**
 * The HR memo's notification table, end to end: every template exists in
 * both languages, employee messages carry their personal link, team messages
 * carry the employee's file, and each pipeline step sends what the memo says.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderTemplate } from '../src/notifications/templates.js';
import { TEMPLATE_CATALOG, PLACEHOLDERS } from '../src/notifications/template-catalog.js';
import { NotificationService } from '../src/notifications/notification.service.js';
import { OnboardingService } from '../src/modules/employees/onboarding.service.js';
import { assetFormWatcher, onboardingWatcher } from '../src/workflow/sla-watchers.js';
import type { Workflow } from '../src/workflow/engine.js';
import type { Employee } from '../src/generated/prisma/client.js';

const HR = { type: 'USER' as const, id: 'hr1', role: 'HR' };

/** The memo's rows, by the template that carries each one. */
const MEMO_TEMPLATES = [
  'employee.form_invite',
  'employee.form_reminder',
  'staff.form_pending',
  'hr.form_submitted',
  'employee.form_missing',
  'staff.form_missing',
  'staff.form_expired',
  'hr.ready_for_contract',
  'staff.contract_pending_creation',
  'employee.contract_ready',
  'employee.contract_approval_reminder',
  'staff.contract_approval_pending',
  'staff.contract_approval_expired',
  'hr.contract_status_active',
  'hr.contract_rejected',
  'hr.employee_activated',
  'employee.asset_approval',
  'employee.asset_reminder',
  'staff.asset_pending',
  'hr.asset_approved',
  'hr.asset_rejected',
];

const SAMPLE = {
  name: 'Nora Khalid',
  employeeNo: 'EMP-0042',
  daysWaiting: 3,
  linkUrl: 'https://hr.example/form/tok',
  contractLink: 'https://hr.example/contract/tok',
  employeeLink: 'https://hr.example/employees/e1',
  missingItems: 'IBAN letter',
  rejectReason: 'salary band',
  contractSalary: '9000',
  contractDuration: '12',
  contractStartDate: '2026-10-01',
};

describe('the memo templates', () => {
  it('every one exists in the catalogue and renders in Arabic and English', () => {
    for (const key of MEMO_TEMPLATES) {
      expect(TEMPLATE_CATALOG[key], key).toBeDefined();
      const ar = renderTemplate(key, 'ar', SAMPLE);
      const en = renderTemplate(key, 'en', SAMPLE);
      expect(ar.subject.length, `${key} ar subject`).toBeGreaterThan(0);
      expect(en.subject.length, `${key} en subject`).toBeGreaterThan(0);
      expect(ar.text, `${key} ar body`).toContain('Nora Khalid');
      expect(en.text, `${key} en body`).toContain('Nora Khalid');
      expect(ar.text).not.toContain('undefined');
      expect(en.text).not.toContain('undefined');
    }
  });

  it('every catalogue entry has a code template, and its placeholders are all known', () => {
    for (const [key, meta] of Object.entries(TEMPLATE_CATALOG)) {
      expect(() => renderTemplate(key, 'ar', SAMPLE), key).not.toThrow();
      expect(() => renderTemplate(key, 'en', SAMPLE), key).not.toThrow();
      for (const p of meta.placeholders) expect(PLACEHOLDERS[p], `${key} → ${p}`).toBeDefined();
    }
  });

  it("team messages link to the employee's file; employee messages carry their personal link", () => {
    for (const key of MEMO_TEMPLATES) {
      const meta = TEMPLATE_CATALOG[key]!;
      const en = renderTemplate(key, 'en', SAMPLE);
      if (meta.audience === 'staff') {
        expect(meta.placeholders, key).toContain('employeeLink');
        expect(en.html, key).toContain(SAMPLE.employeeLink);
      } else {
        const personal = key.startsWith('employee.contract') ? SAMPLE.contractLink : SAMPLE.linkUrl;
        expect(en.html, key).toContain(personal);
        // A personal link always comes with the do-not-share note.
        expect(en.text, key).toContain('do not share it');
      }
    }
  });

  it('carries the memo wording', () => {
    expect(renderTemplate('employee.form_invite', 'ar', SAMPLE).subject).toBe(
      'أهلًا بك في ريادة | استكمال بيانات التوظيف',
    );
    expect(renderTemplate('hr.form_submitted', 'ar', SAMPLE).subject).toBe('تم استكمال بيانات المتدرب – Nora Khalid');
    expect(renderTemplate('employee.form_missing', 'en', SAMPLE).text).toContain('IBAN letter');
    expect(renderTemplate('hr.contract_rejected', 'ar', SAMPLE).text).toContain('سبب الرفض: salary band');
    expect(renderTemplate('hr.employee_activated', 'en', SAMPLE).text).toContain('Employee number: EMP-0042');
    expect(renderTemplate('employee.contract_ready', 'en', SAMPLE).text).toContain('Salary: 9000');
  });
});

describe('NotificationService links a message to the employee file', () => {
  function makeService() {
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'n1' }), markSent: vi.fn(), markFailed: vi.fn() };
    const users = { listActiveByRole: vi.fn().mockResolvedValue([{ id: 'u1', email: 'hr@x.com' }]) };
    const notifier = { send: vi.fn().mockResolvedValue(undefined) };
    const render = vi.fn().mockResolvedValue({ subject: 's', text: 't', templateKey: 'k', templateVersion: null });
    const service = new NotificationService(
      notifications as never,
      users as never,
      notifier,
      undefined,
      undefined,
      render,
      'https://hr.example/',
    );
    return { service, render };
  }

  it('derives employeeLink from an EMPLOYEE reference so no sender can forget it', async () => {
    const { service, render } = makeService();
    await service.notifyHr('hr.form_submitted', { name: 'Nora' }, { entity: 'EMPLOYEE', entityId: 'e1' });
    expect(render).toHaveBeenCalledWith(
      'hr.form_submitted',
      'ar',
      expect.objectContaining({ employeeLink: 'https://hr.example/employees/e1' }),
    );
  });

  it('leaves other references alone — a custody form id is not an employee id', async () => {
    const { service, render } = makeService();
    await service.notifyHr('hr.asset_approved', { name: 'Nora' }, { entity: 'ASSET_FORM', entityId: 'f1' });
    expect(render.mock.calls[0]?.[2]).not.toHaveProperty('employeeLink');
  });
});

describe('the onboarding steps send what the memo says', () => {
  const EMPLOYEE = {
    id: 'e1', firstName: 'Nora', lastName: 'Khalid', email: 'nora@example.com', status: 'FORM_RECEIVED',
  } as unknown as Employee;

  function makeService(overrides: { status?: string; contract?: unknown } = {}) {
    const employee = { ...EMPLOYEE, status: overrides.status ?? EMPLOYEE.status };
    const contract =
      'contract' in overrides
        ? overrides.contract
        : { id: 'c1', status: 'DRAFT', externalRef: 'C-1', details: { salary: '9000', durationMonths: '12' } };
    const repos = {
      employees: {
        findById: vi.fn().mockResolvedValue(employee),
        allocateEmployeeNo: vi.fn().mockResolvedValue('EMP-0042'),
        completeActivation: vi.fn().mockResolvedValue({}),
      },
      documents: { listByEmployee: vi.fn().mockResolvedValue([]) },
      contracts: { findByEmployee: vi.fn().mockResolvedValue(contract), setStatus: vi.fn().mockResolvedValue({}) },
      audit: { append: vi.fn().mockResolvedValue({}) },
    };
    const workflow = {
      transition: vi.fn().mockImplementation((_e: Employee, action: string) =>
        Promise.resolve({ from: employee.status, to: action, action }),
      ),
    } as unknown as Workflow<Employee>;
    const links = {
      issue: vi.fn().mockResolvedValue({ url: 'https://hr.example/l/tok', expiresAt: new Date() }),
      verify: vi.fn(),
      markUsed: vi.fn(),
    };
    const notifications = {
      notifyExternal: vi.fn().mockResolvedValue(undefined),
      notifyHr: vi.fn().mockResolvedValue(undefined),
      notifyRoleAndUsers: vi.fn().mockResolvedValue(undefined),
    };
    const scope = { ...repos, workflow, markLinkUsed: links.markUsed };
    const transact = (fn: (s: typeof scope) => Promise<unknown>) => fn(scope);
    const responsibility = { get: vi.fn().mockResolvedValue([]) };
    const service = new OnboardingService(
      repos as never,
      workflow,
      links as never,
      notifications as never,
      transact as never,
      { halt: vi.fn() } as never,
      responsibility,
    );
    return { service, notifications, links, responsibility };
  }

  it('row 4 — missing items: the trainee gets the list and a fresh form link, the team a copy', async () => {
    const { service, notifications, links } = makeService();

    await service.requestMissing('e1', HR, 'IBAN letter is blurry');

    expect(links.issue).toHaveBeenCalledWith('DATA_FORM', { employeeId: 'e1' });
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'nora@example.com',
      'employee.form_missing',
      expect.objectContaining({ missingItems: 'IBAN letter is blurry', linkUrl: 'https://hr.example/l/tok' }),
      { entity: 'EMPLOYEE', entityId: 'e1' },
      'ar',
    );
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'staff.form_missing',
      expect.objectContaining({ missingItems: 'IBAN letter is blurry' }),
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
  });

  it('row 6 — documents accepted: the team hears the file is ready for the contract', async () => {
    const { service, notifications } = makeService();
    await service.acceptDocuments('e1', HR);
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.ready_for_contract',
      { name: 'Nora Khalid' },
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
  });

  it('row 8 — contract submitted: the trainee gets the terms and a contract link', async () => {
    const { service, notifications, links } = makeService({ status: 'CONTRACT_CREATION' });

    await service.setContractStatus('e1', 'PENDING_APPROVAL', HR);

    expect(links.issue).toHaveBeenCalledWith('CONTRACT_APPROVAL', { employeeId: 'e1' });
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'nora@example.com',
      'employee.contract_ready',
      expect.objectContaining({
        contractSalary: '9000',
        contractDuration: '12',
        contractRef: 'C-1',
        contractLink: 'https://hr.example/l/tok',
      }),
      { entity: 'EMPLOYEE', entityId: 'e1' },
      'ar',
    );
  });

  it('rows 11 and 13 — Active: status notice and employee-file notice, with the number', async () => {
    const { service, notifications } = makeService({ status: 'AWAITING_CONTRACT_APPROVAL' });
    await service.setContractStatus('e1', 'ACTIVE', HR);
    for (const key of ['hr.contract_status_active', 'hr.employee_activated']) {
      expect(notifications.notifyHr).toHaveBeenCalledWith(
        key,
        { name: 'Nora Khalid', employeeNo: 'EMP-0042' },
        { entity: 'EMPLOYEE', entityId: 'e1' },
      );
    }
  });

  it('row 12 — Rejected: the team gets the reason', async () => {
    const { service, notifications } = makeService({ status: 'AWAITING_CONTRACT_APPROVAL' });
    await service.setContractStatus('e1', 'REJECTED', HR, { reason: 'salary band' });
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.contract_rejected',
      { name: 'Nora Khalid', rejectReason: 'salary band' },
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
  });

  it('named owners receive team notices in addition to the HR group, never instead', async () => {
    const { service, notifications, responsibility } = makeService();
    responsibility.get.mockResolvedValue(['u-fatoun']);
    await service.acceptDocuments('e1', HR);
    expect(notifications.notifyRoleAndUsers).toHaveBeenCalledWith(
      'HR',
      ['u-fatoun'],
      'hr.ready_for_contract',
      { name: 'Nora Khalid' },
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
    expect(notifications.notifyHr).not.toHaveBeenCalled();
  });
});

describe('the reminders pick the memo wording per status', () => {
  it('onboarding: rows 2, 5, 7, 9 and 10', () => {
    const w = onboardingWatcher({} as never, {} as never);
    expect(w.staffTemplate?.('stalled', 'AWAITING_FORM')).toBe('staff.form_pending');
    expect(w.staffTemplate?.('expired', 'AWAITING_FORM')).toBe('staff.form_expired');
    expect(w.staffTemplate?.('stalled', 'CONTRACT_CREATION')).toBe('staff.contract_pending_creation');
    expect(w.staffTemplate?.('stalled', 'AWAITING_CONTRACT_APPROVAL')).toBe('staff.contract_approval_pending');
    expect(w.staffTemplate?.('expired', 'AWAITING_CONTRACT_APPROVAL')).toBe('staff.contract_approval_expired');
    expect(w.subjectTemplate?.('AWAITING_CONTRACT_APPROVAL')).toBe('employee.contract_approval_reminder');
    // Escalation keeps the generic wording — the memo has no row for it.
    expect(w.staffTemplate?.('escalation', 'AWAITING_FORM')).toBeUndefined();
  });

  it('custody (row 15): the employee is reminded with a fresh link, the team copy names them', async () => {
    const forms = {
      listInStatusSince: vi.fn().mockResolvedValue([
        {
          id: 'f1', employeeId: 'e1', sentAt: new Date('2026-09-10T08:00:00Z'), updatedAt: new Date(),
          employee: { firstName: 'Nora', lastName: 'Khalid', email: 'nora@example.com', preferredLanguage: 'EN' },
        },
      ]),
    };
    const links = { issue: vi.fn().mockResolvedValue({ url: 'https://hr.example/approve-assets/tok' }) };
    const w = assetFormWatcher(forms as never, links);

    const [record] = await w.listInStatusSince('SENT', new Date(), 10);
    expect(record).toMatchObject({ id: 'f1', email: 'nora@example.com', locale: 'en', employeeId: 'e1' });
    expect(w.subjectTemplate?.('SENT')).toBe('employee.asset_reminder');
    expect(w.subjectTemplate?.('PENDING_EMPLOYEE_APPROVAL')).toBe('employee.asset_reminder');
    expect(w.staffTemplate?.('stalled', 'SENT')).toBe('staff.asset_pending');

    const extra = await w.subjectParams!(record!, 'SENT');
    expect(links.issue).toHaveBeenCalledWith('ASSET_APPROVAL', { employeeId: 'e1', assetFormId: 'f1' });
    expect(extra).toEqual({ linkUrl: 'https://hr.example/approve-assets/tok' });
  });
});
