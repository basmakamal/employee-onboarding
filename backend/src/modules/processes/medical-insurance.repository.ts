import type { Db } from '../../common/prisma.js';
import type { ProcessStatus, MedicalHoldReason } from '../../generated/prisma/enums.js';

export class MedicalInsuranceRepository {
  constructor(private readonly db: Db) {}

  findByEmployee(employeeId: string) {
    return this.db.medicalInsuranceProcess.findUnique({ where: { employeeId } });
  }

  async moveStatus(
    id: string,
    from: ProcessStatus,
    to: ProcessStatus,
    hold?: { reason: MedicalHoldReason; note?: string },
  ): Promise<boolean> {
    const result = await this.db.medicalInsuranceProcess.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        holdReason: to === 'ON_HOLD' ? (hold?.reason ?? 'OTHER') : null,
        holdNote: to === 'ON_HOLD' ? (hold?.note ?? null) : null,
      },
    });
    return result.count === 1;
  }
}
