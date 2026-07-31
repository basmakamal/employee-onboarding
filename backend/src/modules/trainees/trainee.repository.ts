import type { Db } from '../../common/prisma.js';
import type { TraineeStatus } from '../../generated/prisma/enums.js';

export interface CreateTraineeData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  nationalId?: string;
  birthDate?: Date;
  department?: string;
  jobTitle?: string;
  createdById: string;
  /** HR-configured document checklist, e.g. ['NATIONAL_ID', 'QUALIFICATION']. */
  documentTypes: string[];
}

export class TraineeRepository {
  constructor(private readonly db: Db) {}

  create(data: CreateTraineeData) {
    const { documentTypes, ...trainee } = data;
    return this.db.trainee.create({
      data: {
        ...trainee,
        documents: { create: documentTypes.map((type) => ({ type })) },
      },
      include: { documents: true },
    });
  }

  findById(id: string) {
    return this.db.trainee.findUnique({ where: { id } });
  }

  /** Full record for the HR detail view: checklist, contract, timeline. */
  findWithDetails(id: string) {
    return this.db.trainee.findUnique({
      where: { id },
      include: {
        documents: true,
        contract: true,
        employee: true,
        auditLogs: { orderBy: { at: 'asc' } },
      },
    });
  }

  list() {
    return this.db.trainee.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Records sitting in `status` since before `threshold` — SLA scan input. */
  listInStatusSince(status: TraineeStatus, threshold: Date) {
    return this.db.trainee.findMany({
      where: { status, statusChangedAt: { lt: threshold } },
    });
  }

  /**
   * Concurrency-safe transition: only succeeds if the row is still in
   * `from`. Resets the SLA anchor. Returns true when this call moved it.
   */
  async moveStatus(id: string, from: TraineeStatus, to: TraineeStatus): Promise<boolean> {
    const result = await this.db.trainee.updateMany({
      where: { id, status: from },
      data: { status: to, statusChangedAt: new Date(), lastReminderAt: null },
    });
    return result.count === 1;
  }

  markReminded(id: string, at: Date) {
    return this.db.trainee.update({ where: { id }, data: { lastReminderAt: at } });
  }
}
