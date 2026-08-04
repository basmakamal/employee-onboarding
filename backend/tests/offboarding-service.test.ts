/**
 * OffboardingService — Stage 3 with fakes: resignation auto-sends the exit
 * interview, the asset gate blocks, settlement gates closure, and closing
 * flips the employee to INACTIVE.
 */
import { describe, expect, it, vi } from 'vitest';
import { OffboardingService } from '../src/modules/offboarding/offboarding.service.js';
import { GuardFailedError } from '../src/workflow/errors.js';

const HR = { type: 'USER' as const, id: 'hr1', role: 'HR' };
const FINANCE = { type: 'USER' as const, id: 'fin1', role: 'FINANCE' };

function makeService(overrides: Partial<Record<string, unknown>> = {}, unreturned = 0) {
  const off = {
    id: 'o1',
    employeeId: 'e1',
    reason: 'RESIGNATION',
    status: 'REQUESTED',
    exitInterviewCompletedAt: null,
    settlementWorkingDays: null,
    settlementLeaveDays: null,
    settlementEntitlements: null,
    ...overrides,
  };
  const employee = {
    id: 'e1',
    firstName: 'Nora',
    lastName: 'Khalid',
    email: 'nora@example.com',
    status: 'ACTIVE',
  };
  const repos = {
    offboardings: {
      findById: vi.fn().mockResolvedValue(off),
      findOpenByEmployee: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(off),
      moveStatus: vi.fn().mockResolvedValue(true),
      recordSettlement: vi.fn().mockResolvedValue(off),
      recordExitInterview: vi.fn().mockResolvedValue(off),
    },
    employees: {
      findById: vi.fn().mockResolvedValue(employee),
      moveStatus: vi.fn().mockResolvedValue(true),
    },
    assetForms: {
      countUnreturnedItems: vi.fn().mockResolvedValue(unreturned),
      listByEmployee: vi.fn().mockResolvedValue([]),
      markItemReturned: vi.fn().mockResolvedValue({ id: 'i1', type: 'LAPTOP', name: 'T14' }),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
  };
  const links = {
    issue: vi.fn().mockResolvedValue({ token: 't', url: 'http://x/exit-interview/t', expiresAt: new Date() }),
    verify: vi.fn().mockResolvedValue({ id: 'tok1', purpose: 'EXIT_INTERVIEW', offboardingId: 'o1' }),
    markUsed: vi.fn().mockResolvedValue({}),
  };
  const notifications = {
    notifyExternal: vi.fn().mockResolvedValue(undefined),
    notifyHr: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new OffboardingService(repos as never, links as never, notifications as never),
    repos,
    links,
    notifications,
  };
}

describe('OffboardingService', () => {
  it('an inactive employee or an already-open offboarding cannot start a new one', async () => {
    const inactive = makeService();
    inactive.repos.employees.findById.mockResolvedValue({ id: 'e1', status: 'INACTIVE' });
    await expect(inactive.service.create('e1', 'RESIGNATION', HR)).rejects.toBeInstanceOf(
      GuardFailedError,
    );

    const open = makeService();
    open.repos.offboardings.findOpenByEmployee.mockResolvedValue({ id: 'other' });
    await expect(open.service.create('e1', 'TERMINATION', HR)).rejects.toThrow(/already in progress/);
  });

  it('BRD: starting a RESIGNATION auto-sends the exit interview link', async () => {
    const { service, links, notifications } = makeService();
    await service.start('o1', HR);

    expect(links.issue).toHaveBeenCalledWith('EXIT_INTERVIEW', {
      employeeId: 'e1',
      offboardingId: 'o1',
    });
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'nora@example.com',
      'employee.exit_interview',
      expect.objectContaining({ linkUrl: expect.stringContaining('exit-interview') }),
      { entity: 'OFFBOARDING', entityId: 'o1' },
    );
  });

  it('a TERMINATION start sends no exit interview (BRD: resignation only)', async () => {
    const { service, links } = makeService({ reason: 'TERMINATION' });
    await service.start('o1', HR);
    expect(links.issue).not.toHaveBeenCalled();
  });

  it('BRD hard gate: unreturned assets block the notice step', async () => {
    const { service } = makeService({ status: 'ASSETS_PENDING' }, 2);
    await expect(service.confirmAssetsReturned('o1', HR)).rejects.toThrow(/2 custody item/);
  });

  it('confirming with everything returned sends the termination notice', async () => {
    const { service, notifications } = makeService({ status: 'ASSETS_PENDING' }, 0);
    const result = await service.confirmAssetsReturned('o1', HR);

    expect(result.to).toBe('NOTICE_SENT');
    expect(notifications.notifyExternal).toHaveBeenCalledWith(
      'nora@example.com',
      'employee.termination_notice',
      expect.anything(),
      { entity: 'OFFBOARDING', entityId: 'o1' },
    );
  });

  it('closure is FINANCE-only, requires settlement, and flips the employee to INACTIVE', async () => {
    const ready = {
      status: 'SETTLEMENT',
      settlementWorkingDays: 12,
      settlementLeaveDays: 4.5,
      settlementEntitlements: 15000,
    };

    // HR may not close.
    const hrTry = makeService(ready);
    await expect(hrTry.service.close('o1', HR)).rejects.toThrow(/role HR/);

    // FINANCE without settlement amounts is blocked by the machine guard.
    const noAmounts = makeService({ status: 'SETTLEMENT' });
    await expect(noAmounts.service.close('o1', FINANCE)).rejects.toThrow(/settlement amounts/);

    // FINANCE with amounts closes and the employee goes INACTIVE.
    const ok = makeService(ready);
    const result = await ok.service.close('o1', FINANCE);
    expect(result.to).toBe('CLOSED');
    expect(ok.repos.employees.moveStatus).toHaveBeenCalledWith('e1', 'ACTIVE', 'INACTIVE');
  });

  it('exit interview submission stores answers, burns the token, notifies HR', async () => {
    const { service, repos, links, notifications } = makeService({ status: 'IN_PROGRESS' });
    await service.submitExitInterview('raw', { reason: 'better offer' });

    expect(repos.offboardings.recordExitInterview).toHaveBeenCalledWith(
      'o1',
      { reason: 'better offer' },
      expect.any(Date),
    );
    expect(links.markUsed).toHaveBeenCalled();
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.exit_interview_done',
      expect.objectContaining({ name: 'Nora Khalid' }),
      { entity: 'OFFBOARDING', entityId: 'o1' },
    );
  });
});
