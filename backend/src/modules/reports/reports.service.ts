import ExcelJS from 'exceljs';
import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Reporting: on-screen aggregations + Excel workbooks. Everything is
 * derived from live data — no snapshots to maintain.
 */
export class ReportsService {
  constructor(private readonly prisma: PrismaClient) {}

  // ----------------------------------------------------------- summary

  async summary(now: Date = new Date()) {
    const [employees, trainees, gosi, medical, criminal, forms, unreturned, offboardings, docs] =
      await Promise.all([
        this.prisma.employee.findMany({ select: { department: true, status: true } }),
        this.prisma.trainee.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.gosiProcess.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.medicalInsuranceProcess.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.criminalRecordProcess.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.assetForm.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.assetFormItem.count({
          where: { form: { status: 'APPROVED' }, returnedAt: null },
        }),
        this.prisma.offboarding.groupBy({ by: ['reason'], _count: { _all: true } }),
        this.prisma.employeeDocument.findMany({
          where: { employee: { status: 'ACTIVE' } },
          select: { expiryDate: true },
        }),
      ]);

    const toMap = (rows: Array<{ status?: string; reason?: string; _count: { _all: number } }>) =>
      Object.fromEntries(rows.map((r) => [r.status ?? r.reason ?? '?', r._count._all]));

    const headcount = new Map<string, { active: number; inactive: number }>();
    for (const e of employees) {
      const key = e.department?.trim() || '—';
      const entry = headcount.get(key) ?? { active: 0, inactive: 0 };
      if (e.status === 'ACTIVE') entry.active += 1;
      else entry.inactive += 1;
      headcount.set(key, entry);
    }

    const dayMs = 86_400_000;
    const docBuckets = { expired: 0, in30: 0, in60: 0, in90: 0 };
    for (const doc of docs) {
      const days = Math.ceil((doc.expiryDate.getTime() - now.getTime()) / dayMs);
      if (days < 0) docBuckets.expired += 1;
      else if (days <= 30) docBuckets.in30 += 1;
      else if (days <= 60) docBuckets.in60 += 1;
      else if (days <= 90) docBuckets.in90 += 1;
    }

    return {
      headcountByDepartment: [...headcount.entries()]
        .map(([department, counts]) => ({ department, ...counts }))
        .sort((a, b) => b.active - a.active),
      traineeFunnel: toMap(trainees as never),
      processes: {
        gosi: toMap(gosi as never),
        medical: toMap(medical as never),
        criminal: toMap(criminal as never),
      },
      assetForms: toMap(forms as never),
      unreturnedAssetItems: unreturned,
      offboardingByReason: toMap(offboardings as never),
      expiringDocuments: docBuckets,
    };
  }

  // ------------------------------------------------------------ exports

  async employeesWorkbook(): Promise<ExcelJS.Workbook> {
    const rows = await this.prisma.employee.findMany({
      include: { gosi: true, medical: true, criminalRecord: true },
      orderBy: { employeeNo: 'asc' },
    });
    return workbook('Employees', [
      ['Employee No', 'First name', 'Last name', 'Email', 'Phone', 'Department', 'Project', 'Job title', 'Hire date', 'Status', 'GOSI', 'Medical insurance', 'Criminal record'],
      ...rows.map((e) => [
        e.employeeNo, e.firstName, e.lastName, e.email, e.phone ?? '', e.department ?? '',
        e.project ?? '', e.jobTitle ?? '', e.hireDate.toISOString().slice(0, 10), e.status,
        e.gosi?.status ?? '', e.medical?.status ?? '', e.criminalRecord?.status ?? '',
      ]),
    ]);
  }

  async traineesWorkbook(): Promise<ExcelJS.Workbook> {
    const rows = await this.prisma.trainee.findMany({
      include: { documents: true, contract: true },
      orderBy: { createdAt: 'asc' },
    });
    return workbook('Trainees', [
      ['First name', 'Last name', 'Email', 'Department', 'Job title', 'Status', 'Since', 'Docs uploaded', 'Docs required', 'Contract sent', 'Contract approved', 'Created'],
      ...rows.map((t) => [
        t.firstName, t.lastName, t.email, t.department ?? '', t.jobTitle ?? '', t.status,
        t.statusChangedAt.toISOString().slice(0, 10),
        t.documents.filter((d) => d.storageKey !== null).length,
        t.documents.filter((d) => d.required).length,
        t.contract?.sentAt ? t.contract.sentAt.toISOString().slice(0, 10) : '',
        t.contract?.approvedAt ? t.contract.approvedAt.toISOString().slice(0, 10) : '',
        t.createdAt.toISOString().slice(0, 10),
      ]),
    ]);
  }

  async expiringDocumentsWorkbook(now: Date = new Date()): Promise<ExcelJS.Workbook> {
    const rows = await this.prisma.employeeDocument.findMany({
      where: { employee: { status: 'ACTIVE' } },
      include: { employee: { select: { employeeNo: true, firstName: true, lastName: true, department: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    return workbook('Expiring documents', [
      ['Employee No', 'Employee', 'Department', 'Document', 'Number', 'Expiry date', 'Days left'],
      ...rows.map((d) => [
        d.employee.employeeNo,
        `${d.employee.firstName} ${d.employee.lastName}`,
        d.employee.department ?? '',
        d.type,
        d.number ?? '',
        d.expiryDate.toISOString().slice(0, 10),
        Math.ceil((d.expiryDate.getTime() - now.getTime()) / 86_400_000),
      ]),
    ]);
  }

  async auditWorkbook(days: number): Promise<ExcelJS.Workbook> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.auditLog.findMany({
      where: { at: { gte: since } },
      include: {
        actor: { select: { name: true } },
        employee: { select: { employeeNo: true, firstName: true, lastName: true } },
        trainee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { at: 'desc' },
      take: 10_000,
    });
    return workbook(`Audit (last ${days} days)`, [
      ['At', 'Entity', 'Action', 'From', 'To', 'Actor type', 'Actor', 'Subject'],
      ...rows.map((log) => [
        log.at.toISOString().replace('T', ' ').slice(0, 19),
        log.entity, log.action, log.fromStatus ?? '', log.toStatus ?? '', log.actorType,
        log.actor?.name ?? '',
        log.employee
          ? `${log.employee.firstName} ${log.employee.lastName} (${log.employee.employeeNo})`
          : log.trainee
            ? `${log.trainee.firstName} ${log.trainee.lastName}`
            : '',
      ]),
    ]);
  }
}

/** One-sheet workbook with a styled header row and auto-ish column widths. */
function workbook(title: string, rows: Array<Array<string | number>>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(title.slice(0, 31));
  sheet.addRows(rows);

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (let c = 1; c <= (rows[0]?.length ?? 0); c++) {
    const lengths = rows.map((r) => String(r[c - 1] ?? '').length);
    sheet.getColumn(c).width = Math.min(40, Math.max(12, ...lengths) + 2);
  }
  return wb;
}
