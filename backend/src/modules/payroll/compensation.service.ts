import type { PayComponent, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { localDay } from '../employees/employment-history.service.js';
import { hourlyRates, resolvePackage, type ComponentDef, type LineInput } from './compensation-calc.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayValue = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));

/** The usual Saudi package — amounts are entered per employee; no percentage is assumed. */
export const DEFAULT_COMPONENTS: Array<Omit<Prisma.PayComponentCreateManyInput, 'companyId'>> = [
  { code: 'BASIC', nameAr: 'الراتب الأساسي', nameEn: 'Basic salary', kind: 'EARNING', method: 'FIXED', gosiBase: true, hourlyBase: true, prorated: true, sortOrder: 10 },
  { code: 'HOUSING', nameAr: 'بدل السكن', nameEn: 'Housing allowance', kind: 'EARNING', method: 'FIXED', gosiBase: true, hourlyBase: true, prorated: true, sortOrder: 20 },
  { code: 'TRANSPORT', nameAr: 'بدل النقل', nameEn: 'Transport allowance', kind: 'EARNING', method: 'FIXED', gosiBase: false, hourlyBase: true, prorated: true, sortOrder: 30 },
  { code: 'OTHER', nameAr: 'بدلات أخرى', nameEn: 'Other allowances', kind: 'EARNING', method: 'FIXED', gosiBase: false, hourlyBase: true, prorated: true, sortOrder: 40 },
];

export interface ComponentInput {
  code: string;
  nameAr: string;
  nameEn: string;
  kind: 'EARNING' | 'DEDUCTION';
  method: 'FIXED' | 'PERCENT_OF_BASIC';
  defaultPercent?: number | null | undefined;
  gosiBase?: boolean | undefined;
  prorated?: boolean | undefined;
  hourlyBase?: boolean | undefined;
  sortOrder?: number | undefined;
  active?: boolean | undefined;
}
export interface PolicyInput {
  effectiveFrom: string;
  cutoffDay: number;
  payDay: number;
  proration: 'WORKING_DAYS' | 'CALENDAR_DAYS' | 'THIRTY_DAYS';
  rateDaysPerMonth: number;
  hoursPerDay: number;
  overtimePremiumPct: number;
  gosiSaudiEmployeePct?: number | null | undefined;
  gosiSaudiEmployerPct?: number | null | undefined;
  gosiNonSaudiEmployerPct?: number | null | undefined;
  gosiWageCap?: number | null | undefined;
  roundingDecimals: number;
  note?: string | undefined;
}
export interface CompensationInput {
  effectiveFrom: string;
  lines: LineInput[];
  reason?: string | undefined;
}

const toDef = (c: PayComponent): ComponentDef => ({
  id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, kind: c.kind, method: c.method,
  gosiBase: c.gosiBase, hourlyBase: c.hourlyBase, prorated: c.prorated, sortOrder: c.sortOrder,
});

/**
 * Compensation: the pay components of a company, its payroll policy
 * (versioned by date), and each employee's pay as effective-dated versions.
 * Salary is confidential — the audit trail records THAT pay changed and from
 * when, never the amounts (branch managers may read the audit trail).
 */
export class CompensationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditLogRepository,
  ) {}

  private log(companyId: string, actor: Actor, entity: string, entityId: string, action: string, metadata: Record<string, string | number | boolean | null>, employeeId?: string) {
    return this.audit.append({
      entity, entityId, action, actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      ...(employeeId ? { employeeId } : {}),
      companyId, metadata,
    });
  }

  private async today(companyId: string) {
    const c = await this.db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return localDay(c?.timezone ?? 'Asia/Riyadh');
  }

  // ─────────────────────────────────────────────────────────── components

  async listComponents(companyId: string) {
    if ((await this.db.payComponent.count({ where: { companyId } })) === 0) {
      await this.db.payComponent.createMany({ data: DEFAULT_COMPONENTS.map((c) => ({ ...c, companyId, system: true })), skipDuplicates: true });
    }
    return this.db.payComponent.findMany({ where: { companyId }, orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }] });
  }

  private componentData(input: ComponentInput) {
    if (input.method === 'PERCENT_OF_BASIC' && input.defaultPercent != null && (input.defaultPercent < 0 || input.defaultPercent > 100)) {
      throw new GuardFailedError('BAD_PERCENT', 'a percent from 0 to 100', 'defaultPercent');
    }
    return {
      code: input.code.trim().toUpperCase(),
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn.trim(),
      kind: input.kind,
      method: input.method,
      defaultPercent: input.method === 'PERCENT_OF_BASIC' ? (input.defaultPercent ?? null) : null,
      gosiBase: input.kind === 'EARNING' ? (input.gosiBase ?? false) : false,
      prorated: input.prorated ?? true,
      hourlyBase: input.kind === 'EARNING' ? (input.hourlyBase ?? true) : false,
      sortOrder: input.sortOrder ?? 100,
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
  }

  async createComponent(companyId: string, input: ComponentInput, actor: Actor) {
    const data = this.componentData(input);
    if (await this.db.payComponent.findUnique({ where: { companyId_code: { companyId, code: data.code } } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a component with code ${data.code} already exists`, 'code');
    }
    const row = await this.db.payComponent.create({ data: { ...data, companyId } });
    await this.log(companyId, actor, 'PAY_COMPONENT', row.id, 'PAY_COMPONENT_CREATED', { code: row.code });
    return row;
  }

  async updateComponent(companyId: string, id: string, input: ComponentInput, actor: Actor) {
    const existing = await this.db.payComponent.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundError('pay component', id);
    const data = this.componentData(input);
    if (existing.system) data.code = existing.code;
    if (existing.code === 'BASIC') {
      // The basic salary is what everything else is measured against.
      Object.assign(data, { kind: 'EARNING', method: 'FIXED', defaultPercent: null, active: true });
    }
    if (data.code !== existing.code && (await this.db.payComponent.findUnique({ where: { companyId_code: { companyId, code: data.code } } }))) {
      throw new GuardFailedError('DUPLICATE_CODE', `a component with code ${data.code} already exists`, 'code');
    }
    const used = await this.db.employeeCompensationLine.count({ where: { componentId: id } });
    if (used && (data.kind !== existing.kind || data.method !== existing.method)) {
      throw new GuardFailedError('COMPONENT_IN_USE', 'people are paid with this component — its kind and method can no longer change', 'method');
    }
    const row = await this.db.payComponent.update({ where: { id }, data });
    await this.log(companyId, actor, 'PAY_COMPONENT', id, 'PAY_COMPONENT_UPDATED', { code: row.code });
    return row;
  }

  async deleteComponent(companyId: string, id: string, actor: Actor) {
    const existing = await this.db.payComponent.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundError('pay component', id);
    if (existing.system) throw new GuardFailedError('SYSTEM_COMPONENT', 'a built-in component can be switched off, not deleted');
    if (await this.db.employeeCompensationLine.count({ where: { componentId: id } })) {
      throw new GuardFailedError('COMPONENT_IN_USE', 'people are paid with this component — switch it off instead');
    }
    await this.db.payComponent.delete({ where: { id } });
    await this.log(companyId, actor, 'PAY_COMPONENT', id, 'PAY_COMPONENT_DELETED', { code: existing.code });
  }

  // ─────────────────────────────────────────────────────────── policy

  /** The policy versions, newest first — a default one (no GOSI rates) is created the first time. */
  async listPolicies(companyId: string) {
    if ((await this.db.payrollPolicy.count({ where: { companyId } })) === 0) {
      await this.db.payrollPolicy.create({ data: { companyId, effectiveFrom: dayValue('2000-01-01'), note: 'default' } });
    }
    return this.db.payrollPolicy.findMany({ where: { companyId }, orderBy: { effectiveFrom: 'desc' } });
  }

  /** The policy in force on a date. */
  async policyOn(companyId: string, date: string) {
    const all = await this.listPolicies(companyId);
    return all.find((p) => dayOf(p.effectiveFrom) <= date) ?? all[all.length - 1]!;
  }

  /**
   * A policy change takes effect on a date (today or later), so months
   * already paid keep the rules they were paid with. The same date again
   * corrects that version.
   */
  async savePolicy(companyId: string, input: PolicyInput, actor: Actor) {
    if (!DAY_RE.test(input.effectiveFrom)) throw new GuardFailedError('BAD_DATE', 'pick the date the rules apply from', 'effectiveFrom');
    if (input.effectiveFrom < (await this.today(companyId))) {
      throw new GuardFailedError('PAST_DATE', 'rules change from today or a later date — past months keep their rules', 'effectiveFrom');
    }
    if (input.cutoffDay < 1 || input.cutoffDay > 28) throw new GuardFailedError('BAD_DAY', 'a day from 1 to 28', 'cutoffDay');
    if (input.payDay < 1 || input.payDay > 28) throw new GuardFailedError('BAD_DAY', 'a day from 1 to 28', 'payDay');
    const data = {
      cutoffDay: input.cutoffDay,
      payDay: input.payDay,
      proration: input.proration,
      rateDaysPerMonth: input.rateDaysPerMonth,
      hoursPerDay: input.hoursPerDay,
      overtimePremiumPct: input.overtimePremiumPct,
      gosiSaudiEmployeePct: input.gosiSaudiEmployeePct ?? null,
      gosiSaudiEmployerPct: input.gosiSaudiEmployerPct ?? null,
      gosiNonSaudiEmployerPct: input.gosiNonSaudiEmployerPct ?? null,
      gosiWageCap: input.gosiWageCap ?? null,
      roundingDecimals: input.roundingDecimals,
      note: input.note?.trim() || null,
    };
    const row = await this.db.payrollPolicy.upsert({
      where: { companyId_effectiveFrom: { companyId, effectiveFrom: dayValue(input.effectiveFrom) } },
      create: { companyId, effectiveFrom: dayValue(input.effectiveFrom), ...data, createdById: actor.id ?? null },
      update: data,
    });
    await this.log(companyId, actor, 'PAYROLL_POLICY', row.id, 'PAYROLL_POLICY_SAVED', { effectiveFrom: input.effectiveFrom });
    return row;
  }

  // ─────────────────────────────────────────────────────────── employee pay

  /** Every version of someone's pay with its amounts worked out, the one in force marked. */
  async forEmployee(companyId: string, employeeId: string) {
    const [components, versions, today, contract] = await Promise.all([
      this.listComponents(companyId),
      this.db.employeeCompensation.findMany({ where: { employeeId, companyId }, include: { lines: true }, orderBy: { effectiveFrom: 'desc' } }),
      this.today(companyId),
      this.db.contract.findUnique({ where: { employeeId }, select: { details: true } }),
    ]);
    const defs = components.map(toDef);
    const policy = await this.policyOn(companyId, today);
    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(versions.flatMap((v) => [v.createdById, v.updatedById]).filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    });
    const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
    const current = versions.find((v) => dayOf(v.effectiveFrom) <= today) ?? null;
    const rate = { rateDaysPerMonth: policy.rateDaysPerMonth, hoursPerDay: Number(policy.hoursPerDay), overtimePremiumPct: Number(policy.overtimePremiumPct) };
    return {
      today,
      currency: 'SAR',
      /** The salary typed on the contract, as a hint when entering the first package. */
      contractSalary: ((contract?.details ?? {}) as Record<string, unknown>)['salary'] ?? null,
      currentId: current?.id ?? null,
      versions: versions.map((v) => {
        const pkg = resolvePackage(v.lines.map((l) => ({ componentId: l.componentId, amount: num(l.amount), percent: num(l.percent) })), defs);
        return {
          id: v.id,
          effectiveFrom: dayOf(v.effectiveFrom),
          state: dayOf(v.effectiveFrom) > today ? 'SCHEDULED' : v.id === current?.id ? 'CURRENT' : 'PAST',
          reason: v.reason,
          createdBy: name(v.createdById),
          createdAt: v.createdAt,
          updatedBy: name(v.updatedById),
          ...pkg,
          rates: hourlyRates(pkg, rate),
        };
      }),
    };
  }

  /** In force on a date — what payroll will read. */
  async inForce(employeeId: string, date: string) {
    return this.db.employeeCompensation.findFirst({
      where: { employeeId, effectiveFrom: { lte: dayValue(date) } },
      include: { lines: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** Is there pay with a basic salary in force today? (readiness) */
  async hasPayToday(companyId: string, employeeId: string): Promise<boolean> {
    const v = await this.inForce(employeeId, await this.today(companyId));
    if (!v) return false;
    const basic = await this.db.payComponent.findFirst({ where: { companyId, code: 'BASIC' }, select: { id: true } });
    return v.lines.some((l) => l.componentId === basic?.id && Number(l.amount ?? 0) > 0);
  }

  private async validateLines(companyId: string, lines: LineInput[]) {
    const components = await this.listComponents(companyId);
    const byId = new Map(components.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const l of lines) {
      const c = byId.get(l.componentId);
      if (!c) throw new GuardFailedError('BAD_COMPONENT', 'every line must be a pay component of this company', 'lines');
      if (seen.has(c.id)) throw new GuardFailedError('BAD_COMPONENT', `${c.code} appears twice`, 'lines');
      seen.add(c.id);
      if (c.method === 'PERCENT_OF_BASIC') {
        if (l.percent == null || l.percent < 0 || l.percent > 100) throw new GuardFailedError('BAD_PERCENT', `${c.code}: a percent from 0 to 100`, 'lines');
      } else if (l.amount == null || l.amount < 0 || l.amount > 10_000_000) {
        throw new GuardFailedError('BAD_AMOUNT', `${c.code}: enter the monthly amount`, 'lines');
      }
    }
    const basic = components.find((c) => c.code === 'BASIC');
    const basicLine = lines.find((l) => l.componentId === basic?.id);
    if (!basicLine || !basicLine.amount || basicLine.amount <= 0) throw new GuardFailedError('BASIC_REQUIRED', 'enter the basic salary', 'lines');
    // Only what has an amount is stored.
    return lines.filter((l) => (byId.get(l.componentId)!.method === 'PERCENT_OF_BASIC' ? (l.percent ?? 0) > 0 : (l.amount ?? 0) > 0));
  }

  private async checkDate(companyId: string, employeeId: string, effectiveFrom: string) {
    if (!DAY_RE.test(effectiveFrom)) throw new GuardFailedError('BAD_DATE', 'pick the date the pay applies from', 'effectiveFrom');
    const e = await this.db.employee.findFirst({ where: { id: employeeId, companyId }, select: { hireDate: true } });
    if (!e) throw new NotFoundError('employee', employeeId);
    if (e.hireDate && effectiveFrom < dayOf(e.hireDate)) throw new GuardFailedError('BEFORE_HIRE', `employment starts on ${dayOf(e.hireDate)}`, 'effectiveFrom');
  }

  /** A new version of someone's pay from a date (a raise, a new allowance, the starting package). */
  async create(companyId: string, employeeId: string, input: CompensationInput, actor: Actor) {
    await this.checkDate(companyId, employeeId, input.effectiveFrom);
    const lines = await this.validateLines(companyId, input.lines);
    if (await this.db.employeeCompensation.findUnique({ where: { employeeId_effectiveFrom: { employeeId, effectiveFrom: dayValue(input.effectiveFrom) } } })) {
      throw new GuardFailedError('DUPLICATE_DATE', 'a pay change already starts on this date — edit that one instead', 'effectiveFrom');
    }
    const row = await this.db.employeeCompensation.create({
      data: {
        companyId,
        employeeId,
        effectiveFrom: dayValue(input.effectiveFrom),
        reason: input.reason?.trim() || null,
        createdById: actor.id ?? null,
        lines: { create: lines.map((l) => ({ componentId: l.componentId, amount: l.amount ?? null, percent: l.percent ?? null })) },
      },
    });
    // Amounts stay out of the audit trail on purpose.
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'COMPENSATION_CHANGED', { effectiveFrom: input.effectiveFrom, components: lines.length }, employeeId);
    return row;
  }

  /** Correct a change that has not taken effect yet. One already in force is history: add a new change instead. */
  async update(companyId: string, employeeId: string, id: string, input: CompensationInput, actor: Actor) {
    const existing = await this.db.employeeCompensation.findFirst({ where: { id, employeeId, companyId } });
    if (!existing) throw new NotFoundError('pay change', id);
    const today = await this.today(companyId);
    if (dayOf(existing.effectiveFrom) <= today) throw new GuardFailedError('IN_FORCE', 'this pay is already in force — add a new change from a later date instead');
    await this.checkDate(companyId, employeeId, input.effectiveFrom);
    if (input.effectiveFrom <= today) throw new GuardFailedError('PAST_DATE', 'a scheduled change stays in the future', 'effectiveFrom');
    const lines = await this.validateLines(companyId, input.lines);
    const clash = await this.db.employeeCompensation.findUnique({ where: { employeeId_effectiveFrom: { employeeId, effectiveFrom: dayValue(input.effectiveFrom) } } });
    if (clash && clash.id !== id) throw new GuardFailedError('DUPLICATE_DATE', 'a pay change already starts on this date', 'effectiveFrom');
    const row = await this.db.$transaction(async (tx) => {
      await tx.employeeCompensationLine.deleteMany({ where: { compensationId: id } });
      return tx.employeeCompensation.update({
        where: { id },
        data: {
          effectiveFrom: dayValue(input.effectiveFrom),
          reason: input.reason?.trim() || null,
          updatedById: actor.id ?? null,
          lines: { create: lines.map((l) => ({ componentId: l.componentId, amount: l.amount ?? null, percent: l.percent ?? null })) },
        },
      });
    });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'COMPENSATION_CORRECTED', { effectiveFrom: input.effectiveFrom }, employeeId);
    return row;
  }

  async remove(companyId: string, employeeId: string, id: string, actor: Actor) {
    const existing = await this.db.employeeCompensation.findFirst({ where: { id, employeeId, companyId } });
    if (!existing) throw new NotFoundError('pay change', id);
    if (dayOf(existing.effectiveFrom) <= (await this.today(companyId))) {
      throw new GuardFailedError('IN_FORCE', 'pay already in force stays in the history');
    }
    await this.db.employeeCompensation.delete({ where: { id } });
    await this.log(companyId, actor, 'EMPLOYEE', employeeId, 'COMPENSATION_REMOVED', { effectiveFrom: dayOf(existing.effectiveFrom) }, employeeId);
  }
}
