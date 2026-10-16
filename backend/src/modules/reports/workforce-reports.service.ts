import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { EmployeeScope } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { fieldCrypto } from '../../common/field-crypto.js';

const dayValue = (d: string) => new Date(`${d}T00:00:00.000Z`);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const r2 = (n: number) => Math.round(n * 100) / 100;
const EMPLOYEE = { select: { id: true, firstName: true, lastName: true, employeeNo: true, orgUnit: { select: { nameAr: true, nameEn: true } } } } as const;
type Emp = { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null };
const fullName = (e: Emp) => `${e.firstName} ${e.lastName}`.trim();

export interface Sheet {
  title: string;
  columns: Array<{ header: string; width: number; money?: boolean }>;
  rows: Array<Array<string | number | null>>;
}

/** Write one or more sheets as an .xlsx straight to the response. */
export async function writeWorkbook(out: Writable, sheets: Sheet[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const sheet = wb.addWorksheet(s.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = s.columns.map((c) => ({ header: c.header, width: c.width, ...(c.money ? { style: { numFmt: '#,##0.00' } } : {}) }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    for (const row of s.rows) sheet.addRow(row);
  }
  await wb.xlsx.write(out);
}

/**
 * Workforce and payroll reports — on screen and as Excel. Every query goes
 * through the actor's scope (a branch manager sees their branches); pay
 * reports need pay permissions, and the bank list (full IBANs) is audited
 * every time it leaves the building.
 */
export class WorkforceReportsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditLogRepository,
  ) {}

  private async unitPath(companyId: string, orgUnitId?: string) {
    if (!orgUnitId) return undefined;
    const u = await this.db.orgUnit.findFirst({ where: { id: orgUnitId, companyId }, select: { path: true } });
    if (!u) throw new GuardFailedError('BAD_ORG_UNIT', 'pick a branch or department of this company', 'orgUnitId');
    return u.path;
  }

  private employeesWhere(companyId: string, scope: EmployeeScope | undefined, path?: string): Prisma.EmployeeWhereInput {
    return { AND: [scope ?? { companyId }, ...(path ? [{ orgUnit: { path: { startsWith: path } } }] : [])] };
  }

  // ─────────────────────────────────────────────────────────── attendance

  /** Per employee over a period: what the judged days and the requests say. */
  async attendanceSummary(companyId: string, scope: EmployeeScope | undefined, q: { from: string; to: string; orgUnitId?: string | undefined }) {
    const path = await this.unitPath(companyId, q.orgUnitId);
    const people = await this.db.employee.findMany({
      where: { AND: [this.employeesWhere(companyId, scope, path), { OR: [{ status: 'ACTIVE' }, { attendanceDays: { some: { date: { gte: dayValue(q.from), lte: dayValue(q.to) } } } }] }] },
      ...EMPLOYEE,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const ids = people.map((p) => p.id);
    const range = { gte: dayValue(q.from), lte: dayValue(q.to) };
    const [days, overtime] = await Promise.all([
      this.db.attendanceDay.findMany({
        where: { employeeId: { in: ids }, date: range },
        select: { employeeId: true, status: true, lateMinutes: true, earlyLeaveMinutes: true, overtimeMinutes: true, workedMinutes: true, review: true },
      }),
      this.db.overtimeRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', date: range }, select: { employeeId: true, approvedMinutes: true, minutes: true } }),
    ]);
    const rows = people.map((p) => {
      const mine = days.filter((d) => d.employeeId === p.id);
      const count = (pred: (d: (typeof mine)[number]) => boolean) => mine.filter(pred).length;
      const sum = (k: 'lateMinutes' | 'earlyLeaveMinutes' | 'overtimeMinutes' | 'workedMinutes') => mine.reduce((t, d) => t + d[k], 0);
      return {
        employee: p,
        workingDays: count((d) => ['PRESENT', 'ABSENT', 'INCOMPLETE', 'LEAVE'].includes(d.status)),
        present: count((d) => d.status === 'PRESENT'),
        absent: count((d) => d.status === 'ABSENT'),
        missingPunch: count((d) => d.status === 'INCOMPLETE'),
        leave: count((d) => d.status === 'LEAVE'),
        lateDays: count((d) => d.lateMinutes > 0),
        lateMinutes: sum('lateMinutes'),
        earlyMinutes: sum('earlyLeaveMinutes'),
        workedMinutes: sum('workedMinutes'),
        overtimeRecorded: sum('overtimeMinutes'),
        overtimeApproved: overtime.filter((o) => o.employeeId === p.id).reduce((t, o) => t + (o.approvedMinutes ?? o.minutes), 0),
        toReview: count((d) => d.review === 'PENDING'),
        confirmed: count((d) => d.review === 'CONFIRMED'),
        excused: count((d) => d.review === 'EXCUSED'),
      };
    });
    return { from: q.from, to: q.to, rows };
  }

  attendanceSheet(data: Awaited<ReturnType<WorkforceReportsService['attendanceSummary']>>): Sheet {
    const h = (m: number) => r2(m / 60);
    return {
      title: `Attendance ${data.from} to ${data.to}`,
      columns: [
        { header: 'Employee No', width: 12 }, { header: 'Name', width: 24 }, { header: 'Department', width: 20 },
        { header: 'Working days', width: 12 }, { header: 'Present', width: 9 }, { header: 'Absent', width: 9 }, { header: 'Missing punch', width: 13 },
        { header: 'On leave', width: 9 }, { header: 'Late days', width: 10 }, { header: 'Late (h)', width: 9 }, { header: 'Left early (h)', width: 13 },
        { header: 'Worked (h)', width: 11 }, { header: 'Overtime recorded (h)', width: 19 }, { header: 'Overtime approved (h)', width: 19 },
        { header: 'To review', width: 10 }, { header: 'Confirmed', width: 10 }, { header: 'Excused', width: 9 },
      ],
      rows: data.rows.map((r) => [
        r.employee.employeeNo, fullName(r.employee), r.employee.orgUnit?.nameEn ?? '',
        r.workingDays, r.present, r.absent, r.missingPunch, r.leave, r.lateDays, h(r.lateMinutes), h(r.earlyMinutes),
        h(r.workedMinutes), h(r.overtimeRecorded), h(r.overtimeApproved), r.toReview, r.confirmed, r.excused,
      ]),
    };
  }

  // ─────────────────────────────────────────────────────────── leave

  /** Balances (types with a balance) and days taken in a year, per employee and type. */
  async leaveReport(companyId: string, scope: EmployeeScope | undefined, q: { year: number; orgUnitId?: string | undefined }) {
    const path = await this.unitPath(companyId, q.orgUnitId);
    const [people, types] = await Promise.all([
      this.db.employee.findMany({ where: { AND: [this.employeesWhere(companyId, scope, path), { status: 'ACTIVE' }] }, ...EMPLOYEE, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
      this.db.leaveType.findMany({ where: { companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, nameAr: true, nameEn: true, balanceMode: true } }),
    ]);
    const ids = people.map((p) => p.id);
    const [balances, taken] = await Promise.all([
      this.db.leaveLedgerEntry.groupBy({ by: ['employeeId', 'leaveTypeId'], where: { employeeId: { in: ids } }, _sum: { days: true } }),
      this.db.leaveRequest.groupBy({
        by: ['employeeId', 'leaveTypeId', 'status'],
        where: { employeeId: { in: ids }, status: { in: ['APPROVED', 'PENDING'] }, startDate: { gte: dayValue(`${q.year}-01-01`), lte: dayValue(`${q.year}-12-31`) } },
        _sum: { days: true },
      }),
    ]);
    const rows = people.map((p) => ({
      employee: p,
      types: types.map((t) => ({
        code: t.code,
        balance: t.balanceMode === 'ACCRUAL' ? r2(num(balances.find((b) => b.employeeId === p.id && b.leaveTypeId === t.id)?._sum.days)) : null,
        taken: r2(num(taken.find((x) => x.employeeId === p.id && x.leaveTypeId === t.id && x.status === 'APPROVED')?._sum.days)),
        pending: r2(num(taken.find((x) => x.employeeId === p.id && x.leaveTypeId === t.id && x.status === 'PENDING')?._sum.days)),
      })),
    }));
    return { year: q.year, types, rows };
  }

  leaveSheet(data: Awaited<ReturnType<WorkforceReportsService['leaveReport']>>): Sheet {
    const columns: Sheet['columns'] = [{ header: 'Employee No', width: 12 }, { header: 'Name', width: 24 }, { header: 'Department', width: 20 }];
    for (const t of data.types) {
      if (t.balanceMode === 'ACCRUAL') columns.push({ header: `${t.nameEn} — balance`, width: 18 });
      columns.push({ header: `${t.nameEn} — taken ${data.year}`, width: 18 }, { header: `${t.nameEn} — waiting`, width: 16 });
    }
    return {
      title: `Leave ${data.year}`,
      columns,
      rows: data.rows.map((r) => [
        r.employee.employeeNo, fullName(r.employee), r.employee.orgUnit?.nameEn ?? '',
        ...r.types.flatMap((t, i) => (data.types[i]!.balanceMode === 'ACCRUAL' ? [t.balance, t.taken, t.pending] : [t.taken, t.pending])),
      ]),
    };
  }

  // ─────────────────────────────────────────────────────────── payroll

  private async run(companyId: string, runId: string) {
    const run = await this.db.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: { lines: { include: { items: { orderBy: { sortOrder: 'asc' } }, employee: { select: { ...EMPLOYEE.select, iban: true } } }, orderBy: { employee: { firstName: 'asc' } } } },
    });
    if (!run) throw new NotFoundError('payroll run', runId);
    return run;
  }

  /** The payroll register: one row per employee, one column per earning and deduction. */
  async registerSheet(companyId: string, runId: string): Promise<Sheet> {
    const run = await this.run(companyId, runId);
    // Columns in the order items appear (by sort order), earnings then deductions.
    const keys = new Map<string, { label: string; kind: string; order: number }>();
    for (const l of run.lines) for (const i of l.items) if (!keys.has(`${i.kind}:${i.code}`)) keys.set(`${i.kind}:${i.code}`, { label: i.labelEn, kind: i.kind, order: i.sortOrder });
    const kindOrder = (k: string) => (k === 'EARNING' ? 0 : k === 'DEDUCTION' ? 1 : 2);
    const cols = [...keys.entries()].sort((a, b) => kindOrder(a[1].kind) - kindOrder(b[1].kind) || a[1].order - b[1].order);
    const at = (kind: string, prefix: string) => cols.filter(([, c]) => c.kind === kind).map(([k, c]) => ({ k, header: `${prefix}${c.label}` }));
    const earn = at('EARNING', '');
    const ded = at('DEDUCTION', '− ');
    const emp = at('EMPLOYER', 'Employer: ');
    const amount = (l: (typeof run.lines)[number], k: string) => r2(l.items.filter((i) => `${i.kind}:${i.code}` === k).reduce((t, i) => t + num(i.amount), 0)) || null;
    return {
      title: `Payroll ${run.month}`,
      columns: [
        { header: 'Employee No', width: 12 }, { header: 'Name', width: 24 }, { header: 'Department', width: 20 },
        ...earn.map((c) => ({ header: c.header, width: 16, money: true })), { header: 'Gross', width: 14, money: true },
        ...ded.map((c) => ({ header: c.header, width: 16, money: true })), { header: 'Total deductions', width: 16, money: true },
        { header: 'Net', width: 14, money: true }, ...emp.map((c) => ({ header: c.header, width: 18, money: true })), { header: 'Held', width: 8 },
      ],
      rows: [
        ...run.lines.map((l) => [
          l.employee.employeeNo, fullName(l.employee), l.employee.orgUnit?.nameEn ?? '',
          ...earn.map((c) => amount(l, c.k)), num(l.gross),
          ...ded.map((c) => amount(l, c.k)), num(l.deductions),
          num(l.net), ...emp.map((c) => amount(l, c.k)), l.held ? 'yes' : '',
        ]),
        ['', 'Total (paid lines)', '', ...earn.map(() => null), num(run.gross), ...ded.map(() => null), num(run.deductions), num(run.net), ...emp.map(() => null), ''],
      ],
    };
  }

  /** Each employee's net against the previous approved month, with who joined and who is missing. */
  async variance(companyId: string, runId: string) {
    const run = await this.run(companyId, runId);
    const prev = await this.db.payrollRun.findFirst({
      where: { companyId, month: { lt: run.month }, status: { in: ['APPROVED', 'PAID'] } },
      orderBy: [{ month: 'desc' }, { version: 'desc' }],
      include: { lines: { where: { held: false }, include: { items: true, employee: EMPLOYEE } } },
    });
    const current = run.lines.filter((l) => !l.held);
    const rows = current.map((l) => {
      const before = prev?.lines.find((p) => p.employeeId === l.employeeId) ?? null;
      const changed = before
        ? [...new Set([...l.items, ...before.items].map((i) => i.code))].filter((code) => {
            const a = r2(l.items.filter((i) => i.code === code).reduce((t, i) => t + num(i.amount), 0));
            const b = r2(before.items.filter((i) => i.code === code).reduce((t, i) => t + num(i.amount), 0));
            return a !== b;
          })
        : [];
      return {
        employee: l.employee,
        previousNet: before ? num(before.net) : null,
        net: num(l.net),
        difference: before ? r2(num(l.net) - num(before.net)) : null,
        percent: before && num(before.net) !== 0 ? r2(((num(l.net) - num(before.net)) / num(before.net)) * 100) : null,
        status: before ? 'BOTH' : 'NEW',
        changed,
      };
    });
    const missing = (prev?.lines ?? [])
      .filter((p) => !current.some((l) => l.employeeId === p.employeeId))
      .map((p) => ({ employee: p.employee, previousNet: num(p.net), net: null, difference: null, percent: null, status: 'MISSING', changed: [] as string[] }));
    return {
      month: run.month,
      previousMonth: prev?.month ?? null,
      totals: { net: num(run.net), previousNet: prev ? num(prev.net) : null, employees: current.length, previousEmployees: prev?.lines.length ?? null },
      rows: [...rows, ...missing].sort((a, b) => Math.abs(b.difference ?? b.previousNet ?? 0) - Math.abs(a.difference ?? a.previousNet ?? 0)),
    };
  }

  varianceSheet(data: Awaited<ReturnType<WorkforceReportsService['variance']>>): Sheet {
    return {
      title: `Variance ${data.month}`,
      columns: [
        { header: 'Employee No', width: 12 }, { header: 'Name', width: 24 }, { header: 'Department', width: 20 },
        { header: `Net ${data.previousMonth ?? 'previous'}`, width: 16, money: true }, { header: `Net ${data.month}`, width: 16, money: true },
        { header: 'Difference', width: 14, money: true }, { header: 'Difference %', width: 12 }, { header: 'Status', width: 10 }, { header: 'Changed items', width: 40 },
      ],
      rows: data.rows.map((r) => [
        r.employee.employeeNo, fullName(r.employee), r.employee.orgUnit?.nameEn ?? '',
        r.previousNet, r.net, r.difference, r.percent, r.status, r.changed.join(', '),
      ]),
    };
  }

  /**
   * The bank transfer list of an approved run — full IBANs and net amounts
   * of everyone paid. Audited on every export (without the numbers).
   */
  async bankSheet(companyId: string, runId: string, actor: Actor): Promise<Sheet> {
    const run = await this.run(companyId, runId);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw new GuardFailedError('NOT_APPROVED', 'the transfer list exists once the run is approved');
    const paid = run.lines.filter((l) => !l.held);
    const missing = paid.filter((l) => !l.employee.iban).length;
    await this.audit.append({
      entity: 'PAYROLL_RUN', entityId: runId, action: 'BANK_LIST_EXPORTED', actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      companyId, metadata: { month: run.month, employees: paid.length, withoutIban: missing },
    });
    return {
      title: `Transfers ${run.month}`,
      columns: [
        { header: 'Employee No', width: 12 }, { header: 'Name', width: 26 }, { header: 'IBAN', width: 30 },
        { header: 'Net amount (SAR)', width: 18, money: true }, { header: 'Note', width: 24 },
      ],
      rows: [
        ...paid.map((l) => {
          const iban = fieldCrypto().decrypt(l.employee.iban);
          return [l.employee.employeeNo, fullName(l.employee), iban ?? '', num(l.net), iban ? '' : 'NO IBAN — pay separately'];
        }),
        ['', `Total — ${paid.length} transfer(s)`, '', r2(paid.reduce((t, l) => t + num(l.net), 0)), missing ? `${missing} without IBAN` : ''],
      ],
    };
  }
}
