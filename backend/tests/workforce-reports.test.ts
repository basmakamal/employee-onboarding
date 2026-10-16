/**
 * Workforce and payroll reports: attendance counted per person, the payroll
 * register's columns per earning / deduction, the month-to-month variance
 * (new and missing people included), and the bank list — full IBANs, held
 * people left out, every export audited without the numbers.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkforceReportsService } from '../src/modules/reports/workforce-reports.service.js';
import { configureFieldCrypto, FieldCrypto } from '../src/common/field-crypto.js';

const emp = (id: string, first: string, extra: object = {}) => ({ id, firstName: first, lastName: 'X', employeeNo: `EMP-${id}`, orgUnit: { nameAr: 'ق', nameEn: 'Dept' }, ...extra });
const item = (kind: string, code: string, amount: number, sortOrder = 10) => ({ kind, code, labelEn: code, labelAr: code, amount, sortOrder });

afterEach(() => configureFieldCrypto(undefined));

describe('attendance summary', () => {
  it('counts each person\'s days, lateness and approved overtime', async () => {
    const db = {
      employee: { findMany: vi.fn().mockResolvedValue([emp('1', 'Omar')]) },
      attendanceDay: {
        findMany: vi.fn().mockResolvedValue([
          { employeeId: '1', status: 'PRESENT', lateMinutes: 25, earlyLeaveMinutes: 0, overtimeMinutes: 15, workedMinutes: 420, review: 'CONFIRMED' },
          { employeeId: '1', status: 'ABSENT', lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0, review: 'EXCUSED' },
          { employeeId: '1', status: 'LEAVE', lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0, review: 'NONE' },
          { employeeId: '1', status: 'REST', lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0, review: 'NONE' },
        ]),
      },
      overtimeRequest: { findMany: vi.fn().mockResolvedValue([{ employeeId: '1', approvedMinutes: 10, minutes: 15 }]) },
    };
    const svc = new WorkforceReportsService(db as never, { append: vi.fn() } as never);
    const r = await svc.attendanceSummary('co', undefined, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.rows[0]).toMatchObject({ workingDays: 3, present: 1, absent: 1, leave: 1, lateDays: 1, lateMinutes: 25, overtimeRecorded: 15, overtimeApproved: 10, confirmed: 1, excused: 1 });
  });
});

const RUN = {
  id: 'r2', month: '2026-11', status: 'APPROVED', gross: 12000, deductions: 300, net: 11700,
  lines: [
    { employeeId: '1', held: false, gross: 10500, deductions: 300, net: 10200, employee: emp('1', 'Omar', { iban: null }), items: [item('EARNING', 'BASIC', 8000), item('EARNING', 'HOUSING', 2500, 20), item('DEDUCTION', 'LOAN', 300, 65)] },
    { employeeId: '2', held: false, gross: 1500, deductions: 0, net: 1500, employee: emp('2', 'Nora', { iban: null }), items: [item('EARNING', 'BASIC', 1500)] },
    { employeeId: '3', held: true, gross: 0, deductions: 0, net: 0, employee: emp('3', 'Sara', { iban: null }), items: [] },
  ],
};
const PREV = { month: '2026-10', net: 10500, lines: [
  { employeeId: '1', net: 10000, employee: emp('1', 'Omar'), items: [item('EARNING', 'BASIC', 8000), item('EARNING', 'HOUSING', 2000, 20)] },
  { employeeId: '4', net: 500, employee: emp('4', 'Ali'), items: [item('EARNING', 'BASIC', 500)] },
] };

function payrollService(run: object, prev: object | null = PREV) {
  const audit = { append: vi.fn() };
  const db = { payrollRun: { findFirst: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(prev) } };
  return { svc: new WorkforceReportsService(db as never, audit as never), audit };
}

describe('payroll register', () => {
  it('one column per earning and deduction, totals at the bottom', async () => {
    const sheet = await payrollService(RUN).svc.registerSheet('co', 'r2');
    expect(sheet.columns.map((c) => c.header)).toEqual(['Employee No', 'Name', 'Department', 'BASIC', 'HOUSING', 'Gross', '− LOAN', 'Total deductions', 'Net', 'Held']);
    expect(sheet.rows[0]).toEqual(['EMP-1', 'Omar X', 'Dept', 8000, 2500, 10500, 300, 300, 10200, '']);
    expect(sheet.rows.at(-1)).toContain(11700);
  });
});

describe('variance against the previous month', () => {
  it('shows the difference, who is new, who is missing, and which items changed', async () => {
    const v = await payrollService(RUN).svc.variance('co', 'r2');
    const omar = v.rows.find((r) => r.employee.id === '1')!;
    expect(omar).toMatchObject({ previousNet: 10000, net: 10200, difference: 200, percent: 2, status: 'BOTH' });
    expect(omar.changed.sort()).toEqual(['HOUSING', 'LOAN']);
    expect(v.rows.find((r) => r.employee.id === '2')).toMatchObject({ status: 'NEW' });
    expect(v.rows.find((r) => r.employee.id === '4')).toMatchObject({ status: 'MISSING', previousNet: 500 });
    expect(v.rows.some((r) => r.employee.id === '3')).toBe(false); // held
  });
});

describe('bank transfer list', () => {
  it('full IBANs of the people paid, the total, and an audit entry without the numbers', async () => {
    const key = randomBytes(32).toString('base64');
    configureFieldCrypto(key);
    const enc = new FieldCrypto(key).encrypt('SA0380000000608010167519');
    const run = { ...RUN, lines: RUN.lines.map((l) => (l.employeeId === '1' ? { ...l, employee: { ...l.employee, iban: enc } } : l)) };
    const { svc, audit } = payrollService(run);
    const sheet = await svc.bankSheet('co', 'r2', { type: 'USER', id: 'u-pay' });
    expect(sheet.rows[0]).toEqual(['EMP-1', 'Omar X', 'SA0380000000608010167519', 10200, '']);
    expect(sheet.rows[1]).toEqual(['EMP-2', 'Nora X', '', 1500, 'NO IBAN — pay separately']);
    expect(sheet.rows).toHaveLength(3); // two paid + total; the held one is not there
    const logged = audit.append.mock.calls[0]![0];
    expect(logged).toMatchObject({ action: 'BANK_LIST_EXPORTED', metadata: { employees: 2, withoutIban: 1 } });
    expect(JSON.stringify(logged)).not.toContain('SA03');
  });

  it('only for an approved run', async () => {
    await expect(payrollService({ ...RUN, status: 'CALCULATED' }).svc.bankSheet('co', 'r2', { type: 'USER' })).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  });
});
