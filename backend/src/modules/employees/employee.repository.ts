import type { Db } from '../../common/prisma.js';
import type { EmployeeStatus } from '../../generated/prisma/enums.js';

export interface CreateEmployeeData {
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  nationalId?: string;
  birthDate?: Date;
  department?: string;
  project?: string;
  jobTitle?: string;
  hireDate: Date;
  traineeId?: string;
}

export class EmployeeRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates the employee together with its three Stage-2 process rows —
   * the BRD's "employee file" starts with all tracks open.
   */
  create(data: CreateEmployeeData) {
    return this.db.employee.create({
      data: {
        ...data,
        gosi: { create: {} },
        medical: { create: {} },
        criminalRecord: { create: {} },
      },
      include: { gosi: true, medical: true, criminalRecord: true },
    });
  }

  findById(id: string) {
    return this.db.employee.findUnique({ where: { id } });
  }

  /** The employee-file page: processes, assets, offboarding, timeline. */
  findWithDetails(id: string) {
    return this.db.employee.findUnique({
      where: { id },
      include: {
        gosi: true,
        medical: true,
        criminalRecord: true,
        assetForms: { include: { items: true }, orderBy: { createdAt: 'desc' } },
        offboardings: { orderBy: { createdAt: 'desc' } },
        auditLogs: { orderBy: { at: 'asc' } },
      },
    });
  }

  list() {
    return this.db.employee.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Used to allocate the next EMP-XXXX employee number. */
  count(): Promise<number> {
    return this.db.employee.count();
  }

  /** Guarded status flip (Active ↔ Inactive at file closure). */
  async moveStatus(id: string, from: EmployeeStatus, to: EmployeeStatus): Promise<boolean> {
    const result = await this.db.employee.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    return result.count === 1;
  }
}
