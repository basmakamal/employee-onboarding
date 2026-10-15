/**
 * Pay arithmetic — pure functions, no database. Money is handled in halalas
 * (integer hundredths) inside, so 0.1 + 0.2 never becomes 0.30000000000000004;
 * results come back as numbers with two decimals.
 */

export interface ComponentDef {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  kind: string; // EARNING | DEDUCTION
  method: string; // FIXED | PERCENT_OF_BASIC
  gosiBase: boolean;
  hourlyBase: boolean;
  prorated: boolean;
  sortOrder: number;
}
export interface LineInput {
  componentId: string;
  amount?: number | null | undefined;
  percent?: number | null | undefined;
}
export interface ResolvedLine {
  componentId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  kind: string;
  method: string;
  percent: number | null;
  amount: number;
  gosiBase: boolean;
  hourlyBase: boolean;
  prorated: boolean;
}
export interface Package {
  lines: ResolvedLine[];
  basic: number;
  earnings: number;
  deductions: number;
  /** Earnings minus the fixed deductions — before GOSI and anything payroll adds. */
  net: number;
  /** The wage GOSI is calculated on (basic + housing in Saudi Arabia). */
  gosiWage: number;
  /** The wage the hourly rate is worked out from. */
  hourlyWage: number;
}

const toHalalas = (n: number) => Math.round(n * 100);
const fromHalalas = (h: number) => h / 100;

/** The monthly amounts of a package: fixed amounts as entered, percentages of the basic salary. */
export function resolvePackage(lines: LineInput[], components: ComponentDef[]): Package {
  const byId = new Map(components.map((c) => [c.id, c]));
  const basicLine = lines.find((l) => byId.get(l.componentId)?.code === 'BASIC');
  const basicH = toHalalas(basicLine?.amount ?? 0);
  const resolved: Array<ResolvedLine & { h: number }> = [];
  for (const l of lines) {
    const c = byId.get(l.componentId);
    if (!c) continue;
    const h = c.method === 'PERCENT_OF_BASIC' ? Math.round((basicH * (l.percent ?? 0)) / 100) : toHalalas(l.amount ?? 0);
    resolved.push({
      componentId: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, kind: c.kind, method: c.method,
      percent: c.method === 'PERCENT_OF_BASIC' ? (l.percent ?? 0) : null,
      amount: fromHalalas(h), gosiBase: c.gosiBase, hourlyBase: c.hourlyBase, prorated: c.prorated, h,
    });
  }
  resolved.sort((a, b) => (byId.get(a.componentId)!.sortOrder - byId.get(b.componentId)!.sortOrder) || a.code.localeCompare(b.code));
  const sum = (pred: (l: (typeof resolved)[number]) => boolean) => resolved.filter(pred).reduce((s, l) => s + l.h, 0);
  const earnings = sum((l) => l.kind === 'EARNING');
  const deductions = sum((l) => l.kind === 'DEDUCTION');
  return {
    lines: resolved.map(({ h: _h, ...rest }) => rest),
    basic: fromHalalas(basicH),
    earnings: fromHalalas(earnings),
    deductions: fromHalalas(deductions),
    net: fromHalalas(earnings - deductions),
    gosiWage: fromHalalas(sum((l) => l.kind === 'EARNING' && l.gosiBase)),
    hourlyWage: fromHalalas(sum((l) => l.kind === 'EARNING' && l.hourlyBase)),
  };
}

export interface RatePolicy {
  rateDaysPerMonth: number;
  hoursPerDay: number;
  overtimePremiumPct: number;
}

/**
 * Hourly rates from a package. Saudi Labour Law Art. 107: an overtime hour
 * is paid the hourly wage plus a premium (default 50%) of the BASIC hourly
 * wage — not of the whole wage.
 */
export function hourlyRates(pkg: Pick<Package, 'basic' | 'hourlyWage'>, policy: RatePolicy) {
  const hours = policy.rateDaysPerMonth * policy.hoursPerDay;
  if (hours <= 0) return { hourly: 0, basicHourly: 0, overtimeHourly: 0, daily: 0 };
  const hourly = pkg.hourlyWage / hours;
  const basicHourly = pkg.basic / hours;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    hourly: r(hourly),
    basicHourly: r(basicHourly),
    overtimeHourly: r(hourly + (basicHourly * policy.overtimePremiumPct) / 100),
    daily: r(pkg.hourlyWage / policy.rateDaysPerMonth),
  };
}
