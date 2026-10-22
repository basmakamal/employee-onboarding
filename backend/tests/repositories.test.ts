/**
 * Repository unit tests with a fake Db — no database needed.
 * Repositories are constructor-injected, so anything that quacks like the
 * Prisma client works. Same seam the services will use in Phase C tests.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/common/prisma.js';
import { EmployeeRepository } from '../src/modules/employees/employee.repository.js';
import { OnboardingDocumentRepository } from '../src/modules/employees/onboarding-document.repository.js';
import { AssetFormRepository } from '../src/modules/assets/asset-form.repository.js';
import { AuditLogRepository } from '../src/workflow/audit-log.repository.js';

describe('EmployeeRepository.moveStatus', () => {
  it('transitions only from the expected status and resets the SLA anchor', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = new EmployeeRepository({ employee: { updateMany } } as unknown as Db);

    const moved = await repo.moveStatus('e1', 'AWAITING_FORM', 'FORM_RECEIVED');

    expect(moved).toBe(true);
    const args = updateMany.mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'e1', status: 'AWAITING_FORM' });
    expect(args.data.status).toBe('FORM_RECEIVED');
    expect(args.data.statusChangedAt).toBeInstanceOf(Date); // SLA anchor reset
  });

  it('returns false for a stale transition (record moved on already)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = new EmployeeRepository({ employee: { updateMany } } as unknown as Db);

    expect(await repo.moveStatus('e1', 'CREATED', 'AWAITING_FORM')).toBe(false);
  });

  it('allocates the next number by atomically incrementing the sequence row', async () => {
    const upsert = vi.fn().mockResolvedValue({ key: 'EMPLOYEE_NO', value: 8 });
    const repo = new EmployeeRepository({ sequence: { upsert } } as unknown as Db);

    expect(await repo.allocateEmployeeNo()).toBe('EMP-0008');
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'EMPLOYEE_NO' },
      update: { value: { increment: 1 } },
      create: { key: 'EMPLOYEE_NO', value: 1 },
    });
  });
});

describe('EmployeeRepository.listPaged', () => {
  it('search, filter, sort and slice all travel into the query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repo = new EmployeeRepository({ employee: { findMany, count } } as unknown as Db);

    await repo.listPaged({
      q: 'nora',
      filter: 'onboarding',
      basis: 'hireDate',
      page: 3,
      limit: 25,
      sortBy: 'employeeNo',
      sortDir: 'asc',
    });

    const args = findMany.mock.calls[0]![0];
    expect(args.skip).toBe(50); // page 3 × 25
    expect(args.take).toBe(25);
    expect(args.orderBy).toEqual({ employeeNo: 'asc' });
    expect(args.where.status.in).toContain('AWAITING_FORM'); // onboarding group
    expect(args.where.OR).toEqual(
      expect.arrayContaining([{ firstName: { contains: 'nora' } }]),
    );
    // count() must see the SAME filter, or totals drift from the rows.
    expect(count.mock.calls[0]![0].where).toEqual(args.where);
  });

  it('an exact status wins over the group filter; date range excludes null', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repo = new EmployeeRepository({ employee: { findMany, count } } as unknown as Db);

    await repo.listPaged({
      filter: 'all',
      status: 'AWAITING_FORM',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-06-30T00:00:00Z'),
      basis: 'hireDate',
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortDir: 'desc',
    });

    const where = findMany.mock.calls[0]![0].where;
    expect(where.status).toBe('AWAITING_FORM');
    expect(where.hireDate.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    // The "to" day is inclusive — pushed to its final millisecond.
    expect(where.hireDate.lte.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });
});

describe('OnboardingDocumentRepository.countMissingRequired', () => {
  it('counts required checklist rows without an upload — the contract gate', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repo = new OnboardingDocumentRepository({
      onboardingDocument: { count },
    } as unknown as Db);

    expect(await repo.countMissingRequired('e1')).toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: { employeeId: 'e1', required: true, storageKey: null },
    });
  });
});

describe('AssetFormRepository', () => {
  it('moveStatus is guarded so a double-click cannot re-decide a form', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = new AssetFormRepository({ assetForm: { updateMany } } as unknown as Db);
    const when = new Date('2026-08-01T10:00:00Z');

    const moved = await repo.moveStatus('f1', 'PENDING_EMPLOYEE_APPROVAL', 'APPROVED', {
      decidedAt: when,
    });

    expect(moved).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'PENDING_EMPLOYEE_APPROVAL' },
      data: { status: 'APPROVED', decidedAt: when },
    });
  });

  it('countUnreturnedItems only looks at APPROVED custody forms — the offboarding gate', async () => {
    const count = vi.fn().mockResolvedValue(3);
    const repo = new AssetFormRepository({ assetFormItem: { count } } as unknown as Db);

    expect(await repo.countUnreturnedItems('e1')).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: { form: { employeeId: 'e1', status: 'APPROVED' }, returnedAt: null },
    });
  });
});

describe('AuditLogRepository', () => {
  it('appends the full transition record with the employee anchor', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'log1' });
    const repo = new AuditLogRepository({ auditLog: { create } } as unknown as Db);

    await repo.append({
      entity: 'EMPLOYEE',
      entityId: 'e1',
      action: 'EXPIRE',
      fromStatus: 'AWAITING_FORM',
      toStatus: 'EXPIRED',
      actorType: 'SYSTEM',
      employeeId: 'e1',
      metadata: { rule: 'form-10d-expire' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        entity: 'EMPLOYEE',
        entityId: 'e1',
        action: 'EXPIRE',
        fromStatus: 'AWAITING_FORM',
        toStatus: 'EXPIRED',
        actorType: 'SYSTEM',
        employeeId: 'e1',
        metadata: { rule: 'form-10d-expire' },
      },
    });
  });
});
