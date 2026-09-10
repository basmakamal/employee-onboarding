/**
 * OnboardingService — the pipeline on the unified employee record.
 * The contract lives on an external platform: HR records its status by
 * hand, and recording ACTIVE converts the trainee (number allocated,
 * Stage-2 tracks opened, activation audited). Withdrawal stops open work.
 * Signed links expose only public fields.
 */
import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from '../src/modules/employees/onboarding.service.js';
import type { Workflow } from '../src/workflow/engine.js';
import type { Employee } from '../src/generated/prisma/client.js';
import { GuardFailedError } from '../src/workflow/errors.js';

const HR = { type: 'USER' as const, id: 'hr1', role: 'HR' };

const PIPELINE_EMPLOYEE = {
  id: 'e1',
  firstName: 'Nora',
  lastName: 'Khalid',
  email: 'nora@example.com',
  phone: null,
  nationalId: null,
  birthDate: null,
  department: 'IT',
  jobTitle: 'Engineer',
  status: 'AWAITING_CONTRACT_APPROVAL',
} as unknown as Employee;

function makeService(overrides: { employee?: Partial<Employee>; contract?: unknown } = {}) {
  const employee = { ...PIPELINE_EMPLOYEE, ...overrides.employee };
  const contract =
    'contract' in overrides
      ? overrides.contract
      : { id: 'c1', status: 'PENDING_APPROVAL', details: { salary: 1 }, sentAt: new Date() };
  const repos = {
    employees: {
      findById: vi.fn().mockResolvedValue(employee),
      createOnboarding: vi.fn(),
      updatePersonal: vi.fn().mockResolvedValue({}),
      allocateEmployeeNo: vi.fn().mockResolvedValue('EMP-0042'),
      completeActivation: vi.fn().mockResolvedValue({}),
    },
    documents: {
      listByEmployee: vi.fn().mockResolvedValue([
        { id: 'd1', type: 'NATIONAL_ID', label: null, required: true, storageKey: null },
        { id: 'd2', type: 'IBAN_LETTER', label: null, required: true, storageKey: null },
      ]),
      attachUpload: vi.fn().mockResolvedValue({}),
    },
    contracts: {
      findByEmployee: vi.fn().mockResolvedValue(contract),
      setStatus: vi.fn().mockResolvedValue({}),
      setStatusByEmployee: vi.fn().mockResolvedValue({ count: 1 }),
      updateDetails: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      setStorageKey: vi.fn().mockResolvedValue({ id: 'c1', storageKey: 'new' }),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
  };
  const workflow = {
    transition: vi
      .fn()
      .mockImplementation((_e: Employee, action: string) =>
        Promise.resolve({ from: employee.status, to: 'ACTIVE', action }),
      ),
    availableActions: vi.fn().mockReturnValue([]),
  } as unknown as Workflow<Employee>;
  const links = {
    verify: vi.fn().mockResolvedValue({ id: 'tok1', purpose: 'DATA_FORM', employee }),
    issue: vi.fn().mockResolvedValue({ url: 'http://x/l', expiresAt: new Date() }),
    markUsed: vi.fn().mockResolvedValue({}),
  };
  const notifications = {
    notifyExternal: vi.fn().mockResolvedValue(undefined),
    notifyHr: vi.fn().mockResolvedValue(undefined),
  };
  const halter = { halt: vi.fn().mockResolvedValue({ links: 1, assetForms: 1, processes: [] }) };
  // Unit of work under test = the same fakes; the consumed link's stamp
  // delegates to the fake links service so assertions stay in one place.
  const scope = { ...repos, workflow, markLinkUsed: links.markUsed };
  const transact = (fn: (s: typeof scope) => Promise<unknown>) => fn(scope);
  const service = new OnboardingService(
    repos as never,
    workflow,
    links as never,
    notifications as never,
    transact as never,
    halter as never,
  );
  return { service, repos, workflow, links, notifications, halter };
}

describe('OnboardingService.setContractStatus', () => {
  it('ACTIVE converts the trainee: number allocated, contract active, activation audited', async () => {
    const { service, repos, workflow, links, notifications } = makeService();

    const result = await service.setContractStatus('e1', 'ACTIVE', HR);

    expect(result).toMatchObject({ to: 'ACTIVE', contractStatus: 'ACTIVE', employeeNo: 'EMP-0042' });
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      'APPROVE_CONTRACT',
      HR,
    );
    expect(repos.contracts.setStatus).toHaveBeenCalledWith('c1', 'ACTIVE', {
      approvedAt: expect.any(Date),
      rejectReason: null,
    });
    expect(repos.employees.completeActivation).toHaveBeenCalledWith(
      'e1',
      'EMP-0042',
      expect.any(Date),
    );
    expect(repos.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'EMPLOYEE',
        action: 'ACTIVATED',
        actorId: 'hr1',
        employeeId: 'e1',
        metadata: { employeeNo: 'EMP-0042', from: 'contract-active' },
      }),
    );
    // No e-approval link exists any more: nothing is issued or emailed.
    expect(links.issue).not.toHaveBeenCalled();
    expect(notifications.notifyExternal).not.toHaveBeenCalled();
  });

  it('PENDING_APPROVAL records the submission and stamps sentAt', async () => {
    const { service, repos, workflow } = makeService({
      employee: { status: 'CONTRACT_CREATION' } as Partial<Employee>,
    });

    await service.setContractStatus('e1', 'PENDING_APPROVAL', HR);

    expect(workflow.transition).toHaveBeenCalledWith(expect.anything(), 'SUBMIT_CONTRACT', HR);
    expect(repos.contracts.setStatus).toHaveBeenCalledWith('c1', 'PENDING_APPROVAL', {
      sentAt: expect.any(Date),
      rejectReason: null,
    });
    expect(repos.employees.completeActivation).not.toHaveBeenCalled();
  });

  it('REJECTED sends the record back to drafting and keeps the reason', async () => {
    const { service, repos, workflow } = makeService();

    await service.setContractStatus('e1', 'REJECTED', HR, { reason: 'salary band' });

    expect(workflow.transition).toHaveBeenCalledWith(expect.anything(), 'REJECT_CONTRACT', HR, {
      reason: 'salary band',
    });
    expect(repos.contracts.setStatus).toHaveBeenCalledWith('c1', 'REJECTED', {
      rejectReason: 'salary band',
    });
  });

  it('EXPIRED is a manual expiry by HR', async () => {
    const { service, repos, workflow } = makeService();

    await service.setContractStatus('e1', 'EXPIRED', HR);

    expect(workflow.transition).toHaveBeenCalledWith(expect.anything(), 'EXPIRE', HR, undefined);
    expect(repos.contracts.setStatus).toHaveBeenCalledWith('c1', 'EXPIRED');
  });

  it('refuses when no contract has been entered yet', async () => {
    const { service, workflow } = makeService({ contract: null });

    await expect(service.setContractStatus('e1', 'PENDING_APPROVAL', HR)).rejects.toBeInstanceOf(
      GuardFailedError,
    );
    expect(workflow.transition).not.toHaveBeenCalled();
  });
});

describe('OnboardingService.withdraw', () => {
  it('moves the trainee to WITHDRAWN, records the reason, and stops open work', async () => {
    const { service, workflow, halter } = makeService({
      employee: { status: 'AWAITING_FORM' } as Partial<Employee>,
    });

    const result = await service.withdraw('e1', HR, 'took another offer');

    expect(workflow.transition).toHaveBeenCalledWith(expect.anything(), 'WITHDRAW', HR, {
      reason: 'took another offer',
    });
    expect(halter.halt).toHaveBeenCalledWith('e1', 'WITHDRAWN', HR);
    expect(result.halted).toEqual({ links: 1, assetForms: 1, processes: [] });
  });

  it('does not sweep anything when the transition itself is refused', async () => {
    const { service, workflow, halter } = makeService({
      employee: { status: 'ACTIVE' } as Partial<Employee>,
    });
    (workflow.transition as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('illegal'));

    await expect(service.withdraw('e1', HR, 'x')).rejects.toThrow('illegal');
    expect(halter.halt).not.toHaveBeenCalled();
  });
});

describe('OnboardingService.reopen', () => {
  it('puts the contract back to pending when the record returns to approval', async () => {
    const { service, repos, workflow, links } = makeService({
      employee: { status: 'EXPIRED' } as Partial<Employee>,
    });
    (workflow.transition as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: 'EXPIRED',
      to: 'AWAITING_CONTRACT_APPROVAL',
      action: 'REOPEN',
    });

    await service.reopen('e1', HR);

    expect(repos.contracts.setStatusByEmployee).toHaveBeenCalledWith('e1', 'PENDING_APPROVAL');
    expect(links.issue).not.toHaveBeenCalled();
  });
});

describe('OnboardingService signed-link surface', () => {
  it('linkContext exposes only public fields plus the checklist', async () => {
    const { service } = makeService();

    const ctx = (await service.linkContext('raw')) as {
      employee: Record<string, unknown>;
      documents: unknown[];
    };

    expect(ctx.employee).not.toHaveProperty('id');
    expect(ctx.employee['firstName']).toBe('Nora');
    expect(ctx.documents).toEqual([
      { id: 'd1', type: 'NATIONAL_ID', label: null, required: true, uploaded: false },
      { id: 'd2', type: 'IBAN_LETTER', label: null, required: true, uploaded: false },
    ]);
  });

  it('linkContext serves the contract page: terms on file, document behind the same token', async () => {
    const { service, links, repos } = makeService({
      contract: {
        id: 'c1',
        status: 'PENDING_APPROVAL',
        externalRef: 'C-2026-114',
        storageKey: 'contracts/c1.pdf',
        details: { salary: '9000', durationMonths: '12', startDate: '2026-10-01', terms: 'Full time' },
      },
    });
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'CONTRACT_APPROVAL',
      employee: PIPELINE_EMPLOYEE,
    });

    const ctx = (await service.linkContext('raw')) as {
      purpose: string;
      contract: Record<string, unknown>;
    };
    expect(ctx.purpose).toBe('CONTRACT_APPROVAL');
    expect(ctx.contract).toMatchObject({
      salary: '9000',
      durationMonths: '12',
      startDate: '2026-10-01',
      externalRef: 'C-2026-114',
      hasDocument: true,
    });
    expect(repos.contracts.findByEmployee).toHaveBeenCalledWith('e1');
  });

  it('the contract link resolves the document, and refuses a link of another purpose', async () => {
    const { service, links } = makeService({
      contract: { id: 'c1', status: 'PENDING_APPROVAL', storageKey: 'contracts/c1.pdf', details: {} },
    });
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'CONTRACT_APPROVAL',
      employee: PIPELINE_EMPLOYEE,
    });
    await expect(service.contractFileKeyByToken('raw')).resolves.toBe('contracts/c1.pdf');

    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok2',
      purpose: 'DATA_FORM',
      employee: PIPELINE_EMPLOYEE,
    });
    await expect(service.contractFileKeyByToken('raw')).rejects.toThrow(/not found/);
  });

  it('submitForm attaches known uploads, skips unknown field names', async () => {
    const { service, repos, links, workflow } = makeService();

    await service.submitForm(
      'raw',
      { phone: '0500000000' },
      [
        { documentId: 'd1', storageKey: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
        { documentId: 'd2', storageKey: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
        { documentId: 'ghost', storageKey: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      ],
    );

    expect(repos.documents.attachUpload).toHaveBeenCalledTimes(2);
    expect(repos.employees.updatePersonal).toHaveBeenCalledWith('e1', { phone: '0500000000' });
    expect(workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      'SUBMIT_FORM',
      { type: 'LINK', id: 'tok1' },
    );
    expect(links.markUsed).toHaveBeenCalled();
  });

  it('submitForm refuses to advance the record without both attachments', async () => {
    const { service, repos, links, workflow } = makeService();

    // Only the ID copy — the IBAN letter is missing.
    await expect(
      service.submitForm('raw', { phone: '0500000000' }, [
        { documentId: 'd1', storageKey: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      ]),
    ).rejects.toThrow(/IBAN_LETTER/);

    // The record must not move on, and the link must stay usable so the
    // employee can come back and finish.
    expect(workflow.transition).not.toHaveBeenCalled();
    expect(links.markUsed).not.toHaveBeenCalled();
    expect(repos.employees.updatePersonal).not.toHaveBeenCalled();
  });

  it('submitForm accepts a resubmission that only fixes a text field', async () => {
    const { service, repos, workflow } = makeService();
    // Both files already on record from an earlier attempt.
    (repos.documents.listByEmployee as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'd1', type: 'NATIONAL_ID', label: null, required: true, storageKey: 'a.pdf' },
      { id: 'd2', type: 'IBAN_LETTER', label: null, required: true, storageKey: 'b.pdf' },
    ]);

    await service.submitForm('raw', { phone: '0501111111' }, []);

    expect(repos.documents.attachUpload).not.toHaveBeenCalled();
    expect(workflow.transition).toHaveBeenCalled();
  });
});

describe('OnboardingService.setContractFile', () => {
  it('attaches the document to an existing contract and hands back the old file key', async () => {
    const { service, repos } = makeService({
      employee: { status: 'CONTRACT_CREATION' },
      contract: { id: 'c1', status: 'DRAFT', storageKey: 'old/key.pdf' },
    });
    const result = await service.setContractFile('e1', 'new/key.pdf', HR);
    expect(repos.contracts.setStorageKey).toHaveBeenCalledWith('c1', 'new/key.pdf');
    expect(result.previousKey).toBe('old/key.pdf');
  });

  it('creates the contract from the document alone — typed terms are optional', async () => {
    const { service, repos } = makeService({ employee: { status: 'CONTRACT_CREATION' }, contract: null });
    const result = await service.setContractFile('e1', 'scan.jpg', HR);
    expect(repos.contracts.create).toHaveBeenCalledWith({
      employeeId: 'e1',
      createdById: 'hr1',
      details: {},
      storageKey: 'scan.jpg',
    });
    expect(result.previousKey).toBeNull();
  });

  it('refuses outside contract creation, like editing the terms', async () => {
    const { service } = makeService({ employee: { status: 'AWAITING_CONTRACT_APPROVAL' } });
    await expect(service.setContractFile('e1', 'scan.jpg', HR)).rejects.toBeInstanceOf(GuardFailedError);
  });
});
