import type { Db } from '../../common/prisma.js';
import type { AssetFormStatus, AssetCondition } from '../../generated/prisma/enums.js';

export interface AssetFormItemInput {
  assetId?: string;
  type: string;
  name: string;
  serialNumber?: string;
  quantity?: number;
  condition?: AssetCondition;
  notes?: string;
}

export class AssetFormRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    createdById: string;
    deliveryDate?: Date;
    items: AssetFormItemInput[];
  }) {
    const { items, ...form } = data;
    return this.db.assetForm.create({
      data: { ...form, items: { create: items } },
      include: { items: true },
    });
  }

  findWithItems(id: string) {
    return this.db.assetForm.findUnique({
      where: { id },
      include: { items: true, employee: true },
    });
  }

  countItems(formId: string): Promise<number> {
    return this.db.assetFormItem.count({ where: { formId } });
  }

  /** Replace all item lines — only meaningful while the form is a draft. */
  async replaceItems(formId: string, items: AssetFormItemInput[]) {
    await this.db.assetFormItem.deleteMany({ where: { formId } });
    return this.db.assetForm.update({
      where: { id: formId },
      data: { items: { create: items } },
      include: { items: true },
    });
  }

  listByEmployee(employeeId: string) {
    return this.db.assetForm.findMany({
      where: { employeeId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Guarded lifecycle move (Draft → Sent → Pending → Approved/Rejected/Cancelled). */
  async moveStatus(
    id: string,
    from: AssetFormStatus,
    to: AssetFormStatus,
    stamp?: { sentAt?: Date; decidedAt?: Date; rejectReason?: string },
  ): Promise<boolean> {
    const result = await this.db.assetForm.updateMany({
      where: { id, status: from },
      data: { status: to, ...stamp },
    });
    return result.count === 1;
  }

  /** Offboarding gate: approved custody items not yet returned. */
  countUnreturnedItems(employeeId: string): Promise<number> {
    return this.db.assetFormItem.count({
      where: {
        form: { employeeId, status: 'APPROVED' },
        returnedAt: null,
      },
    });
  }

  markItemReturned(itemId: string, returnedAt: Date) {
    return this.db.assetFormItem.update({
      where: { id: itemId },
      data: { returnedAt },
    });
  }
}
