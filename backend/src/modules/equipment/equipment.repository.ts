import type { Db } from '../../common/prisma.js';

export class EquipmentRepository {
  constructor(private readonly db: Db) {}

  listByEmployee(employeeId: string) {
    return this.db.equipmentItem.findMany({
      where: { employeeId },
      orderBy: { type: 'asc' },
    });
  }

  findById(id: string) {
    return this.db.equipmentItem.findUnique({ where: { id } });
  }

  /**
   * Confirm receipt of one item. Guarded on PENDING so a retry or
   * double-click cannot overwrite who received it / when. Returns true when
   * this call is the one that flipped the item.
   */
  async markReceived(id: string, receivedById: string, receivedAt: Date): Promise<boolean> {
    const result = await this.db.equipmentItem.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'RECEIVED', receivedById, receivedAt },
    });
    return result.count === 1;
  }

  /** How many required items still block completion. */
  countPendingRequired(employeeId: string): Promise<number> {
    return this.db.equipmentItem.count({
      where: { employeeId, required: true, status: 'PENDING' },
    });
  }
}
