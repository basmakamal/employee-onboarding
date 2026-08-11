import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** Summary answers change slowly; recomputing per page view is waste. */
const SUMMARY_CACHE_MS = 30_000;

/** Rows fetched per round-trip while streaming an export. */
const EXPORT_BATCH = 1_000;

interface ColumnDef {
  header: string;
  width: number;
}

/**
 * Reporting: on-screen aggregations + Excel downloads. Aggregations happen
 * in SQL (GROUP BY / COUNT) — never by loading tables into JS — and exports
 * stream row batches straight to the response, so memory stays flat no
 * matter how many rows leave the building.
 */
export class ReportsService {
  private summaryCache: { value: unknown; at: number } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  // ----------------------------------------------------------- summary

  async summary(now: Date = new Date()) {
    if (this.summaryCache && Date.now() - this.summaryCache.at < SUMMARY_CACHE_MS) {
      return this.summaryCache.value;
    }

    const day = 86_400_000;
    const at = (days: number) => new Date(now.getTime() + days * day);
    const activeDoc = { employee: { status: 'ACTIVE' as const } };

    const [
      headcount,
      byStatus,
      gosi,
      medical,
      criminal,
      forms,
      unreturned,
      offboardings,
      expired,
      in30,
      in60,
      in90,
    ] = await Promise.all([
      // Employment headcount per department — one GROUP BY, not a row load.
      this.prisma.employee.groupBy({
        by: ['department', 'status'],
        where: { status: { in: ['ACTIVE', 'INACTIVE'] } },
        _count: { _all: true },
      }),
      this.prisma.employee.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.gosiProcess.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.medicalInsuranceProcess.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.criminalRecordProcess.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.assetForm.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.assetFormItem.count({
        where: { form: { status: 'APPROVED' }, returnedAt: null },
      }),
      this.prisma.offboarding.groupBy({ by: ['reason'], _count: { _all: true } }),
      // Expiry buckets as four indexed range COUNTs (expiryDate is indexed).
      this.prisma.employeeDocument.count({
        where: { ...activeDoc, expiryDate: { lt: now } },
      }),
      this.prisma.employeeDocument.count({
        where: { ...activeDoc, expiryDate: { gte: now, lte: at(30) } },
      }),
      this.prisma.employeeDocument.count({
        where: { ...activeDoc, expiryDate: { gt: at(30), lte: at(60) } },
      }),
      this.prisma.employeeDocument.count({
        where: { ...activeDoc, expiryDate: { gt: at(60), lte: at(90) } },
      }),
    ]);

    const toMap = (rows: Array<{ status?: string; reason?: string; _count: { _all: number } }>) =>
      Object.fromEntries(rows.map((r) => [r.status ?? r.reason ?? '?', r._count._all]));

    const byDepartment = new Map<string, { active: number; inactive: number }>();
    for (const g of headcount) {
      const key = g.department?.trim() || '—';
      const entry = byDepartment.get(key) ?? { active: 0, inactive: 0 };
      if (g.status === 'ACTIVE') entry.active += g._count._all;
      else entry.inactive += g._count._all;
      byDepartment.set(key, entry);
    }

    const value = {
      headcountByDepartment: [...byDepartment.entries()]
        .map(([department, counts]) => ({ department, ...counts }))
        .sort((a, b) => b.active - a.active),
      onboardingFunnel: toMap(byStatus as never),
      processes: {
        gosi: toMap(gosi as never),
        medical: toMap(medical as never),
        criminal: toMap(criminal as never),
      },
      assetForms: toMap(forms as never),
      unreturnedAssetItems: unreturned,
      offboardingByReason: toMap(offboardings as never),
      expiringDocuments: { expired, in30, in60, in90 },
    };
    this.summaryCache = { value, at: Date.now() };
    return value;
  }

  // ------------------------------------------------------------ exports
  //
  // Every export follows the same shape: a streaming workbook writer bound
  // to the HTTP response, and a keyset loop (`id > cursor`) that fetches
  // EXPORT_BATCH rows per round-trip and commits them straight to the
  // stream. The whole table never sits in memory, at any row count.

  /** Activated staff only — the pipeline has its own export. */
  async streamEmployees(out: Writable): Promise<void> {
    await streamWorkbook(
      out,
      'Employees',
      [
        { header: 'Employee No', width: 14 },
        { header: 'First name', width: 16 },
        { header: 'Last name', width: 16 },
        { header: 'Email', width: 28 },
        { header: 'Phone', width: 14 },
        { header: 'Department', width: 18 },
        { header: 'Project', width: 18 },
        { header: 'Job title', width: 18 },
        { header: 'Hire date', width: 12 },
        { header: 'Status', width: 10 },
        { header: 'GOSI', width: 12 },
        { header: 'Medical insurance', width: 16 },
        { header: 'Criminal record', width: 14 },
      ],
      (cursor) =>
        this.prisma.employee.findMany({
          where: { status: { in: ['ACTIVE', 'INACTIVE'] } },
          include: { gosi: true, medical: true, criminalRecord: true },
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (e) => [
        e.employeeNo ?? '', e.firstName, e.lastName, e.email, e.phone ?? '', e.department ?? '',
        e.project ?? '', e.jobTitle ?? '', e.hireDate ? e.hireDate.toISOString().slice(0, 10) : '',
        e.status, e.gosi?.status ?? '', e.medical?.status ?? '', e.criminalRecord?.status ?? '',
      ],
    );
  }

  /** Employees still in the onboarding pipeline (pre-activation). */
  async streamOnboarding(out: Writable): Promise<void> {
    await streamWorkbook(
      out,
      'Onboarding',
      [
        { header: 'First name', width: 16 },
        { header: 'Last name', width: 16 },
        { header: 'Email', width: 28 },
        { header: 'Department', width: 18 },
        { header: 'Job title', width: 18 },
        { header: 'Status', width: 24 },
        { header: 'Since', width: 12 },
        { header: 'Docs uploaded', width: 13 },
        { header: 'Docs required', width: 13 },
        { header: 'Contract sent', width: 13 },
        { header: 'Contract approved', width: 16 },
        { header: 'Created', width: 12 },
      ],
      (cursor) =>
        this.prisma.employee.findMany({
          where: { status: { notIn: ['ACTIVE', 'INACTIVE'] } },
          include: { documents: true, contract: true },
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (e) => [
        e.firstName, e.lastName, e.email, e.department ?? '', e.jobTitle ?? '', e.status,
        e.statusChangedAt.toISOString().slice(0, 10),
        e.documents.filter((d) => d.storageKey !== null).length,
        e.documents.filter((d) => d.required).length,
        e.contract?.sentAt ? e.contract.sentAt.toISOString().slice(0, 10) : '',
        e.contract?.approvedAt ? e.contract.approvedAt.toISOString().slice(0, 10) : '',
        e.createdAt.toISOString().slice(0, 10),
      ],
    );
  }

  async streamExpiringDocuments(out: Writable, now: Date = new Date()): Promise<void> {
    await streamWorkbook(
      out,
      'Expiring documents',
      [
        { header: 'Employee No', width: 14 },
        { header: 'Employee', width: 26 },
        { header: 'Department', width: 18 },
        { header: 'Document', width: 16 },
        { header: 'Number', width: 16 },
        { header: 'Expiry date', width: 12 },
        { header: 'Days left', width: 10 },
      ],
      (cursor) =>
        this.prisma.employeeDocument.findMany({
          where: { employee: { status: 'ACTIVE' } },
          include: {
            employee: {
              select: { employeeNo: true, firstName: true, lastName: true, department: true },
            },
          },
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (d) => [
        d.employee.employeeNo ?? '',
        `${d.employee.firstName} ${d.employee.lastName}`,
        d.employee.department ?? '',
        d.type,
        d.number ?? '',
        d.expiryDate.toISOString().slice(0, 10),
        Math.ceil((d.expiryDate.getTime() - now.getTime()) / 86_400_000),
      ],
    );
  }

  async streamAudit(out: Writable, days: number): Promise<void> {
    const since = new Date(Date.now() - days * 86_400_000);
    await streamWorkbook(
      out,
      `Audit (last ${days} days)`,
      [
        { header: 'At', width: 20 },
        { header: 'Entity', width: 16 },
        { header: 'Action', width: 22 },
        { header: 'From', width: 22 },
        { header: 'To', width: 22 },
        { header: 'Actor type', width: 10 },
        { header: 'Actor', width: 20 },
        { header: 'Subject', width: 28 },
      ],
      (cursor) =>
        this.prisma.auditLog.findMany({
          where: { at: { gte: since } },
          include: {
            actor: { select: { name: true } },
            employee: { select: { employeeNo: true, firstName: true, lastName: true } },
          },
          orderBy: { id: 'asc' },
          take: EXPORT_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      (log) => [
        log.at.toISOString().replace('T', ' ').slice(0, 19),
        log.entity, log.action, log.fromStatus ?? '', log.toStatus ?? '', log.actorType,
        log.actor?.name ?? '',
        log.employee
          ? `${log.employee.firstName} ${log.employee.lastName}${log.employee.employeeNo ? ` (${log.employee.employeeNo})` : ''}`
          : '',
      ],
    );
  }
}

/**
 * Stream one styled sheet: fixed column widths (auto-sizing would need the
 * whole dataset in memory — and its spread-args trick crashed past ~65k
 * rows), a frozen bold header, then keyset-batched rows committed straight
 * to the output stream.
 */
async function streamWorkbook<T extends { id: string }>(
  out: Writable,
  title: string,
  columns: ColumnDef[],
  fetchBatch: (cursor: string | undefined) => Promise<T[]>,
  toRow: (row: T) => Array<string | number>,
): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  // The streaming writer takes views at creation time (read-only afterwards).
  const sheet = wb.addWorksheet(title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = columns.map((c) => ({ header: c.header, width: c.width }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  header.commit();

  let cursor: string | undefined;
  for (;;) {
    const batch = await fetchBatch(cursor);
    for (const row of batch) sheet.addRow(toRow(row)).commit();
    if (batch.length < EXPORT_BATCH) break;
    cursor = batch[batch.length - 1]?.id;
  }

  sheet.commit();
  await wb.commit();
}

