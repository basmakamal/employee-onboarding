/**
 * The lifecycle rules agreed with HR:
 *   - the contract is approved outside the system, so HR records its status;
 *     ACTIVE is the conversion, REJECTED goes back to drafting, EXPIRED can
 *     be set by hand as well as by the SLA engine;
 *   - a trainee can withdraw at any pre-activation stage;
 *   - withdrawal / offboarding stop every open action but delete nothing;
 *   - Stage-2 cards can be completed by any authorised teammate.
 */
import { describe, expect, it, vi } from 'vitest';
import { Workflow, type EngineDeps } from '../src/workflow/engine.js';
import { IllegalTransitionError } from '../src/workflow/errors.js';
import {
  onboardingMachine,
  WITHDRAWABLE_STATUSES,
  type OnboardingGates,
} from '../src/workflow/machines/onboarding.machine.js';
import {
  criminalRecordMachine,
  employeeProcessMachine,
} from '../src/workflow/machines/employee-process.machine.js';
import { OpenWorkHalter } from '../src/workflow/halt-open-work.js';
import type { Employee } from '../src/generated/prisma/client.js';

const HR = { type: 'USER' as const, id: 'hr1', role: 'HR' };
const INSURANCE = { type: 'USER' as const, id: 'ins1', role: 'INSURANCE' };
const IT = { type: 'USER' as const, id: 'it1', role: 'IT' };
const LINK = { type: 'LINK' as const, id: 'tok1' };
const SYSTEM = { type: 'SYSTEM' as const };

function deps<T extends { id: string; status: string }>(): EngineDeps<T> {
  return {
    getId: (r) => r.id,
    getStatus: (r) => r.status,
    move: vi.fn().mockResolvedValue(true),
    audit: vi.fn().mockResolvedValue({}),
  };
}
const employee = (status: string) => ({ id: 'e1', status }) as Employee;
const gates = (over: Partial<OnboardingGates> = {}): OnboardingGates => ({
  countMissingRequiredDocs: vi.fn().mockResolvedValue(0),
  hasContract: vi.fn().mockResolvedValue(true),
  contractWasSent: vi.fn().mockResolvedValue(true),
  ...over,
});

describe('contract status is recorded by HR, not clicked by the hire', () => {
  it('HR submits, approves, rejects and expires the contract', async () => {
    const wf = new Workflow(onboardingMachine(gates()), deps<Employee>());

    expect((await wf.transition(employee('CONTRACT_CREATION'), 'SUBMIT_CONTRACT', HR)).to).toBe(
      'AWAITING_CONTRACT_APPROVAL',
    );
    expect(
      (await wf.transition(employee('AWAITING_CONTRACT_APPROVAL'), 'APPROVE_CONTRACT', HR)).to,
    ).toBe('ACTIVE');
    expect(
      (await wf.transition(employee('AWAITING_CONTRACT_APPROVAL'), 'REJECT_CONTRACT', HR)).to,
    ).toBe('CONTRACT_CREATION');
    expect((await wf.transition(employee('AWAITING_CONTRACT_APPROVAL'), 'EXPIRE', HR)).to).toBe(
      'EXPIRED',
    );
  });

  it('the signed link can no longer approve a contract', async () => {
    const wf = new Workflow(onboardingMachine(gates()), deps<Employee>());
    await expect(
      wf.transition(employee('AWAITING_CONTRACT_APPROVAL'), 'APPROVE_CONTRACT', LINK),
    ).rejects.toThrow(/LINK/);
  });

  it('a rejected contract can be resubmitted after fixing', async () => {
    const wf = new Workflow(onboardingMachine(gates()), deps<Employee>());
    expect((await wf.transition(employee('CONTRACT_CREATION'), 'SUBMIT_CONTRACT', HR)).to).toBe(
      'AWAITING_CONTRACT_APPROVAL',
    );
  });

  it('only HR may expire a contract by hand; the form stage still expires by SLA only', async () => {
    const wf = new Workflow(onboardingMachine(gates()), deps<Employee>());
    await expect(
      wf.transition(employee('AWAITING_CONTRACT_APPROVAL'), 'EXPIRE', IT),
    ).rejects.toThrow(/role IT/);
    expect((await wf.transition(employee('AWAITING_CONTRACT_APPROVAL'), 'EXPIRE', SYSTEM)).to).toBe(
      'EXPIRED',
    );
    await expect(wf.transition(employee('AWAITING_FORM'), 'EXPIRE', HR)).rejects.toThrow(/USER/);
  });
});

describe('withdrawal', () => {
  it('is possible from every pre-activation stage and is terminal', async () => {
    const wf = new Workflow(onboardingMachine(gates()), deps<Employee>());
    for (const status of WITHDRAWABLE_STATUSES) {
      expect((await wf.transition(employee(status), 'WITHDRAW', HR)).to).toBe('WITHDRAWN');
    }
    expect(wf.availableActions('WITHDRAWN', HR)).toEqual([]);
  });

  it('is not the exit for active staff — that is offboarding', async () => {
    const wf = new Workflow(onboardingMachine(gates()), deps<Employee>());
    await expect(wf.transition(employee('ACTIVE'), 'WITHDRAW', HR)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });
});

describe('OpenWorkHalter — stop everything open, delete nothing', () => {
  function setup() {
    const scope = {
      linkTokens: { invalidateAllForEmployee: vi.fn().mockResolvedValue(2) },
      assetForms: {
        listOpenByEmployee: vi
          .fn()
          .mockResolvedValue([{ id: 'f1', status: 'SENT' }, { id: 'f2', status: 'DRAFT' }]),
        moveStatus: vi.fn().mockResolvedValue(true),
      },
      gosi: {
        findByEmployee: vi.fn().mockResolvedValue({ id: 'g1', status: 'ON_HOLD' }),
        moveStatus: vi.fn().mockResolvedValue(true),
      },
      medical: {
        findByEmployee: vi.fn().mockResolvedValue({ id: 'm1', status: 'DONE' }),
        moveStatus: vi.fn().mockResolvedValue(true),
      },
      audit: { append: vi.fn().mockResolvedValue({}) },
    };
    const halter = new OpenWorkHalter((fn) => fn(scope as never));
    return { halter, scope };
  }

  it('kills live links, cancels undecided custody forms and open cards, audits each', async () => {
    const { halter, scope } = setup();

    const result = await halter.halt('e1', 'WITHDRAWN', HR);

    expect(result).toEqual({ links: 2, assetForms: 2, processes: ['GOSI'] });
    expect(scope.linkTokens.invalidateAllForEmployee).toHaveBeenCalledWith('e1', expect.any(Date));
    expect(scope.assetForms.moveStatus).toHaveBeenCalledWith('f1', 'SENT', 'CANCELLED');
    expect(scope.assetForms.moveStatus).toHaveBeenCalledWith('f2', 'DRAFT', 'CANCELLED');
    expect(scope.gosi.moveStatus).toHaveBeenCalledWith('g1', 'ON_HOLD', 'CANCELLED');
    // A finished card is history — it stays DONE.
    expect(scope.medical.moveStatus).not.toHaveBeenCalled();
    // Three cancellations, three audit rows, all carrying the cause.
    expect(scope.audit.append).toHaveBeenCalledTimes(3);
    expect(scope.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'GOSI',
        action: 'CANCEL',
        actorId: 'hr1',
        metadata: { cause: 'WITHDRAWN' },
      }),
    );
  });

  it('does nothing noisy on a file with nothing open', async () => {
    const { halter, scope } = setup();
    scope.linkTokens.invalidateAllForEmployee.mockResolvedValue(0);
    scope.assetForms.listOpenByEmployee.mockResolvedValue([]);
    scope.gosi.findByEmployee.mockResolvedValue(null);

    expect(await halter.halt('e1', 'OFFBOARDING', HR)).toEqual({
      links: 0,
      assetForms: 0,
      processes: [],
    });
    expect(scope.audit.append).not.toHaveBeenCalled();
  });
});

describe('Stage-2 cards: any authorised teammate may act', () => {
  it('HR and Insurance can both work GOSI/medical cards; IT cannot', async () => {
    const wf = new Workflow(employeeProcessMachine('MEDICAL_INSURANCE'), deps());
    const rec = (status: string) => ({ id: 'p1', employeeId: 'e1', status });

    expect((await wf.transition(rec('PENDING'), 'COMPLETE', HR)).to).toBe('DONE');
    expect((await wf.transition(rec('PENDING'), 'COMPLETE', INSURANCE)).to).toBe('DONE');
    await expect(wf.transition(rec('PENDING'), 'COMPLETE', IT)).rejects.toThrow(/role IT/);
  });

  it('the criminal-record card is open to Insurance as well as HR', async () => {
    const wf = new Workflow(criminalRecordMachine(), deps());
    const rec = (status: string) => ({ id: 'c1', employeeId: 'e1', status });
    expect((await wf.transition(rec('TRAINING'), 'SEND_REQUEST', INSURANCE)).to).toBe(
      'REQUEST_SENT',
    );
  });
});
