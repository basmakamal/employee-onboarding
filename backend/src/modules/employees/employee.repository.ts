import type { Db } from '../../common/prisma.js';
import type { EmployeeStatus, EmploymentType } from '../../generated/prisma/enums.js';

/** New-hire intake: opens the record in the onboarding pipeline. */
export interface CreateOnboardingData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  nationalId?: string;
  birthDate?: Date;
  department?: string;
  project?: string;
  jobTitle?: string;
  createdById: string;
  documentTypes: string[];
}

/** Direct add of existing staff: born ACTIVE with a number and processes. */
export interface CreateDirectData {
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
  createdById?: string;
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

  /** Pipeline intake — checklist rows open, no number, no process tracks. */
  createOnboarding(data: CreateOnboardingData) {
    const { documentTypes, ...employee } = data;
    return this.db.employee.create({
      data: {
        ...employee,
        documents: { create: documentTypes.map((type) => ({ type })) },
      },
      include: { documents: true },
    });
  }

  /** Existing staff join the system already ACTIVE, with all tracks open. */
  createDirect(data: CreateDirectData) {
    return this.db.employee.create({
      data: {
        ...data,
        status: 'ACTIVE',
        gosi: { create: {} },
        medical: { create: {} },
        criminalRecord: { create: {} },
      },
      include: { gosi: true, medical: true, criminalRecord: true },
    });
  }

  /**
   * Activation completes contract approval: allocate the number, stamp the
   * hire date, and open the three Stage-2 process tracks.
   */
  completeActivation(id: string, employeeNo: string, hireDate: Date) {
    return this.db.employee.update({
      where: { id },
      data: {
        employeeNo,
        hireDate,
        gosi: { create: {} },
        medical: { create: {} },
        criminalRecord: { create: {} },
      },
    });
  }

  /** Next EMP-#### — counts only employees that ever got a number. */
  async nextEmployeeNo(): Promise<string> {
    const numbered = await this.db.employee.count({ where: { employeeNo: { not: null } } });
    return `EMP-${String(numbered + 1).padStart(4, '0')}`;
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

  /** The public form writes exactly these three fields. */
  updatePersonal(id: string, fields: { phone?: string; nationalId?: string; birthDate?: Date }) {
    return this.db.employee.update({
      where: { id },
      data: {
        ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
        ...(fields.nationalId !== undefined ? { nationalId: fields.nationalId } : {}),
        ...(fields.birthDate !== undefined ? { birthDate: fields.birthDate } : {}),
      },
    });
  }

  /** The employee-file page: profile, checklist, contract, processes, timeline. */
  findWithDetails(id: string) {
    return this.db.employee.findUnique({
      where: { id },
      include: {
        documents: true,
        contract: true,
        gosi: true,
        medical: true,
        criminalRecord: true,
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

  /** Distinct departments / job titles in use — feeds the form comboboxes. */
  async fieldOptions(): Promise<{ departments: string[]; jobTitles: string[] }> {
    const rows = await this.db.employee.findMany({
      select: { department: true, jobTitle: true },
    });
    const distinct = (values: Array<string | null>) =>
      [...new Set(values.filter((v): v is string => !!v?.trim()).map((v) => v.trim()))].sort(
        (a, b) => a.localeCompare(b),
      );
    return {
      departments: distinct(rows.map((r) => r.department)),
      jobTitles: distinct(rows.map((r) => r.jobTitle)),
    };
  }

  /** SLA scan input — statusChangedAt is the elapsed-time anchor. */
  listInStatusSince(status: EmployeeStatus, threshold: Date) {
    return this.db.employee.findMany({
      where: { status, statusChangedAt: { lt: threshold } },
    });
  }

  /**
   * Hard delete with full child cleanup — for wrongly created or test
   * records. Audit rows survive with their anchor nulled (ON DELETE SET
   * NULL); the deletion itself is audited separately by the service.
   */
  deleteCascade(id: string) {
    return this.db.$transaction([
      this.db.employeeRequest.deleteMany({ where: { employeeId: id } }),
      this.db.employeeDocument.deleteMany({ where: { employeeId: id } }),
      this.db.offboarding.deleteMany({ where: { employeeId: id } }),
      this.db.assetFormItem.deleteMany({ where: { form: { employeeId: id } } }),
      this.db.assetForm.deleteMany({ where: { employeeId: id } }),
      this.db.gosiProcess.deleteMany({ where: { employeeId: id } }),
      this.db.medicalInsuranceProcess.deleteMany({ where: { employeeId: id } }),
      this.db.criminalRecordProcess.deleteMany({ where: { employeeId: id } }),
      this.db.onboardingDocument.deleteMany({ where: { employeeId: id } }),
      this.db.contract.deleteMany({ where: { employeeId: id } }),
      this.db.employee.delete({ where: { id } }),
    ]);
  }

  /**
   * Guarded status move — the ONLY way the lifecycle advances. Every
   * transition resets the SLA anchor.
   */
  async moveStatus(id: string, from: EmployeeStatus, to: EmployeeStatus): Promise<boolean> {
    const result = await this.db.employee.updateMany({
      where: { id, status: from },
      data: { status: to, statusChangedAt: new Date() },
    });
    return result.count === 1;
  }
}
