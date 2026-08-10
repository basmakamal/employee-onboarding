/**
 * AssetService — custody lifecycle with fakes: empty-form guard, first-open
 * transition, link decisions, HR notification.
 */
import { describe, expect, it, vi } from 'vitest';
import { AssetService } from '../src/modules/assets/asset.service.js';
import { GuardFailedError } from '../src/workflow/errors.js';

const IT = { type: 'USER' as const, id: 'u1', role: 'IT' };

function makeService(formOverrides: Partial<Record<string, unknown>> = {}, itemCount = 2) {
  const form = {
    id: 'f1',
    employeeId: 'e1',
    status: 'DRAFT',
    items: [],
    employee: {
      id: 'e1',
      firstName: 'Nora',
      lastName: 'Khalid',
      email: 'nora@example.com',
      employeeNo: 'EMP-0001',
      department: 'IT',
      jobTitle: 'Dev',
    },
    ...formOverrides,
  };
  const repos = {
    assets: { list: vi.fn(), create: vi.fn() },
    forms: {
      findWithItems: vi.fn().mockResolvedValue(form),
      countItems: vi.fn().mockResolvedValue(itemCount),
      moveStatus: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(form),
      replaceItems: vi.fn().mockResolvedValue(form),
    },
    employees: { findById: vi.fn().mockResolvedValue({ id: 'e1' }) },
    audit: { append: vi.fn().mockResolvedValue({}) },
  };
  const links = {
    issue: vi.fn().mockResolvedValue({ token: 't', url: 'http://x/approve-assets/t', expiresAt: new Date() }),
    verify: vi.fn().mockResolvedValue({ id: 'tok1', purpose: 'ASSET_APPROVAL', assetFormId: 'f1' }),
    markUsed: vi.fn().mockResolvedValue({}),
  };
  const notifications = {
    notifyExternal: vi.fn().mockResolvedValue(undefined),
    notifyHr: vi.fn().mockResolvedValue(undefined),
  };
  // Unit of work under test = the same fakes; the consumed link's stamp
  // delegates to the fake links service so assertions stay in one place.
  const scope = { forms: repos.forms, audit: repos.audit, markLinkUsed: links.markUsed };
  const transact = (fn: (s: typeof scope) => Promise<unknown>) => fn(scope);
  return {
    service: new AssetService(repos as never, links as never, notifications as never, transact as never),
    repos,
    links,
    notifications,
  };
}

describe('AssetService', () => {
  it('an empty draft cannot be sent (machine guard)', async () => {
    const { service } = makeService({}, 0);
    await expect(service.send('f1', IT)).rejects.toBeInstanceOf(GuardFailedError);
  });

  it('send issues the signed link and emails the employee', async () => {
    const { service, links, notifications } = makeService();

    const result = await service.send('f1', IT);

    expect(result.url).toContain('/approve-assets/');
    expect(links.issue).toHaveBeenCalledWith('ASSET_APPROVAL', {
      employeeId: 'e1',
      assetFormId: 'f1',
    });
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'nora@example.com',
      'employee.asset_approval',
      expect.objectContaining({ linkUrl: expect.stringContaining('approve-assets') }),
      { entity: 'ASSET_FORM', entityId: 'f1' },
    );
  });

  it('first open of the link moves SENT → PENDING_EMPLOYEE_APPROVAL', async () => {
    const { service, repos } = makeService({ status: 'SENT' });

    const ctx = await service.buildLinkContext({ id: 'tok1', purpose: 'ASSET_APPROVAL', assetFormId: 'f1' });

    expect(repos.forms.moveStatus).toHaveBeenCalledWith('f1', 'SENT', 'PENDING_EMPLOYEE_APPROVAL');
    expect(ctx.form.status).toBe('PENDING_EMPLOYEE_APPROVAL');
    expect(ctx.employee.employeeNo).toBe('EMP-0001');
  });

  it('REJECT records the reason, burns the token, and notifies HR', async () => {
    const { service, repos, links, notifications } = makeService({
      status: 'PENDING_EMPLOYEE_APPROVAL',
    });

    const result = await service.decide('raw', 'REJECT', 'wrong laptop model');

    expect(result.to).toBe('REJECTED');
    expect(repos.forms.moveStatus).toHaveBeenCalledWith(
      'f1',
      'REJECTED',
      'REJECTED',
      expect.objectContaining({ rejectReason: 'wrong laptop model' }),
    );
    expect(links.markUsed).toHaveBeenCalled();
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.asset_decided',
      expect.objectContaining({ name: 'Nora Khalid' }),
      { entity: 'ASSET_FORM', entityId: 'f1' },
    );
  });

  it('items can only be replaced while the form is a draft', async () => {
    const { service } = makeService({ status: 'SENT' });
    await expect(service.replaceItems('f1', [], IT)).rejects.toThrow(/draft/);
  });
});
