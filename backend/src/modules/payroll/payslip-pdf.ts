/**
 * The payslip as a PDF — one A4 page, English on the left and Arabic on the
 * right of every row with the amount between them, so one document serves
 * both readers. Pure rendering: the data comes in, a Buffer comes out.
 * Fonts: IBM Plex Sans Arabic (OFL), which carries Latin and Arabic.
 */
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { isRtl, visualPieces } from './pdf-text.js';

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve('@ibm/plex-sans-arabic/package.json')), 'fonts', 'complete', 'woff');
const FONTS = { regular: join(FONT_DIR, 'IBMPlexSansArabic-Regular.woff'), bold: join(FONT_DIR, 'IBMPlexSansArabic-SemiBold.woff') };

export interface PayslipRow {
  labelAr: string;
  labelEn: string;
  amount: number;
  /** e.g. "11 of 19 days" / "2 h × 60.42". */
  detail?: string | null;
}
export interface PayslipData {
  company: { nameAr: string; nameEn: string };
  month: string;
  periodFrom: string;
  periodTo: string;
  payDate: string | null;
  employee: {
    name: string;
    employeeNo: string | null;
    department: { ar: string; en: string } | null;
    position: { ar: string; en: string } | null;
    iban: string | null;
  };
  earnings: PayslipRow[];
  deductions: PayslipRow[];
  gross: number;
  totalDeductions: number;
  net: number;
  currency: string;
  generatedAt: Date;
  reference: string;
}

const PAGE = { w: 595.28, h: 841.89, m: 40 };
const COLOR = { ink: '#1d1a2b', muted: '#6b6680', line: '#e2deef', band: '#f3f1fa', accent: '#5b3fd1' };
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthEn = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const monthAr = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dateEn = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

export function renderPayslip(data: PayslipData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.m, info: { Title: `Payslip ${data.month} — ${data.employee.name}`, Author: data.company.nameEn } });
  doc.registerFont('reg', FONTS.regular);
  doc.registerFont('bold', FONTS.bold);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  /** One line of text inside [x, x + width], aligned, Arabic-aware. */
  const text = (value: string, x: number, y: number, width: number, align: 'left' | 'right' | 'center', opts: { bold?: boolean; size?: number; color?: string } = {}) => {
    doc.font(opts.bold ? 'bold' : 'reg').fontSize(opts.size ?? 9.5).fillColor(opts.color ?? COLOR.ink);
    const pieces = visualPieces(value, isRtl(value));
    const total = pieces.reduce((t, p) => t + doc.widthOfString(p), 0);
    let cx = align === 'left' ? x : align === 'right' ? x + width - total : x + (width - total) / 2;
    for (const p of pieces) {
      if (p.trim()) doc.text(p, cx, y, { lineBreak: false });
      cx += doc.widthOfString(p);
    }
  };
  const inner = PAGE.w - PAGE.m * 2;
  const col = { en: PAGE.m, enW: inner * 0.38, amt: PAGE.m + inner * 0.38, amtW: inner * 0.24, ar: PAGE.m + inner * 0.62, arW: inner * 0.38 };
  let y = PAGE.m;

  // ── Header
  doc.rect(0, 0, PAGE.w, 96).fill(COLOR.band);
  text(data.company.nameEn, col.en, y, inner / 2, 'left', { bold: true, size: 13 });
  text(data.company.nameAr, PAGE.m + inner / 2, y, inner / 2, 'right', { bold: true, size: 13 });
  y += 26;
  text(`Payslip — ${monthEn(data.month)}`, col.en, y, inner / 2, 'left', { size: 11, color: COLOR.accent });
  text(`قسيمة راتب — ${monthAr(data.month)}`, PAGE.m + inner / 2, y, inner / 2, 'right', { size: 11, color: COLOR.accent });
  y = 116;

  // ── Who
  const info: Array<[string, string, string]> = [
    ['Employee', data.employee.name, 'الموظف'],
    ['Employee no.', data.employee.employeeNo ?? '—', 'الرقم الوظيفي'],
    ['Department', data.employee.department ? `${data.employee.department.en}` : '—', 'القسم'],
    ['Position', data.employee.position ? data.employee.position.en : '—', 'المسمى الوظيفي'],
    ['Bank account (IBAN)', data.employee.iban ?? '—', 'الحساب البنكي (الآيبان)'],
    ['Attendance period', `${dateEn(data.periodFrom)} – ${dateEn(data.periodTo)}`, 'فترة الحضور'],
    ...(data.payDate ? [['Pay date', dateEn(data.payDate), 'تاريخ الصرف'] as [string, string, string]] : []),
  ];
  for (const [en, value, ar] of info) {
    text(en, col.en, y, col.enW, 'left', { color: COLOR.muted });
    text(value, col.amt - 40, y, col.amtW + 80, 'center', { bold: true });
    text(ar, col.ar, y, col.arW, 'right', { color: COLOR.muted });
    if (en === 'Department' && data.employee.department) text(data.employee.department.ar, col.amt - 40, y + 12, col.amtW + 80, 'center', { size: 8, color: COLOR.muted });
    if (en === 'Position' && data.employee.position) text(data.employee.position.ar, col.amt - 40, y + 12, col.amtW + 80, 'center', { size: 8, color: COLOR.muted });
    y += en === 'Department' || en === 'Position' ? 26 : 17;
  }
  y += 8;

  // ── Tables
  const section = (titleEn: string, titleAr: string, rows: PayslipRow[], totalEn: string, totalAr: string, total: number, sign: string) => {
    doc.rect(PAGE.m, y, inner, 20).fill(COLOR.band);
    text(titleEn, col.en + 8, y + 5, col.enW, 'left', { bold: true });
    text(titleAr, col.ar - 8, y + 5, col.arW, 'right', { bold: true });
    y += 26;
    if (rows.length === 0) {
      text('—', col.amt, y, col.amtW, 'center', { color: COLOR.muted });
      y += 18;
    }
    for (const r of rows) {
      text(r.labelEn, col.en + 8, y, col.enW - 8, 'left');
      text(`${sign}${money(r.amount)}`, col.amt, y, col.amtW, 'center');
      text(r.labelAr, col.ar - 8, y, col.arW, 'right');
      if (r.detail) {
        text(r.detail, col.amt, y + 11, col.amtW, 'center', { size: 7.5, color: COLOR.muted });
        y += 9;
      }
      y += 17;
      doc.moveTo(PAGE.m, y - 4).lineTo(PAGE.w - PAGE.m, y - 4).lineWidth(0.5).strokeColor(COLOR.line).stroke();
    }
    text(totalEn, col.en + 8, y + 2, col.enW, 'left', { bold: true });
    text(`${sign}${money(total)}`, col.amt, y + 2, col.amtW, 'center', { bold: true });
    text(totalAr, col.ar - 8, y + 2, col.arW, 'right', { bold: true });
    y += 30;
  };
  section('Earnings', 'الاستحقاقات', data.earnings, 'Total earnings', 'إجمالي الاستحقاقات', data.gross, '');
  section('Deductions', 'الاستقطاعات', data.deductions, 'Total deductions', 'إجمالي الاستقطاعات', data.totalDeductions, '−');

  // ── Net
  doc.roundedRect(PAGE.m, y, inner, 46, 6).fill(COLOR.accent);
  text('Net pay', col.en + 12, y + 15, col.enW, 'left', { bold: true, size: 13, color: '#ffffff' });
  text(`${money(data.net)} ${data.currency}`, col.amt - 30, y + 14, col.amtW + 60, 'center', { bold: true, size: 15, color: '#ffffff' });
  text('صافي الراتب', col.ar - 12, y + 15, col.arW, 'right', { bold: true, size: 13, color: '#ffffff' });
  y += 66;

  // ── Footer
  const foot = PAGE.h - PAGE.m - 24;
  text('Issued electronically — no signature required.', col.en, foot, inner / 2, 'left', { size: 7.5, color: COLOR.muted });
  text('مستند صادر إلكترونيًا ولا يحتاج إلى توقيع.', PAGE.m + inner / 2, foot, inner / 2, 'right', { size: 7.5, color: COLOR.muted });
  text(`Ref. ${data.reference} · ${data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, PAGE.m, foot + 12, inner, 'center', { size: 7, color: COLOR.muted });

  doc.end();
  return done;
}
