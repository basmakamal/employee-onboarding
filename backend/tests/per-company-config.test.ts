/**
 * Per-company configuration: every message uses the wording and mail server
 * of the company it is about; a company without its own mail settings sends
 * through the main company's; a new company starts with the default
 * automation rules and a holiday calendar.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../src/notifications/notification.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { CompanyDefaults } from '../src/modules/companies/company-defaults.js';
import { DEFAULT_SLA_RULES } from '../src/workflow/sla-defaults.js';

describe('NotificationService — the company of a message', () => {
  function makeService(ofRef: string | null) {
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'n1' }), markSent: vi.fn(), markFailed: vi.fn() };
    const users = { listActiveByRole: vi.fn().mockResolvedValue([{ id: 'u1', email: 'hr@x.com' }]) };
    const notifier = { send: vi.fn().mockResolvedValue(undefined) };
    const render = vi.fn().mockResolvedValue({ subject: 's', text: 't', templateKey: 'k', templateVersion: null });
    const companies = {
      ofRef: vi.fn().mockResolvedValue(ofRef),
      orMain: vi.fn(async (id: string | null | undefined) => id ?? 'co-main'),
    };
    const service = new NotificationService(
      notifications as never,
      users as never,
      notifier,
      undefined,
      undefined,
      render,
      'https://hr.example',
      undefined,
      companies,
    );
    return { service, notifications, notifier, render, companies };
  }

  it("is found from the record: that company's template, log row and mail server", async () => {
    const { service, notifications, notifier, render, companies } = makeService('co-tabby');
    await service.notifyExternal('sara@x.com', 'employee.form_reminder', { name: 'Sara' }, { entity: 'EMPLOYEE', entityId: 'e1' });

    expect(companies.ofRef).toHaveBeenCalledWith({ entity: 'EMPLOYEE', entityId: 'e1' });
    expect(render).toHaveBeenCalledWith('employee.form_reminder', 'ar', expect.anything(), 'co-tabby');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co-tabby', entity: 'EMPLOYEE', entityId: 'e1' }),
    );
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'sara@x.com', companyId: 'co-tabby' }));
  });

  it('uses the company the caller already knows, without a lookup', async () => {
    const { service, render, companies } = makeService('ignored');
    await service.notifyRole('HR', 'staff.record_stalled', { name: 'Sara' }, { entity: 'GOSI', entityId: 'g1', companyId: 'co-b' });
    expect(companies.ofRef).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith('staff.record_stalled', 'ar', expect.anything(), 'co-b');
  });

  it('a message about nothing in particular belongs to the main company', async () => {
    const { service, render } = makeService(null);
    await service.notifyExternal('new.staff@x.com', 'staff.invitation', { name: 'New' });
    expect(render).toHaveBeenCalledWith('staff.invitation', 'ar', expect.anything(), 'co-main');
  });
});

describe('SettingsService — mail settings per company', () => {
  function prismaWith(rows: Record<string, Record<string, unknown>>) {
    return {
      setting: {
        findUnique: vi.fn(async ({ where }: { where: { companyId_key: { companyId: string; key: string } } }) => {
          const { companyId, key } = where.companyId_key;
          const value = rows[`${companyId}:${key}`];
          return value ? { value: JSON.stringify(value) } : null;
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
  }
  const main = { mainCompanyId: vi.fn().mockResolvedValue('co-main') };

  it("a company with its own settings uses them", async () => {
    const prisma = prismaWith({
      'co-main:mail': { provider: 'microsoft', host: 'smtp.office365.com', user: 'hr@riyada.com' },
      'co-tabby:mail': { provider: 'gmail', host: 'smtp.gmail.com', user: 'hr@tabby.com' },
    });
    const svc = new SettingsService(prisma as never, main);
    const masked = await svc.getMailSettingsMasked('co-tabby');
    expect(masked).toMatchObject({ user: 'hr@tabby.com', source: 'company' });
  });

  it("a company without settings sends through the main company's mailbox", async () => {
    const prisma = prismaWith({ 'co-main:mail': { provider: 'microsoft', host: 'smtp.office365.com', user: 'hr@riyada.com' } });
    const svc = new SettingsService(prisma as never, main);
    expect(await svc.getMailSettingsMasked('co-tabby')).toMatchObject({ user: 'hr@riyada.com', source: 'main' });
  });

  it('saving writes the row of the selected company only', async () => {
    const prisma = prismaWith({});
    const svc = new SettingsService(prisma as never, main);
    await svc.updateMailSettings('co-tabby', { provider: 'console' });
    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId_key: { companyId: 'co-tabby', key: 'mail' } } }),
    );
  });

  it('weekend days are per company, Fri + Sat by default', async () => {
    const prisma = prismaWith({ 'co-tabby:calendar': { weekendDays: [6, 0] } });
    const svc = new SettingsService(prisma as never, main);
    expect((await svc.getCalendar('co-tabby')).weekendDays).toEqual([6, 0]);
    expect((await svc.getCalendar('co-main')).weekendDays).toEqual([5, 6]);
  });
});

describe('CompanyDefaults', () => {
  it('a new company gets the default rules and two years of holidays', async () => {
    const rules = { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) };
    const holidays = { list: vi.fn().mockResolvedValue([]), add: vi.fn().mockResolvedValue({}) };
    await new CompanyDefaults(rules as never, holidays as never).onCreated('co-new', new Date('2026-10-14T00:00:00Z'));

    expect(rules.create).toHaveBeenCalledTimes(DEFAULT_SLA_RULES.length);
    expect(rules.create).toHaveBeenCalledWith('co-new', expect.objectContaining({ processKey: expect.any(String), notifyRole: expect.any(String) }));
    expect(holidays.add).toHaveBeenCalled();
    const years = new Set(holidays.add.mock.calls.map((c) => (c[1] as Date).getUTCFullYear()));
    expect([...years].sort()).toEqual([2026, 2027]);
  });

  it('never adds rules to a company that already has some', async () => {
    const rules = { count: vi.fn().mockResolvedValue(3), create: vi.fn() };
    const holidays = { list: vi.fn().mockResolvedValue([]), add: vi.fn() };
    await new CompanyDefaults(rules as never, holidays as never).ensureAll(['co-a']);
    expect(rules.create).not.toHaveBeenCalled();
  });
});
