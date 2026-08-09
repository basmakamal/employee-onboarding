import type { Db } from '../../common/prisma.js';
import type { EmployeeStatus, EmploymentType } from '../../generated/prisma/enums.js';

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
  directManager?: string;
  employmentType?: EmploymentType;
  hireDate: Date;
  traineeId?: string;
}

/** Profile fields HR may edit in place; null clears an optional column. */
export interface UpdateEmployeeData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  nationalId?: string | null;
  birthDate?: Date | null;
  department?: string | null;
  project?: string | null;
  jobTitle?: string | null;
  directManager?: string | null;
  employmentType?: EmploymentType;
  hireDate?: Date;
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

  update(id: string, data: UpdateEmployeeData) {
    return this.db.employee.update({ where: { id }, data });
  }

  setPhoto(id: string, photoKey: string) {
    return this.db.employee.update({ where: { id }, data: { photoKey } });
  }

  /** The employee-file page: profile, processes, contract, assets, timeline. */
  findWithDetails(id: string) {
    return this.db.employee.findUnique({
      where: { id },
      include: {
        gosi: true,
        medical: true,
        criminalRecord: true,
        trainee: { include: { contract: true, documents: true } },
        requests: {
          orderBy: { createdAt: 'desc' },
          include: { createdBy: { select: { name: true } } },
        },
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
