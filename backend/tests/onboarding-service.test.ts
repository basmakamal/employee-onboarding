/**
 * OnboardingService — the pipeline on the unified employee record.
 * Contract e-approval must activate: number allocated, Stage-2 tracks
 * opened, activation audited. Signed links expose only public fields.
 */
import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from '../src/modules/employees/onboarding.service.js';
import type { Workflow } from '../src/workflow/engine.js';
import type { Employee } from '../src/generated/prisma/client.js';

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

function makeService(overrides: { employee?: Partial<Employee> } = {}) {
  const employee = { ...PIPELINE_EMPLOYEE, ...overrides.employee };
  const repos = {
    employees: {
      findById: vi.fn().mockResolvedValue(employee),
      createOnboarding: vi.fn(),
      updatePersonal: vi.fn().mockResolvedValue({}),
      nextEmployeeNo: vi.fn().mockResolvedValue('EMP-0042'),
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
      findByEmployee: vi.fn().mockResolvedValue({ id: 'c1', details: { salary: 1 }, sentAt: new Date() }),
      markApproved: vi.fn().mockResolvedValue(true),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
  };
  const workflow = {
    transition: vi.fn().mockResolvedValue({
      from: 'AWAITING_CONTRACT_APPROVAL',
      to: 'ACTIVE',
      action: 'APPROVE_CONTRACT',
    }),
    availableActions: vi.fn().mockReturnValue([]),
  } as unknown as Workflow<Employee>;
  const links = {
    verify: vi.fn().mockResolvedValue({
      id: 'tok1',
      purpose: 'CONTRACT_APPROVAL',
      employee,
    }),
    issue: vi.fn().mockResolvedValue({ url: 'http://x/l', expiresAt: new Date() }),
    markUsed: vi.fn().mockResolvedValue({}),
  };
  const notifications = {
    notifyExternal: vi.fn().mockResolvedValue(undefined),
    notifyHr: vi.fn().mockResolvedValue(undefined),
  };
  const service = new OnboardingService(
    repos as never,
    workflow,
    links as never,
    notifications as never,
  );
  return { service, repos, workflow, links, notifications };
}

describe('OnboardingService.approveContract (activation)', () => {
  it('activates: number allocated, tracks opened, activation audited', async () => {
    const { service, repos, links, notifications } = makeService();

    const result = await service.approveContract('raw-token');

    expect(result).toMatchObject({ to: 'ACTIVE', employeeId: 'e1', employeeNo: 'EMP-0042' });
    expect(repos.employees.completeActivation).toHaveBeenCalledWith(
      'e1',
      'EMP-0042',
      expect.any(Date),
    );
    expect(repos.contracts.markApproved).toHaveBeenCalledWith('c1', expect.any(Date));
    expect(repos.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'EMPLOYEE',
        action: 'ACTIVATED',
        employeeId: 'e1',
        metadata: { employeeNo: 'EMP-0042', from: 'contract-approval' },
      }),
    );
    expect(links.markUsed).toHaveBeenCalledWith('tok1', expect.any(Date));
    expect(notifications.notifyHr).toHaveBeenCalledWith(
      'hr.contract_approved',
      { name: 'Nora Khalid' },
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
  });

  it('rejects a token of the wrong purpose', async () => {
    const { service, links, repos } = makeService();
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'DATA_FORM',
      employee: PIPELINE_EMPLOYEE,
    });

    await expect(service.approveContract('raw')).rejects.toThrow(/not found/);
    expect(repos.employees.completeActivation).not.toHaveBeenCalled();
  });
});

describe('OnboardingService signed-link surface', () => {
  it('linkContext exposes only public fields plus the checklist', async () => {
    const { service, links } = makeService();
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'DATA_FORM',
      employee: PIPELINE_EMPLOYEE,
    });

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

  it('submitForm attaches known uploads, skips unknown field names', async () => {
    const { service, repos, links, workflow } = makeService();
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'DATA_FORM',
      employee: PIPELINE_EMPLOYEE,
    });

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
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'DATA_FORM',
      employee: PIPELINE_EMPLOYEE,
    });

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
    const { service, repos, links, workflow } = makeService();
    (links.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'tok1',
      purpose: 'DATA_FORM',
      employee: PIPELINE_EMPLOYEE,
    });
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
