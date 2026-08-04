import type { Db } from '../../common/prisma.js';
import type { CriminalRecordStatus } from '../../generated/prisma/enums.js';

export class CriminalRecordRepository {
  constructor(private readonly db: Db) {}

  findByEmployee(employeeId: string) {
    return this.db.criminalRecordProcess.findUnique({ where: { employeeId } });
  }

  async moveStatus(
    id: string,
    from: CriminalRecordStatus,
    to: CriminalRecordStatus,
    certificateStorageKey?: string,
  ): Promise<boolean> {
    const result = await this.db.criminalRecordProcess.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        ...(certificateStorageKey ? { certificateStorageKey } : {}),
      },
    });
    return result.count === 1;
  }
}
