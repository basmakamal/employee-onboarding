import type { Db } from '../../common/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ContractStatus } from '../../generated/prisma/enums.js';

/**
 * The contract record. The document itself is created and approved on an
 * external platform; this row carries the terms HR typed plus the status HR
 * records by hand (Draft → Pending Approval → Active / Rejected / Expired).
 */
export class ContractRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    createdById: string;
    storageKey?: string;
    details?: Prisma.InputJsonValue;
    externalRef?: string | null;
  }) {
    return this.db.contract.create({ data });
  }

  findByEmployee(employeeId: string) {
    return this.db.contract.findUnique({ where: { employeeId } });
  }

  updateDetails(id: string, details: Prisma.InputJsonValue, externalRef?: string | null) {
    return this.db.contract.update({
      where: { id },
      data: { details, ...(externalRef !== undefined ? { externalRef } : {}) },
    });
  }

  /**
   * Record the status HR read off the external platform. Timestamps travel
   * with the status so the card can show when it was submitted / approved.
   */
  setStatus(
    id: string,
    status: ContractStatus,
    stamp: { sentAt?: Date; approvedAt?: Date; rejectReason?: string | null } = {},
  ) {
    return this.db.contract.update({
      where: { id },
      data: { status, statusChangedAt: new Date(), ...stamp },
    });
  }

  /** Same, addressed by employee — for callers that only hold the employee. */
  setStatusByEmployee(employeeId: string, status: ContractStatus) {
    return this.db.contract.updateMany({
      where: { employeeId },
      data: { status, statusChangedAt: new Date() },
    });
  }

  markSent(id: string, sentAt: Date) {
    return this.setStatus(id, 'PENDING_APPROVAL', { sentAt, rejectReason: null });
  }

  /** Guarded on approvedAt IS NULL — a duplicate approval cannot re-stamp. */
  async markApproved(id: string, approvedAt: Date): Promise<boolean> {
    const result = await this.db.contract.updateMany({
      where: { id, approvedAt: null },
      data: { status: 'ACTIVE', statusChangedAt: approvedAt, approvedAt },
    });
    return result.count === 1;
  }
}
