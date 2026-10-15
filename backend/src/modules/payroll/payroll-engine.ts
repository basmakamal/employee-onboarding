/**
 * The payroll engine — pure functions, no database. Given one employee's
 * month (pay versions, working days, confirmed attendance exceptions,
 * approved leave / overtime / payments, loan instalments, the policy) it
 * returns the payslip items and totals. Money is added in halalas.
 *
 * Every rule here comes from data: the policy (proration, hourly basis,
 * overtime premium, GOSI rates, Art. 92 limit), the pay components (which
 * are prorated, which count for GOSI and the hourly rate) and the leave
 * types (how much of a leave is paid). Nothing about rates is hard-coded.
 */
import type { Package } from './compensation-calc.js';

export const ENGINE_VERSION = 'F1-2026.10';

export type Proration = 'WORKING_DAYS' | 'CALENDAR_DAYS' | 'THIRTY_DAYS';

export interface EnginePolicy {
  proration: Proration;
  rateDaysPerMonth: number;
  hoursPerDay: number;
  overtimePremiumPct: number;
  gosiSaudiEmployeePct: number | null;
  gosiSaudiEmployerPct: number | null;
  gosiNonSaudiEmployerPct: number | null;
  gosiWageCap: number | null;
  deductionsMaxPct: number | null;
}

/** A stretch of the month paid with one pay version. */
export interface Segment {
  from: string;
  to: string;
  versionId: string;
  pkg: Package;
  /** Working days of the person in [from, to]. */
  workingDays: number;
}

export interface EngineInput {
  month: string;
  daysInMonth: number;
  /** Working days of the person in the whole calendar month (the proration base). */
  monthWorkingDays: number;
  segments: Segment[];
  policy: EnginePolicy;
  saudi: boolean;
  /** Confirmed by HR in the attendance period (only confirmed ones are ever deducted). */
  absentDays: number;
  missingPunchDays: number;
  lateEarlyMinutes: number;
  /** Unpaid parts of approved leave in the period, per leave type. */
  leave: Array<{ code: string; nameAr: string; nameEn: string; days: number; percent: number }>;
  overtimeMinutes: number;
  payments: Array<{ id: string; kind: 'EARNING' | 'DEDUCTION'; category: string; amount: number; labelAr: string; labelEn: string }>;
  instalments: Array<{ id: string; loanId: string; kind: string; amount: number }>;
}

export interface EngineItem {
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER';
  source: 'COMPONENT' | 'OVERTIME' | 'ABSENCE' | 'LATE' | 'LEAVE' | 'LOAN' | 'PAYMENT' | 'GOSI';
  sourceId: string | null;
  code: string;
  labelAr: string;
  labelEn: string;
  quantity: number | null;
  rate: number | null;
  amount: number;
  sortOrder: number;
}

export interface EngineWarning {
  code: 'NO_PAY' | 'NEGATIVE_NET' | 'GOSI_RATES_MISSING' | 'DEDUCTIONS_OVER_LIMIT';
  blocking: boolean;
  detail?: Record<string, number | string>;
}

export interface EngineResult {
  items: EngineItem[];
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  warnings: EngineWarning[];
  inputs: Record<string, unknown>;
}

const h = (n: number) => Math.round(n * 100);
const money = (halalas: number) => halalas / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** The share of a month's amount a segment earns, by the policy's proration. */
export function prorationFactor(seg: Pick<Segment, 'from' | 'to' | 'workingDays'>, input: Pick<EngineInput, 'daysInMonth' | 'monthWorkingDays'>, proration: Proration): number {
  const days = dayCount(seg.from, seg.to);
  if (days >= input.daysInMonth) return 1;
  if (proration === 'CALENDAR_DAYS') return days / input.daysInMonth;
  if (proration === 'THIRTY_DAYS') return Math.min(1, days / 30);
  // Working days (decided): a month with no working day at all is paid in full.
  return input.monthWorkingDays > 0 ? seg.workingDays / input.monthWorkingDays : 1;
}

export function calculate(input: EngineInput): EngineResult {
  const items: EngineItem[] = [];
  const warnings: EngineWarning[] = [];
  const p = input.policy;
  const last = input.segments[input.segments.length - 1];
  if (!last) {
    return { items, gross: 0, deductions: 0, net: 0, employerCost: 0, warnings: [{ code: 'NO_PAY', blocking: true }], inputs: { month: input.month } };
  }

  // ── Earnings from the pay components, prorated per segment where the component says so.
  const factors = input.segments.map((s) => ({ seg: s, factor: prorationFactor(s, input, p.proration) }));
  const byComponent = new Map<string, EngineItem>();
  for (const { seg, factor } of factors) {
    for (const l of seg.pkg.lines) {
      if (l.kind !== 'EARNING' && l.kind !== 'DEDUCTION') continue;
      // A component that is not prorated is paid in full, from the version in force at the end of the month.
      const share = l.prorated ? factor : seg === last ? 1 : 0;
      if (share === 0) continue;
      const amountH = Math.round(h(l.amount) * share);
      const key = `${l.kind}:${l.componentId}`;
      const existing = byComponent.get(key);
      if (existing) existing.amount = money(h(existing.amount) + amountH);
      else {
        byComponent.set(key, {
          kind: l.kind as 'EARNING' | 'DEDUCTION', source: 'COMPONENT', sourceId: l.componentId, code: l.code,
          labelAr: l.nameAr, labelEn: l.nameEn, quantity: null, rate: null, amount: money(amountH), sortOrder: 10,
        });
      }
    }
  }
  items.push(...byComponent.values());

  // ── Rates from the pay in force at the end of the month.
  const hours = p.rateDaysPerMonth * p.hoursPerDay;
  const daily = p.rateDaysPerMonth > 0 ? last.pkg.hourlyWage / p.rateDaysPerMonth : 0;
  const hourly = hours > 0 ? last.pkg.hourlyWage / hours : 0;
  const basicHourly = hours > 0 ? last.pkg.basic / hours : 0;
  const overtimeHourly = hourly + (basicHourly * p.overtimePremiumPct) / 100;

  // ── Overtime (approved only) — Art. 107.
  if (input.overtimeMinutes > 0) {
    const hrs = input.overtimeMinutes / 60;
    items.push({ kind: 'EARNING', source: 'OVERTIME', sourceId: null, code: 'OVERTIME', labelAr: 'العمل الإضافي', labelEn: 'Overtime', quantity: r2(hrs), rate: r4(overtimeHourly), amount: r2(hrs * overtimeHourly), sortOrder: 40 });
  }

  // ── One-off payments (approved for this month).
  for (const pay of input.payments) {
    items.push({
      kind: pay.kind, source: 'PAYMENT', sourceId: pay.id, code: pay.category, labelAr: pay.labelAr, labelEn: pay.labelEn,
      quantity: null, rate: null, amount: r2(pay.amount), sortOrder: pay.kind === 'EARNING' ? 50 : 70,
    });
  }

  // ── Absences and lateness — only what HR confirmed.
  const absent = input.absentDays + input.missingPunchDays;
  if (absent > 0) {
    items.push({ kind: 'DEDUCTION', source: 'ABSENCE', sourceId: null, code: 'ABSENCE', labelAr: 'غياب', labelEn: 'Absence', quantity: absent, rate: r4(daily), amount: r2(absent * daily), sortOrder: 60 });
  }
  if (input.lateEarlyMinutes > 0) {
    items.push({ kind: 'DEDUCTION', source: 'LATE', sourceId: null, code: 'LATE', labelAr: 'تأخير وخروج مبكر', labelEn: 'Lateness and early leave', quantity: input.lateEarlyMinutes, rate: r4(hourly / 60), amount: r2((input.lateEarlyMinutes / 60) * hourly), sortOrder: 61 });
  }

  // ── The unpaid part of approved leave (unpaid leave, sick leave past the paid steps).
  for (const l of input.leave) {
    const unpaidDays = l.days * (1 - l.percent / 100);
    if (unpaidDays <= 0) continue;
    items.push({ kind: 'DEDUCTION', source: 'LEAVE', sourceId: null, code: l.code, labelAr: l.nameAr, labelEn: l.nameEn, quantity: r2(unpaidDays), rate: r4(daily), amount: r2(unpaidDays * daily), sortOrder: 62 });
  }

  // ── Loan and advance instalments due this month.
  for (const i of input.instalments) {
    items.push({
      kind: 'DEDUCTION', source: 'LOAN', sourceId: i.id, code: i.kind,
      labelAr: i.kind === 'ADVANCE' ? 'سلفة' : 'قسط قرض', labelEn: i.kind === 'ADVANCE' ? 'Salary advance' : 'Loan instalment',
      quantity: null, rate: null, amount: r2(i.amount), sortOrder: 65,
    });
  }

  // ── GOSI: on the GOSI wage (capped), for the share of the month employed.
  const employedShare = Math.min(1, factors.reduce((t, f) => t + f.factor, 0));
  const gosiBase = Math.min(last.pkg.gosiWage, p.gosiWageCap ?? Infinity) * employedShare;
  const employeePct = input.saudi ? p.gosiSaudiEmployeePct : null;
  const employerPct = input.saudi ? p.gosiSaudiEmployerPct : p.gosiNonSaudiEmployerPct;
  if (gosiBase > 0) {
    if (input.saudi && employeePct == null) warnings.push({ code: 'GOSI_RATES_MISSING', blocking: false });
    if (!input.saudi && employerPct == null) warnings.push({ code: 'GOSI_RATES_MISSING', blocking: false });
    if (employeePct) {
      items.push({ kind: 'DEDUCTION', source: 'GOSI', sourceId: null, code: 'GOSI', labelAr: 'التأمينات الاجتماعية', labelEn: 'GOSI', quantity: null, rate: employeePct, amount: r2((gosiBase * employeePct) / 100), sortOrder: 80 });
    }
    if (employerPct) {
      items.push({ kind: 'EMPLOYER', source: 'GOSI', sourceId: null, code: 'GOSI_EMPLOYER', labelAr: 'تأمينات — حصة صاحب العمل', labelEn: 'GOSI — employer share', quantity: null, rate: employerPct, amount: r2((gosiBase * employerPct) / 100), sortOrder: 90 });
    }
  }

  const sum = (kind: EngineItem['kind'], pred: (i: EngineItem) => boolean = () => true) =>
    items.filter((i) => i.kind === kind && pred(i)).reduce((t, i) => t + h(i.amount), 0);
  const grossH = sum('EARNING');
  const deductionsH = sum('DEDUCTION');
  const net = money(grossH - deductionsH);

  // Art. 92: loan instalments and penalties together at most a share of the wage.
  const limited = sum('DEDUCTION', (i) => i.source === 'LOAN' || (i.source === 'PAYMENT'));
  if (p.deductionsMaxPct != null && limited > Math.round((grossH * p.deductionsMaxPct) / 100)) {
    warnings.push({ code: 'DEDUCTIONS_OVER_LIMIT', blocking: false, detail: { limit: money(Math.round((grossH * p.deductionsMaxPct) / 100)), total: money(limited) } });
  }
  if (net < 0) warnings.push({ code: 'NEGATIVE_NET', blocking: true });

  items.sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    items,
    gross: money(grossH),
    deductions: money(deductionsH),
    net,
    employerCost: money(sum('EMPLOYER')),
    warnings,
    inputs: {
      month: input.month,
      daysInMonth: input.daysInMonth,
      monthWorkingDays: input.monthWorkingDays,
      segments: factors.map((f) => ({ from: f.seg.from, to: f.seg.to, versionId: f.seg.versionId, workingDays: f.seg.workingDays, factor: r4(f.factor) })),
      rates: { daily: r4(daily), hourly: r4(hourly), overtimeHourly: r4(overtimeHourly) },
      absentDays: input.absentDays,
      missingPunchDays: input.missingPunchDays,
      lateEarlyMinutes: input.lateEarlyMinutes,
      overtimeMinutes: input.overtimeMinutes,
      saudi: input.saudi,
      proration: p.proration,
    },
  };
}
