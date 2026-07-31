/**
 * The four BRD state machines, exercised through the engine with fake
 * gates/persistence — proving every business rule without a database.
 */
import { describe, expect, it, vi } from 'vitest';
import { Workflow, type EngineDeps } from '../src/workflow/engine.js';
import { GuardFailedError, IllegalTransitionError } from '../src/workflow/errors.js';
import { traineeMachine, type TraineeGates } from '../src/workflow/machines/trainee.machine.js';
import {
  employeeProcessMachine,
  criminalRecordMachine,
} from '../src/workflow/machines/employee-process.machine.js';
import { assetFormMachine } from '../src/workflow/machines/asset-form.machine.js';
import { offboardingMachine } from '../src/workflow/machines/offboarding.machine.js';
import type { Trainee, AssetForm, Offboarding } from '../src/generated/prisma/client.js';

function deps<T extends { id: string; status: string }>(): EngineDeps<T> {
  return {
    getId: (r) => r.id,
    getStatus: (r) => r.status,
    move: vi.fn().mockResolvedValue(true),
    audit: vi.fn().mockResolvedValue({}),
  };
}

const HR = { type: 'USER' as const, id: 'hr1', role: 'HR' };
const LINK = { type: 'LINK' as const, id: 'tok1' };
const SYSTEM = { type: 'SYSTEM' as const };

function trainee(status: string): Trainee {
  return { id: 't1', status } as Trainee;
}

function gates(overrides: Partial<TraineeGates> = {}): TraineeGates {
  return {
    countMissingRequiredDocs: vi.fn().mockResolvedValue(0),
    hasContract: vi.fn().mockResolvedValue(true),
    contractWasSent: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('trainee machine (Stage 1)', () => {
  it('walks the BRD happy path end to end', async () => {
    const wf = new Workflow(traineeMachine(gates()), deps<Trainee>());

    expect((await wf.transition(trainee('CREATED'), 'SEND_FORM', HR)).to).toBe('AWAITING_FORM');
    expect((await wf.transition(trainee('AWAITING_FORM'), 'SUBMIT_FORM', LINK)).to).toBe(
      'FORM_RECEIVED',
    );
    expect((await wf.transition(trainee('FORM_RECEIVED'), 'ACCEPT_DOCUMENTS', HR)).to).toBe(
      'CONTRACT_CREATION',
    );
    expect((await wf.transition(trainee('CONTRACT_CREATION'), 'SEND_CONTRACT', HR)).to).toBe(
      'AWAITING_CONTRACT_APPROVAL',
    );
    expect(
      (await wf.transition(trainee('AWAITING_CONTRACT_APPROVAL'), 'APPROVE_CONTRACT', LINK)).to,
    ).toBe('EMPLOYEE_CREATED');
  });

  it('BRD rule: documents incomplete blocks contract work with the count', async () => {
    const wf = new Workflow(
      traineeMachine(gates({ countMissingRequiredDocs: vi.fn().mockResolvedValue(2) })),
      deps<Trainee>(),
    );

    await expect(
      wf.transition(trainee('FORM_RECEIVED'), 'ACCEPT_DOCUMENTS', HR),
    ).rejects.toThrow('2 required document(s)');
  });

  it('BRD rule: a contract must exist before it can be sent', async () => {
    const wf = new Workflow(
      traineeMachine(gates({ hasContract: vi.fn().mockResolvedValue(false) })),
      deps<Trainee>(),
    );

    await expect(
      wf.transition(trainee('CONTRACT_CREATION'), 'SEND_CONTRACT', HR),
    ).rejects.toBeInstanceOf(GuardFailedError);
  });

  it('only the SYSTEM (SLA engine) may expire, and only waiting states', async () => {
    const wf = new Workflow(traineeMachine(gates()), deps<Trainee>());

    expect((await wf.transition(trainee('AWAITING_FORM'), 'EXPIRE', SYSTEM)).to).toBe('EXPIRED');
    await expect(wf.transition(trainee('CONTRACT_CREATION'), 'EXPIRE', SYSTEM)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it('BRD reopen resumes from the last completed stage', async () => {
    // Expired before the contract was ever sent → back to the form stage.
    const early = new Workflow(traineeMachine(gates()), deps<Trainee>());
    expect((await early.transition(trainee('EXPIRED'), 'REOPEN', HR)).to).toBe('AWAITING_FORM');

    // Expired while awaiting contract approval → back to approval.
    const late = new Workflow(
      traineeMachine(gates({ contractWasSent: vi.fn().mockResolvedValue(true) })),
      deps<Trainee>(),
    );
    expect((await late.transition(trainee('EXPIRED'), 'REOPEN', HR)).to).toBe(
      'AWAITING_CONTRACT_APPROVAL',
    );
  });

  it('the trainee link cannot perform HR actions', async () => {
    const wf = new Workflow(traineeMachine(gates()), deps<Trainee>());
    await expect(wf.transition(trainee('FORM_RECEIVED'), 'ACCEPT_DOCUMENTS', LINK)).rejects.toThrow(
      /LINK/,
    );
  });
});

describe('employee-file process machines (Stage 2)', () => {
  it('GOSI/medical: pending ↔ hold, complete from both, cancel is terminal', async () => {
    const wf = new Workflow(employeeProcessMachine('GOSI'), deps());
    const rec = (status: string) => ({ id: 'p1', employeeId: 'e1', status });

    expect((await wf.transition(rec('PENDING'), 'HOLD', HR)).to).toBe('ON_HOLD');
    expect((await wf.transition(rec('ON_HOLD'), 'RESUME', HR)).to).toBe('PENDING');
    expect((await wf.transition(rec('ON_HOLD'), 'COMPLETE', HR)).to).toBe('DONE');
    expect((await wf.transition(rec('PENDING'), 'CANCEL', HR)).to).toBe('CANCELLED');
    await expect(wf.transition(rec('DONE'), 'HOLD', HR)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it('criminal record: strictly forward, no skipping', async () => {
    const wf = new Workflow(criminalRecordMachine(), deps());
    const rec = (status: string) => ({ id: 'c1', employeeId: 'e1', status });

    expect((await wf.transition(rec('TRAINING'), 'SEND_REQUEST', HR)).to).toBe('REQUEST_SENT');
    expect((await wf.transition(rec('REQUEST_SENT'), 'MARK_PENDING', HR)).to).toBe('PENDING');
    expect((await wf.transition(rec('PENDING'), 'COMPLETE', HR)).to).toBe('DONE');
    await expect(wf.transition(rec('TRAINING'), 'COMPLETE', HR)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });
});

describe('asset form machine (Stage 2)', () => {
  const form = (status: string) => ({ id: 'f1', status }) as AssetForm;

  it('an empty form cannot be sent', async () => {
    const wf = new Workflow(
      assetFormMachine({ countItems: vi.fn().mockResolvedValue(0) }),
      deps<AssetForm>(),
    );
    await expect(wf.transition(form('DRAFT'), 'SEND', HR)).rejects.toThrow(/no asset lines/);
  });

  it('employee decisions come only through the signed link', async () => {
    const wf = new Workflow(
      assetFormMachine({ countItems: vi.fn().mockResolvedValue(2) }),
      deps<AssetForm>(),
    );

    expect((await wf.transition(form('DRAFT'), 'SEND', HR)).to).toBe('SENT');
    expect((await wf.transition(form('SENT'), 'OPEN', LINK)).to).toBe(
      'PENDING_EMPLOYEE_APPROVAL',
    );
    expect((await wf.transition(form('PENDING_EMPLOYEE_APPROVAL'), 'APPROVE', LINK)).to).toBe(
      'APPROVED',
    );
    await expect(wf.transition(form('PENDING_EMPLOYEE_APPROVAL'), 'APPROVE', HR)).rejects.toThrow(
      /USER/,
    );
  });

  it('a rejected form can be revised back to draft', async () => {
    const wf = new Workflow(
      assetFormMachine({ countItems: vi.fn().mockResolvedValue(1) }),
      deps<AssetForm>(),
    );
    expect((await wf.transition(form('REJECTED'), 'REVISE', HR)).to).toBe('DRAFT');
  });
});

describe('offboarding machine (Stage 3)', () => {
  const off = (status: string, extra: Partial<Offboarding> = {}) =>
    ({
      id: 'o1',
      employeeId: 'e1',
      status,
      settlementWorkingDays: null,
      settlementLeaveDays: null,
      settlementEntitlements: null,
      ...extra,
    }) as Offboarding;

  it('BRD hard gate: unreturned assets block the termination notice', async () => {
    const wf = new Workflow(
      offboardingMachine({ countUnreturnedAssets: vi.fn().mockResolvedValue(3) }),
      deps<Offboarding>(),
    );

    await expect(
      wf.transition(off('ASSETS_PENDING'), 'CONFIRM_ASSETS_RETURNED', HR),
    ).rejects.toThrow('3 custody item(s)');
  });

  it('passes the gate when everything is back, and closes only with settlement entered', async () => {
    const wf = new Workflow(
      offboardingMachine({ countUnreturnedAssets: vi.fn().mockResolvedValue(0) }),
      deps<Offboarding>(),
    );

    expect((await wf.transition(off('ASSETS_PENDING'), 'CONFIRM_ASSETS_RETURNED', HR)).to).toBe(
      'NOTICE_SENT',
    );

    await expect(wf.transition(off('SETTLEMENT'), 'CLOSE', HR)).rejects.toThrow(
      /settlement amounts/,
    );

    const complete = off('SETTLEMENT', {
      settlementWorkingDays: 12,
      settlementLeaveDays: 4.5 as never,
      settlementEntitlements: 15000 as never,
    });
    expect((await wf.transition(complete, 'CLOSE', HR)).to).toBe('CLOSED');
  });

  it('cancellation is impossible once the notice is out', async () => {
    const wf = new Workflow(
      offboardingMachine({ countUnreturnedAssets: vi.fn().mockResolvedValue(0) }),
      deps<Offboarding>(),
    );
    expect((await wf.transition(off('IN_PROGRESS'), 'CANCEL', HR)).to).toBe('CANCELLED');
    await expect(wf.transition(off('NOTICE_SENT'), 'CANCEL', HR)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });
});
