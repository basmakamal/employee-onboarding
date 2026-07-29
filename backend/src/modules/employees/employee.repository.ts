import type { Db } from '../../common/prisma.js';
import type { OnboardingStatus } from '../../generated/prisma/enums.js';

export interface CreateEmployeeData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  createdById: string;
  /** Equipment checklist created together with the employee, e.g. ['LAPTOP', 'HEADPHONE']. */
  equipmentTypes: string[];
}

export class EmployeeRepository {
  constructor(private readonly db: Db) {}

  create(data: CreateEmployeeData) {
    const { equipmentTypes, ...employee } = data;
    return this.db.employee.create({
      data: {
        ...employee,
        equipment: { create: equipmentTypes.map((type) => ({ type })) },
      },
      include: { equipment: true },
    });
  }

  findById(id: string) {
    return this.db.employee.findUnique({ where: { id } });
  }

  /** Full record for GET /api/employees/:id — documents, checklist, history. */
  findWithDetails(id: string) {
    return this.db.employee.findUnique({
      where: { id },
      include: {
        documents: { orderBy: { uploadedAt: 'desc' } },
        reviews: { orderBy: { createdAt: 'desc' } },
        equipment: true,
        auditLogs: { orderBy: { at: 'asc' } },
      },
    });
  }

  list() {
    return this.db.employee.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Concurrency-safe status move: only succeeds if the row is still in
   * `from`. Returns true when exactly one row changed — the state machine
   * uses this to reject stale/duplicate transitions.
   */
  async moveStatus(id: string, from: OnboardingStatus, to: OnboardingStatus): Promise<boolean> {
    const result = await this.db.employee.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    return result.count === 1;
  }
}
