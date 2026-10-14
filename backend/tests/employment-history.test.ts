/**
 * Employment history: dated changes take effect on the company's LOCAL day,
 * are re-checked when they fall due, and never half-apply.
 */
import { describe, expect, it, vi } from 'vitest';
import { EmploymentHistoryService, dayValue, localDay } from '../src/modules/employees/employment-history.service.js';

describe('localDay', () => {
  it("uses the company's time zone, not UTC", () => {
    const lateEvening = new Date('2026-10-31T22:30:00Z'); // 01:30 on 1 Nov in Riyadh
    expect(localDay('Asia/Riyadh', lateEvening)).toBe('2026-11-01');
    expect(localDay('UTC', lateEvening)).toBe('2026-10-31');
  });
});

function setup(opts: { timezone: string; unitActive: boolean }) {
  const scheduled = [
    {
      id: 'ev1',
      batchId: 'b1',
      companyId: 'co',
      employeeId: 'e1',
      category: 'ORG_UNIT',
      status: 'SCHEDULED',
      effectiveDate: dayValue('2026-11-01'),
      oldValue: { id: 'u-old' },
      newValue: { id: 'u-new' },
    },
  ];
  const tx = {
    employmentEvent: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    employee: { update: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    company: { findUnique: vi.fn().mockResolvedValue({ timezone: opts.timezone }) },
    orgUnit: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, code: where.id, nameAr: 'ع', nameEn: where.id })) },
    position: { findFirst: vi.fn().mockResolvedValue(null) },
    employee: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const repo = {
    dueScheduled: vi.fn().mockResolvedValue(scheduled),
    moveBatch: vi.fn().mockResolvedValue(true),
  };
  const employees = {
    findById: vi.fn().mockResolvedValue({ id: 'e1', companyId: 'co', orgUnitId: 'u-old', positionId: null, managerId: null, employmentType: 'FULL_TIME', hireDate: null }),
    findOrgUnit: vi.fn().mockResolvedValue({ id: 'u-new', path: '/u-new/', active: opts.unitActive, nameAr: 'جديد', nameEn: 'New unit' }),
    findPosition: vi.fn(),
    findColleague: vi.fn(),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const service = new EmploymentHistoryService(db as never, repo as never, employees as never, audit as never);
  return { service, tx, repo, audit };
}

describe('scheduled employment changes', () => {
  const NOW = new Date('2026-10-31T22:30:00Z');

  it("apply when the company's local date arrives, moving the employee and stamping the history", async () => {
    const { service, tx, audit } = setup({ timezone: 'Asia/Riyadh', unitActive: true });
    expect(await service.applyDue(NOW)).toBe(1);
    expect(tx.employmentEvent.updateMany).toHaveBeenCalledWith({
      where: { batchId: 'b1', status: 'SCHEDULED' },
      data: { status: 'APPLIED', appliedAt: NOW },
    });
    expect(tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ orgUnitId: 'u-new', department: 'New unit' }),
    });
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'EMPLOYMENT_CHANGED', actorType: 'SYSTEM' }));
  });

  it('wait while it is still the day before in that time zone', async () => {
    const { service, tx } = setup({ timezone: 'UTC', unitActive: true });
    expect(await service.applyDue(NOW)).toBe(0);
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('fail with a reason — and change nothing — when the target unit has closed since', async () => {
    const { service, tx, repo } = setup({ timezone: 'Asia/Riyadh', unitActive: false });
    await service.applyDue(NOW);
    expect(repo.moveBatch).toHaveBeenCalledWith('b1', 'SCHEDULED', expect.objectContaining({ status: 'FAILED' }));
    expect(tx.employee.update).not.toHaveBeenCalled();
  });
});
