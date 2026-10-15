/**
 * Payslips: right-to-left text in visual order (Arabic words reversed,
 * numbers and Latin kept, brackets mirrored), a real PDF rendered with the
 * Arabic font, and the sending rules — once per person unless resent,
 * nobody held, no e-mail address recorded as such, downloads limited to the
 * run / employee in the address.
 */
import { describe, expect, it, vi } from 'vitest';
import { isRtl, visualPieces } from '../src/modules/payroll/pdf-text.js';
import { renderPayslip } from '../src/modules/payroll/payslip-pdf.js';
import { PayslipService } from '../src/modules/payroll/payslip.service.js';

describe('right-to-left text', () => {
  it('Arabic words read right to left; a number inside stays in reading order', () => {
    expect(visualPieces('قسيمة راتب شهر أكتوبر 2026', true).filter((p) => p.trim())).toEqual(['2026', 'أكتوبر', 'شهر', 'راتب', 'قسيمة']);
  });

  it('Latin inside Arabic keeps its own order, and brackets are mirrored', () => {
    expect(visualPieces('الموظف: Omar Saleh', true).filter((p) => p.trim())).toEqual(['Omar Saleh', 'الموظف:']);
    expect(visualPieces('التأمينات (9.75٪)', true).join('')).toBe('٪(9.75) التأمينات');
  });

  it('plain English is left as it is', () => {
    expect(visualPieces('Basic salary 8,000.00', false)).toEqual(['Basic salary 8,000.00']);
    expect(isRtl('Basic')).toBe(false);
    expect(isRtl('الراتب')).toBe(true);
  });
});

describe('the payslip PDF', () => {
  it('renders one A4 page with the Arabic font embedded', async () => {
    const pdf = await renderPayslip({
      company: { nameAr: 'ريادة', nameEn: 'Riyada' },
      month: '2026-10', periodFrom: '2026-09-26', periodTo: '2026-10-25', payDate: '2026-10-27',
      employee: { name: 'Omar Saleh', employeeNo: 'EMP-0010', department: { ar: 'فريق البرمجيات', en: 'Software Team' }, position: null, iban: 'SA•• •••• 7519' },
      earnings: [{ labelAr: 'الراتب الأساسي', labelEn: 'Basic salary', amount: 8000 }],
      deductions: [{ labelAr: 'التأمينات الاجتماعية', labelEn: 'GOSI', amount: 975, detail: '9.75%' }],
      gross: 8000, totalDeductions: 975, net: 7025, currency: 'SAR', generatedAt: new Date('2026-10-27T08:00:00Z'), reference: 'PS-2026-10-EMP-0010',
    });
    const head = pdf.subarray(0, 5).toString('latin1');
    const body = pdf.toString('latin1');
    expect(head).toBe('%PDF-');
    expect((body.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    expect(body).toMatch(/IBMPlexSansArabic/);
  });
});

const ACTOR = { type: 'USER' as const, id: 'u-hr' };

function service(lines: unknown[], opts: { existingDelivery?: boolean } = {}) {
  const db = {
    payrollRun: { findFirst: vi.fn().mockResolvedValue({ id: 'r1', month: '2026-10', status: 'APPROVED' }) },
    payrollLine: { findMany: vi.fn().mockResolvedValue(lines), findFirst: vi.fn().mockResolvedValue(null) },
    payslip: { findUnique: vi.fn().mockResolvedValue({ id: 's1', employeeId: 'e1', storageKey: 'payslips/x.pdf', month: '2026-10' }) },
    employee: { findUnique: vi.fn().mockResolvedValue({ email: 'omar@example.com', firstName: 'Omar', lastName: 'Saleh', employeeNo: 'EMP-1', preferredLanguage: 'AR' }) },
    payslipDelivery: {
      create: opts.existingDelivery ? vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })) : vi.fn().mockResolvedValue({ id: 'd1' }),
      update: vi.fn(),
    },
  };
  const notifications = { sendDocument: vi.fn().mockResolvedValue({ id: 'n1' }) };
  const svc = new PayslipService(db as never, {} as never, notifications as never, { append: vi.fn() } as never);
  return { svc, db, notifications };
}

describe('sending payslips', () => {
  it('sends to everyone not sent yet, with the PDF attached and no amounts in the mail', async () => {
    const { svc, notifications } = service([{ id: 'l1', employeeId: 'e1', payslip: null }, { id: 'l2', employeeId: 'e2', payslip: { deliveries: [{ id: 'old' }] } }]);
    const r = await svc.send('co', 'r1', { scope: 'ALL' }, ACTOR, { wait: true });
    expect(r).toEqual({ count: 1, skipped: 1 });
    expect(notifications.sendDocument).toHaveBeenCalledTimes(1);
    const [to, template, params, attachment] = notifications.sendDocument.mock.calls[0]!;
    expect(to).toBe('omar@example.com');
    expect(template).toBe('employee.payslip');
    expect(JSON.stringify(params)).not.toMatch(/\d{3,}\.\d{2}/);
    expect(attachment).toMatchObject({ storageKey: 'payslips/x.pdf', contentType: 'application/pdf' });
  });

  it('a delivery already made under the same key is not made twice', async () => {
    const { svc, notifications } = service([{ id: 'l1', employeeId: 'e1', payslip: null }], { existingDelivery: true });
    await svc.send('co', 'r1', { scope: 'ALL' }, ACTOR, { wait: true });
    expect(notifications.sendDocument).not.toHaveBeenCalled();
  });

  it('only held-out-of-the-run people are excluded; one employee can be chosen', async () => {
    const { svc, db } = service([]);
    await svc.send('co', 'r1', { scope: 'EMPLOYEE', employeeId: 'e9' }, ACTOR, { wait: true });
    expect(db.payrollLine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { runId: 'r1', held: false, employeeId: 'e9' } }));
  });

  it('a run that is not approved has no payslips', async () => {
    const { svc, db } = service([]);
    db.payrollRun.findFirst.mockResolvedValue({ id: 'r1', status: 'CALCULATED' });
    await expect(svc.send('co', 'r1', { scope: 'ALL' }, ACTOR)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  });

  it('a download must match the run or employee in the address', async () => {
    const { svc } = service([]);
    await expect(svc.download('co', 'l1', ACTOR, { employeeId: 'someone-else' })).rejects.toMatchObject({ httpStatus: 404 });
  });
});
