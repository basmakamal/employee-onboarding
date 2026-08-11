import type { Db } from '../../common/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { EmployeeStatus, EmploymentType } from '../../generated/prisma/enums.js';

/** The onboarding pipeline statuses (everything before ACTIVE/INACTIVE). */
export const PIPELINE_STATUSES = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
] as const;

export const EMPLOYEE_SORT_FIELDS = [
  'createdAt',
  'firstName',
  'employeeNo',
  'email',
  'department',
  'jobTitle',
  'status',
  'hireDate',
] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export interface EmployeeListQuery {
  /** Free-text search across name, email, number, national id, phone. */
  q?: string;
  filter: 'all' | 'onboarding' | 'active' | 'inactive';
  /** Exact status (reports drill-down) — takes precedence over `filter`. */
  status?: EmployeeStatus;
  /** Inclusive date range applied to `basis` (reports duration filter). */
  from?: Date;
  to?: Date;
  basis: 'hireDate' | 'createdAt';
  page: number; // 1-based
  limit: number;
  sortBy: EmployeeSortField;
  sortDir: 'asc' | 'desc';
}

export interface EmployeeListItem {
  id: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  department: string | null;
  project: string | null;
  jobTitle: string | null;
  status: EmployeeStatus;
  hireDate: Date | null;
  createdAt: Date;
}

function employeeListWhere(query: EmployeeListQuery): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (query.status) where.status = query.status;
  else if (query.filter === 'onboarding') where.status = { in: [...PIPELINE_STATUSES] };
  else if (query.filter === 'active') where.status = 'ACTIVE';
  else if (query.filter === 'inactive') where.status = 'INACTIVE';

  if (query.from || query.to) {
    // SQL comparisons against NULL are never true, so a hire-date range
    // naturally excludes the not-yet-hired — same as the old client filter.
    // The "to" day is inclusive: push it to the last millisecond of the day.
    const range: { gte?: Date; lte?: Date } = {};
    if (query.from) range.gte = query.from;
    if (query.to) range.lte = new Date(query.to.getTime() + 86_399_999);
    where[query.basis] = range;
  }

  const q = query.q?.trim();
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { email: { contains: q } },
      { employeeNo: { contains: q } },
      { nationalId: { contains: q } },
      { phone: { contains: q } },
      { department: { contains: q } },
      { jobTitle: { contains: q } },
    ];
  }
  return where;
}

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

  /**
   * Next EMP-#### from the atomic sequence row. The increment takes a row
   * lock, so when this runs inside the activation transaction two concurrent
   * approvals serialize instead of both computing the same number (which the
   * old count()+1 approach allowed). The create branch only fires on a fresh
   * database — the migration seeds the row from the existing numbered count.
   */
  async allocateEmployeeNo(): Promise<string> {
    const seq = await this.db.sequence.upsert({
      where: { key: 'EMPLOYEE_NO' },
      update: { value: { increment: 1 } },
      create: { key: 'EMPLOYEE_NO', value: 1 },
    });
    return `EMP-${String(seq.value).padStart(4, '0')}`;
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
  /**
   * Personal details captured by the employee data form.
   *
   * Every key is applied only when present, so this stays usable for the
   * partial updates HR makes from the employee file as well as for the full
   * form submission.
   */
  updatePersonal(
    id: string,
    fields: {
      firstName?: string;
      fatherName?: string;
      grandfatherName?: string;
      lastName?: string;
      phone?: string;
      email?: string;
      nationalId?: string;
      birthDate?: Date;
      birthDateHijri?: string;
      gender?: 'MALE' | 'FEMALE';
      nationality?: string;
      maritalStatus?: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED';
      splAddress?: string;
      iban?: string;
      qualification?: 'HIGH_SCHOOL' | 'DIPLOMA' | 'BACHELOR' | 'MASTER' | 'PHD' | 'OTHER';
      major?: string;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
    },
  ) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) data[key] = value;
    }
    return this.db.employee.update({ where: { id }, data });
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
        // Latest page only — the timeline grows forever; the rest is served
        // by auditPage() on demand.
        auditLogs: { orderBy: { at: 'desc' }, take: 20 },
        _count: { select: { auditLogs: true } },
      },
    });
  }

  /**
   * Server-side page of the employee list. Search, filter, sort and slice
   * all happen in the database — the API never ships the whole table.
   */
  async listPaged(query: EmployeeListQuery): Promise<{ items: EmployeeListItem[]; total: number }> {
    const where = employeeListWhere(query);
    const orderBy = { [query.sortBy]: query.sortDir } as Record<string, 'asc' | 'desc'>;
    const [items, total] = await Promise.all([
      this.db.employee.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          employeeNo: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          department: true,
          project: true,
          jobTitle: true,
          status: true,
          hireDate: true,
          createdAt: true,
        },
      }),
      this.db.employee.count({ where }),
    ]);
    return { items, total };
  }

  /** Tab badges for the list page — one GROUP BY instead of four scans. */
  async statusCounts(): Promise<{
    all: number;
    onboarding: number;
    active: number;
    inactive: number;
  }> {
    const groups = await this.db.employee.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus = new Map(groups.map((g) => [g.status as string, g._count._all]));
    const sum = (statuses: readonly string[]) =>
      statuses.reduce((acc, s) => acc + (byStatus.get(s) ?? 0), 0);
    const all = [...byStatus.values()].reduce((a, b) => a + b, 0);
    return {
      all,
      onboarding: sum(PIPELINE_STATUSES),
      active: byStatus.get('ACTIVE') ?? 0,
      inactive: byStatus.get('INACTIVE') ?? 0,
    };
  }

  /** Distinct departments / job titles in use — feeds the form comboboxes. */
  async fieldOptions(): Promise<{ departments: string[]; jobTitles: string[] }> {
    // GROUP BY runs the dedup in the database instead of loading every row.
    const [departments, jobTitles] = await Promise.all([
      this.db.employee.groupBy({
        by: ['department'],
        where: { department: { not: null } },
      }),
      this.db.employee.groupBy({
        by: ['jobTitle'],
        where: { jobTitle: { not: null } },
      }),
    ]);
    const clean = (values: Array<string | null>) =>
      [...new Set(values.filter((v): v is string => !!v?.trim()).map((v) => v.trim()))].sort(
        (a, b) => a.localeCompare(b),
      );
    return {
      departments: clean(departments.map((d) => d.department)),
      jobTitles: clean(jobTitles.map((j) => j.jobTitle)),
    };
  }

  /** One page of the employee's audit timeline, newest first. */
  async auditPage(employeeId: string, page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where: { employeeId },
        orderBy: { at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.auditLog.count({ where: { employeeId } }),
    ]);
    return { items, total };
  }

  /** SLA scan input — statusChangedAt is the elapsed-time anchor. */
  listInStatusSince(status: EmployeeStatus, threshold: Date, limit = 500) {
    return this.db.employee.findMany({
      where: { status, statusChangedAt: { lt: threshold } },
      // Oldest first so a backlog larger than one batch drains fairly.
      orderBy: { statusChangedAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Every stored file attached to this employee, collected BEFORE a hard
   * delete so the caller can remove them from disk after the rows are gone.
   */
  async collectStorageKeys(id: string): Promise<string[]> {
    const [employee, docs, contract, criminal, offboardings] = await Promise.all([
      this.db.employee.findUnique({ where: { id }, select: { photoKey: true } }),
      this.db.onboardingDocument.findMany({
        where: { employeeId: id, storageKey: { not: null } },
        select: { storageKey: true },
      }),
      this.db.contract.findUnique({ where: { employeeId: id }, select: { storageKey: true } }),
      this.db.criminalRecordProcess.findUnique({
        where: { employeeId: id },
        select: { certificateStorageKey: true },
      }),
      this.db.offboarding.findMany({
        where: { employeeId: id, noticeStorageKey: { not: null } },
        select: { noticeStorageKey: true },
      }),
    ]);
    return [
      employee?.photoKey,
      ...docs.map((d) => d.storageKey),
      contract?.storageKey,
      criminal?.certificateStorageKey,
      ...offboardings.map((o) => o.noticeStorageKey),
    ].filter((k): k is string => !!k);
  }

  /**
   * Hard delete with full child cleanup — for wrongly created or test
   * records. Audit rows survive with their anchor nulled (ON DELETE SET
   * NULL); the deletion itself is audited separately by the service.
   *
   * Plain sequential deletes: the service runs this inside its unit of
   * work, so the whole cleanup (plus the DELETE audit row) is one
   * transaction there — nesting another one here would fail on a
   * transaction client.
   */
  async deleteCascade(id: string) {
    await this.db.employeeRequest.deleteMany({ where: { employeeId: id } });
    await this.db.employeeDocument.deleteMany({ where: { employeeId: id } });
    await this.db.offboarding.deleteMany({ where: { employeeId: id } });
    await this.db.assetFormItem.deleteMany({ where: { form: { employeeId: id } } });
    await this.db.assetForm.deleteMany({ where: { employeeId: id } });
    await this.db.gosiProcess.deleteMany({ where: { employeeId: id } });
    await this.db.medicalInsuranceProcess.deleteMany({ where: { employeeId: id } });
    await this.db.criminalRecordProcess.deleteMany({ where: { employeeId: id } });
    await this.db.onboardingDocument.deleteMany({ where: { employeeId: id } });
    await this.db.contract.deleteMany({ where: { employeeId: id } });
    await this.db.employee.delete({ where: { id } });
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
