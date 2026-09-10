/**
 * The new hire's own decision from the contract link. Accepting must land in
 * exactly the state HR's manual approval produces (number allocated, tracks
 * opened); rejecting must return the record to drafting with the reason.
 * Either way the link is spent, so a decision cannot be replayed.
 */
import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from '../src/modules/employees/onboarding.service.js';
import type { Workflow } from '../src/workflow/engine.js';
import type { Employee } from '../src/generated/prisma/client.js';

const EMPLOYEE = {
  id: 'e1',
  firstName: 'Nora',
  lastName: 'Khalid',
  email: 'nora@example.com',
  status: 'AWAITING_CONTRACT_APPROVAL',
} as unknown as Employee;

function makeService() {
  const repos = {
    employees: {
      findById: vi.fn().mockResolvedValue(EMPLOYEE),
      allocateEmployeeNo: vi.fn().mockResolvedValue('EMP-0042'),
      completeActivation: vi.fn().mockResolvedValue({}),
    },
    contracts: {
      findByEmployee: vi.fn().mockResolvedValue({ id: 'c1', status: 'PENDING_APPROVAL' }),
      setStatus: vi.fn().mockResolvedValue({}),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
  };
  const workflow = {
    transition: vi.fn().mockImplementation((_e: Employee, action: string) =>
      Promise.resolve({
        from: 'AWAITING_CONTRACT_APPROVAL',
        to: action === 'APPROVE_CONTRACT' ? 'ACTIVE' : 'CONTRACT_CREATION',
        action,
      }),
    ),
  } as unknown as Workflow<Employee>;
  const links = {
    verify: vi.fn().mockResolvedValue({ id: 'tok1', purpose: 'CONTRACT_APPROVAL', employee: EMPLOYEE }),
    markUsed: vi.fn().mockResolvedValue({}),
  };
  const notifications = { notifyHr: vi.fn().mockResolvedValue(undefined) };
  const scope = { ...repos, workflow, markLinkUsed: links.markUsed };
  const transact = (fn: (s: typeof scope) => Promise<unknown>) => fn(scope);
  const service = new OnboardingService(
    repos as never,
    workflow,
    links as never,
    notifications as never,
    transact as never,
    { halt: vi.fn() } as never,
  );
  return { service, repos, workflow, links, notifications };
}

describe('OnboardingService.decideContract', () => {
  it('accepting converts the trainee exactly as an HR approval does', async () => {
    const { service, repos, workflow, links, notifications } = makeService();

    const out = await service.decideContract('raw', 'APPROVE');

    expect(workflow.transition).toHaveBeenCalledWith(
      EMPLOYEE,
      'APPROVE_CONTRACT',
      expect.objectContaining({ type: 'LINK', id: 'tok1' }),
    );
    expect(repos.contracts.setStatus).toHaveBeenCalledWith(
      'c1',
      'ACTIVE',
      expect.objectContaining({ rejectReason: null }),
    );
    expect(repos.employees.completeActivation).toHaveBeenCalledWith('e1', 'EMP-0042', expect.any(Date));
    expect(links.markUsed).toHaveBeenCalledWith('tok1');
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.contract_approved',
      expect.objectContaining({ name: 'Nora Khalid', employeeNo: 'EMP-0042' }),
      expect.anything(),
    );
    expect(out).toEqual({ decision: 'APPROVE', employeeNo: 'EMP-0042' });
  });

  it('rejecting sends the record back to drafting with the reason, and tells HR why', async () => {
    const { service, repos, workflow, notifications } = makeService();

    const out = await service.decideContract('raw', 'REJECT', 'Salary does not match');

    expect(workflow.transition).toHaveBeenCalledWith(
      EMPLOYEE,
      'REJECT_CONTRACT',
      expect.objectContaining({ type: 'LINK' }),
      { reason: 'Salary does not match' },
    );
    expect(repos.employees.completeActivation).not.toHaveBeenCalled();
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.contract_rejected',
      expect.objectContaining({ rejectReason: 'Salary does not match' }),
      expect.anything(),
    );
    expect(out).toEqual({ decision: 'REJECT', employeeNo: null });
  });

  it('refuses a link issued for anything else', async () => {
    const { service, links } = makeService();
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok2',
      purpose: 'DATA_FORM',
      employee: EMPLOYEE,
    });
    await expect(service.decideContract('raw', 'APPROVE')).rejects.toThrow(/not found/);
  });
});

describe('the audit row for a link decision', () => {
  it('records the actor type but never a user id — a token id is not a user', async () => {
    const { service, repos } = makeService();

    await service.decideContract('raw', 'APPROVE');

    const entry = (repos.audit.append as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ action: 'ACTIVATED', actorType: 'LINK' });
    // Writing the token id here violates the audit_logs → users foreign key,
    // which is what made accepting a contract fail with a 500.
    expect(entry).not.toHaveProperty('actorId');
  });
});
