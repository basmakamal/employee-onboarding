/**
 * EmployeeService — Stage 2 process cards against fake repos: hold reasons
 * travel with the move, criminal stays forward-only, audit is anchored.
 */
import { describe, expect, it, vi } from 'vitest';
import { EmployeeService } from '../src/modules/employees/employee.service.js';
import { IllegalTransitionError } from '../src/workflow/errors.js';

const HR = { type: 'USER' as const, id: 'u1', role: 'HR' };
const INSURANCE = { type: 'USER' as const, id: 'u2', role: 'INSURANCE' };

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const gosiRow = { id: 'g1', employeeId: 'e1', status: 'PENDING', ...overrides };
  const repos = {
    employees: { list: vi.fn(), findWithDetails: vi.fn() },
    gosi: {
      findByEmployee: vi.fn().mockResolvedValue(gosiRow),
      moveStatus: vi.fn().mockResolvedValue(true),
    },
    medical: {
      findByEmployee: vi.fn().mockResolvedValue({ id: 'm1', employeeId: 'e1', status: 'PENDING' }),
      moveStatus: vi.fn().mockResolvedValue(true),
    },
    criminal: {
      findByEmployee: vi.fn().mockResolvedValue({ id: 'c1', employeeId: 'e1', status: 'TRAINING' }),
      moveStatus: vi.fn().mockResolvedValue(true),
    },
    audit: { append: vi.fn().mockResolvedValue({}) },
  };
  return { service: new EmployeeService(repos as never), repos };
}

describe('EmployeeService.actOnProcess', () => {
  it('HOLD carries the reason and note into the guarded move', async () => {
    const { service, repos } = makeService();

    const result = await service.actOnProcess('e1', 'gosi', 'HOLD', INSURANCE, {
      holdReason: 'GOVERNMENT_EMPLOYEE',
      holdNote: 'works at ministry',
    });

    expect(result).toEqual({ from: 'PENDING', to: 'ON_HOLD', action: 'HOLD' });
    expect(repos.gosi.moveStatus).toHaveBeenCalledWith('g1', 'PENDING', 'ON_HOLD', {
      reason: 'GOVERNMENT_EMPLOYEE',
      note: 'works at ministry',
    });
  });

  it('audits with the employee anchor and the acting user', async () => {
    const { service, repos } = makeService();
    await service.actOnProcess('e1', 'medical', 'COMPLETE', INSURANCE);

    expect(repos.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'MEDICAL_INSURANCE',
        action: 'COMPLETE',
        fromStatus: 'PENDING',
        toStatus: 'DONE',
        actorId: 'u2',
        employeeId: 'e1',
      }),
    );
  });

  it('criminal record cannot skip ahead (machine enforced)', async () => {
    const { service } = makeService();
    await expect(service.actOnProcess('e1', 'criminal', 'COMPLETE', HR)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it('criminal COMPLETE passes the certificate key to the move', async () => {
    const { service, repos } = makeService();
    repos.criminal.findByEmployee.mockResolvedValue({ id: 'c1', employeeId: 'e1', status: 'PENDING' });

    await service.actOnProcess('e1', 'criminal', 'COMPLETE', HR, {
      certificateStorageKey: 'cert-123.pdf',
    });

    expect(repos.criminal.moveStatus).toHaveBeenCalledWith('c1', 'PENDING', 'DONE', 'cert-123.pdf');
  });

  it('a DONE process accepts no further actions', async () => {
    const { service } = makeService({ status: 'DONE' });
    await expect(service.actOnProcess('e1', 'gosi', 'HOLD', INSURANCE)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });
});
