/**
 * Repository unit tests with a fake Db — no database needed.
 * The point: repositories are constructor-injected, so anything that
 * quacks like the Prisma client works. This is the same seam services
 * will use in Phase 2/3 tests.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/common/prisma.js';
import { EmployeeRepository } from '../src/modules/employees/employee.repository.js';
import { EquipmentRepository } from '../src/modules/equipment/equipment.repository.js';
import { AuditLogRepository } from '../src/workflow/audit-log.repository.js';

describe('EmployeeRepository.moveStatus', () => {
  it('returns true when exactly one row transitions', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = new EmployeeRepository({ employee: { updateMany } } as unknown as Db);

    const moved = await repo.moveStatus('emp1', 'CREATED', 'DOCUMENT_UPLOADED');

    expect(moved).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'emp1', status: 'CREATED' },
      data: { status: 'DOCUMENT_UPLOADED' },
    });
  });

  it('returns false when the record is not in the expected status (stale transition)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = new EmployeeRepository({ employee: { updateMany } } as unknown as Db);

    const moved = await repo.moveStatus('emp1', 'CREATED', 'DOCUMENT_UPLOADED');

    expect(moved).toBe(false);
  });
});

describe('EquipmentRepository.markReceived', () => {
  it('only flips PENDING items, so retries cannot overwrite the receipt', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = new EquipmentRepository({ equipmentItem: { updateMany } } as unknown as Db);
    const when = new Date('2026-07-29T10:00:00Z');

    const flipped = await repo.markReceived('item1', 'user1', when);

    expect(flipped).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'item1', status: 'PENDING' },
      data: { status: 'RECEIVED', receivedById: 'user1', receivedAt: when },
    });
  });
});

describe('AuditLogRepository', () => {
  it('appends an entry with the exact audit fields', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'log1' });
    const repo = new AuditLogRepository({ auditLog: { create } } as unknown as Db);

    await repo.append({
      employeeId: 'emp1',
      action: 'STATUS_TRANSITION',
      fromStatus: 'CREATED',
      toStatus: 'DOCUMENT_UPLOADED',
      actorType: 'EMPLOYEE_LINK',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        employeeId: 'emp1',
        action: 'STATUS_TRANSITION',
        fromStatus: 'CREATED',
        toStatus: 'DOCUMENT_UPLOADED',
        actorType: 'EMPLOYEE_LINK',
      },
    });
  });
});
