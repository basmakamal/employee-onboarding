import { randomUUID } from 'node:crypto';
import type { Employee, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Actor, TransitionEvent } from '../../workflow/engine.js';
import { actorScope } from '../../auth/authz/authorize.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import { logger } from '../../common/logger.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { EmployeeRepository } from './employee.repository.js';
import { resolvePlacement, type PlacementLookups } from './org-placement.js';
import { EmploymentEventRepository, type EmploymentEventRow } from './employment-event.repository.js';

/** A label snapshot: enough to read the history after the unit / title is renamed or removed. */
export interface Snap {
  id?: string | null;
  code?: string | null;
  ar?: string | null;
  en?: string | null;
}

/** A transfer / promotion as HR enters it. */
export interface ChangeInput {
  /** YYYY-MM-DD, the company's local date the change takes effect. */
  effectiveDate: string;
  orgUnitId?: string | null | undefined;
  positionId?: string | null | undefined;
  managerId?: string | null | undefined;
  reason?: string | undefined;
}

/** The profile fields whose changes are history. */
interface Tracked {
  orgUnitId?: string | null | undefined;
  positionId?: string | null | undefined;
  managerId?: string | null | undefined;
  employmentType?: string | null | undefined;
  hireDate?: Date | null | undefined;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-01" in a company's time zone, for an instant. */
export function localDay(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** A local day as the DATE column stores it. */
export function dayValue(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

const asJson = (v: Snap | Record<string, unknown> | null | undefined) =>
  (v ?? undefined) as Prisma.InputJsonValue | undefined;

/**
 * Employment history: the dated record of where someone worked, under whom,
 * in which role and status. Three ways in:
 *
 *   1. an ordinary profile edit — recorded as applied today, inside the same
 *      transaction as the edit;
 *   2. a transfer / promotion with an effective date — applied at once when
 *      the date is today or earlier, otherwise kept as SCHEDULED and applied
 *      by the scheduler on that local date (re-validated then);
 *   3. a status change of the employee machine (hired, ended, withdrawn…).
 *
 * Every employee's history starts with an OPENING entry: a snapshot of where
 * they stood when history began, so earlier changes are never invented.
 */
export class EmploymentHistoryService {
  private tz = new Map<string, string>();

  constructor(
    private readonly db: PrismaClient,
    private readonly repo: EmploymentEventRepository,
    private readonly employees: Pick<EmployeeRepository, 'findById'> & PlacementLookups,
    private readonly audit: AuditLogRepository,
  ) {}

  // ─────────────────────────────────────────────────────────── helpers

  private async timezone(companyId: string): Promise<string> {
    const hit = this.tz.get(companyId);
    if (hit) return hit;
    const row = await this.db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    const zone = row?.timezone ?? 'Asia/Riyadh';
    this.tz.set(companyId, zone);
    return zone;
  }

  /** Today in the company's own time zone. */
  async today(companyId: string, now: Date = new Date()): Promise<string> {
    return localDay(await this.timezone(companyId), now);
  }

  private async unitSnap(companyId: string, id: string | null | undefined): Promise<Snap | null> {
    if (!id) return null;
    const u = await this.db.orgUnit.findFirst({ where: { id, companyId }, select: { id: true, code: true, nameAr: true, nameEn: true } });
    return u ? { id: u.id, code: u.code, ar: u.nameAr, en: u.nameEn } : { id };
  }

  private async positionSnap(companyId: string, id: string | null | undefined): Promise<Snap | null> {
    if (!id) return null;
    const p = await this.db.position.findFirst({ where: { id, companyId }, select: { id: true, code: true, titleAr: true, titleEn: true } });
    return p ? { id: p.id, code: p.code, ar: p.titleAr, en: p.titleEn } : { id };
  }

  private async managerSnap(companyId: string, id: string | null | undefined): Promise<Snap | null> {
    if (!id) return null;
    const m = await this.db.employee.findFirst({ where: { id, companyId }, select: { id: true, firstName: true, lastName: true } });
    const name = m ? `${m.firstName} ${m.lastName}`.trim() : null;
    return { id, ar: name, en: name };
  }

  /** The snapshot written as an employee's first history entry. */
  private async opening(e: Employee): Promise<EmploymentEventRow | null> {
    if (!e.companyId) return null;
    const tz = await this.timezone(e.companyId);
    const start = e.hireDate ?? e.createdAt;
    return {
      companyId: e.companyId,
      employeeId: e.id,
      category: 'OPENING',
      newValue: asJson({
        orgUnit: await this.unitSnap(e.companyId, e.orgUnitId),
        position: await this.positionSnap(e.companyId, e.positionId),
        manager: await this.managerSnap(e.companyId, e.managerId),
        status: e.status,
        employmentType: e.employmentType,
        hireDate: e.hireDate ? localDay(tz, e.hireDate) : null,
      }),
      effectiveDate: dayValue(localDay(tz, start)),
      status: 'APPLIED',
      appliedAt: new Date(),
      batchId: randomUUID(),
      reason: 'History started',
    };
  }

  /** Writes the opening entry when the employee has no history yet. */
  private async openIfMissing(e: Employee): Promise<void> {
    if ((await this.repo.countForEmployee(e.id)) > 0) return;
    const row = await this.opening(e);
    if (row) await this.repo.createMany([row]);
  }

  /** Old → new rows for the tracked fields that actually change. */
  private async diff(
    before: Employee,
    after: Tracked,
    base: Omit<EmploymentEventRow, 'category' | 'oldValue' | 'newValue'>,
  ): Promise<EmploymentEventRow[]> {
    const companyId = before.companyId as string;
    const rows: EmploymentEventRow[] = [];
    const add = (category: string, oldValue: unknown, newValue: unknown) =>
      rows.push({ ...base, category, oldValue: asJson(oldValue as Snap), newValue: asJson(newValue as Snap) });

    if (after.orgUnitId !== undefined && (after.orgUnitId ?? null) !== before.orgUnitId) {
      add('ORG_UNIT', await this.unitSnap(companyId, before.orgUnitId), await this.unitSnap(companyId, after.orgUnitId));
    }
    if (after.positionId !== undefined && (after.positionId ?? null) !== before.positionId) {
      add('POSITION', await this.positionSnap(companyId, before.positionId), await this.positionSnap(companyId, after.positionId));
    }
    if (after.managerId !== undefined && (after.managerId ?? null) !== before.managerId) {
      add('MANAGER', await this.managerSnap(companyId, before.managerId), await this.managerSnap(companyId, after.managerId));
    }
    if (after.employmentType !== undefined && after.employmentType !== null && after.employmentType !== before.employmentType) {
      add('EMPLOYMENT_TYPE', { code: before.employmentType }, { code: after.employmentType });
    }
    if (after.hireDate !== undefined) {
      const tz = await this.timezone(companyId);
      const was = before.hireDate ? localDay(tz, before.hireDate) : null;
      const now = after.hireDate ? localDay(tz, after.hireDate) : null;
      if (was !== now) add('HIRE_DATE', { code: was }, { code: now });
    }
    return rows;
  }

  // ─────────────────────────────────────────────────── profile edits

  /**
   * History rows for an ordinary profile edit (effective today). The caller
   * writes them inside the edit's own transaction; the opening entry, when
   * still missing, is written first so the edit has something to follow.
   */
  async draftsForEdit(before: Employee, after: Tracked, actor: Actor): Promise<EmploymentEventRow[]> {
    if (!before.companyId) return [];
    const now = new Date();
    const rows = await this.diff(before, after, {
      companyId: before.companyId,
      employeeId: before.id,
      effectiveDate: dayValue(await this.today(before.companyId, now)),
      status: 'APPLIED',
      appliedAt: now,
      batchId: randomUUID(),
      reason: 'Profile edit',
      createdById: actor.id ?? null,
      approvedById: actor.id ?? null,
      approvedAt: actor.id ? now : null,
    });
    if (rows.length > 0) await this.openIfMissing(before);
    return rows;
  }

  // ──────────────────────────────────────────── transfers & promotions

  /**
   * A transfer / promotion / new manager with an effective date. Validated
   * now against the actor's company and scope; applied at once when the date
   * has arrived, otherwise scheduled. The person entering it is recorded as
   * the approver (the approvals inbox comes in a later phase).
   */
  async schedule(employeeId: string, input: ChangeInput, actor: Actor) {
    if (!DAY_RE.test(input.effectiveDate)) {
      throw new GuardFailedError('BAD_DATE', 'the effective date must be a date', 'effectiveDate');
    }
    const before = await this.employees.findById(employeeId, actorScope(actor));
    if (!before || !before.companyId) throw new NotFoundError('employee', employeeId);

    const placement = await resolvePlacement(this.employees, actor, input, { selfId: employeeId });
    const now = new Date();
    const today = await this.today(before.companyId, now);
    const immediate = input.effectiveDate <= today;
    const rows = await this.diff(before, placement, {
      companyId: before.companyId,
      employeeId,
      effectiveDate: dayValue(input.effectiveDate),
      status: immediate ? 'APPLIED' : 'SCHEDULED',
      appliedAt: immediate ? now : null,
      batchId: randomUUID(),
      reason: input.reason?.trim() || null,
      createdById: actor.id ?? null,
      approvedById: actor.id ?? null,
      approvedAt: actor.id ? now : null,
    });
    if (rows.length === 0) {
      throw new GuardFailedError('NO_CHANGE', 'nothing would change — pick a different branch, title or manager');
    }
    await this.openIfMissing(before);

    const { companyId: _company, ...fields } = placement;
    void _company;
    await this.db.$transaction(async (tx) => {
      await new EmploymentEventRepository(tx).createMany(rows);
      if (immediate) {
        const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        await tx.employee.update({ where: { id: employeeId }, data: data as Prisma.EmployeeUncheckedUpdateInput });
      }
    });
    await this.audit.append({
      entity: 'EMPLOYEE',
      entityId: employeeId,
      action: immediate ? 'EMPLOYMENT_CHANGED' : 'EMPLOYMENT_CHANGE_SCHEDULED',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId,
      companyId: before.companyId,
      metadata: { batchId: rows[0]!.batchId, effectiveDate: input.effectiveDate, categories: rows.map((r) => r.category) },
    });
    return { batchId: rows[0]!.batchId, status: immediate ? 'APPLIED' : 'SCHEDULED', effectiveDate: input.effectiveDate };
  }

  /** Withdraw a change that has not taken effect yet. */
  async cancel(employeeId: string, batchId: string, actor: Actor): Promise<void> {
    const employee = await this.employees.findById(employeeId, actorScope(actor));
    if (!employee) throw new NotFoundError('employee', employeeId);
    const rows = await this.repo.batch(batchId);
    if (rows.length === 0 || rows[0]!.employeeId !== employeeId) throw new NotFoundError('change', batchId);
    const moved = await this.repo.moveBatch(batchId, 'SCHEDULED', { status: 'CANCELLED' });
    if (!moved) throw new GuardFailedError('NOT_SCHEDULED', 'only a change that has not taken effect can be cancelled');
    await this.audit.append({
      entity: 'EMPLOYEE',
      entityId: employeeId,
      action: 'EMPLOYMENT_CHANGE_CANCELLED',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId,
      companyId: employee.companyId,
      metadata: { batchId },
    });
  }

  /**
   * Scheduler hook: apply every scheduled change whose date has arrived in
   * its company's time zone. Each change is re-checked (the unit may have
   * closed since); one that no longer fits is marked FAILED with the reason
   * and left for HR, never half-applied.
   */
  async applyDue(now: Date = new Date()): Promise<number> {
    // Tomorrow in UTC covers every time zone ahead of UTC; each row is checked against its own company's day.
    const horizon = new Date(now.getTime() + 36 * 3_600_000);
    const due = await this.repo.dueScheduled(horizon);
    const batches = new Map<string, typeof due>();
    for (const row of due) batches.set(row.batchId, [...(batches.get(row.batchId) ?? []), row]);

    let applied = 0;
    for (const [batchId, rows] of batches) {
      const first = rows[0]!;
      const today = await this.today(first.companyId, now);
      if (first.effectiveDate.toISOString().slice(0, 10) > today) continue;
      try {
        if (await this.applyBatch(batchId, rows, now)) applied += 1;
      } catch (err) {
        logger.error({ err, batchId }, 'scheduled employment change failed');
      }
    }
    if (applied > 0) logger.info({ applied }, 'scheduled employment changes applied');
    return applied;
  }

  private async applyBatch(batchId: string, rows: Awaited<ReturnType<EmploymentEventRepository['batch']>>, now: Date): Promise<boolean> {
    const first = rows[0]!;
    const employee = await this.employees.findById(first.employeeId);
    if (!employee || employee.companyId !== first.companyId) {
      return this.repo.moveBatch(batchId, 'SCHEDULED', { status: 'FAILED', failReason: 'employee not found in this company' });
    }
    const data: Record<string, string | null> = {};
    const problems: string[] = [];
    for (const row of rows) {
      const target = (row.newValue as Snap | null)?.id ?? null;
      if (row.category === 'ORG_UNIT') {
        const unit = target ? await this.employees.findOrgUnit(first.companyId, target) : null;
        if (target && (!unit || !unit.active)) problems.push('the branch or department is closed');
        data['orgUnitId'] = target;
        data['department'] = unit?.nameEn ?? null;
      } else if (row.category === 'POSITION') {
        const position = target ? await this.employees.findPosition(first.companyId, target) : null;
        if (target && (!position || !position.active)) problems.push('the job title is inactive');
        data['positionId'] = target;
        data['jobTitle'] = position?.titleEn ?? null;
      } else if (row.category === 'MANAGER') {
        const manager = target ? await this.employees.findColleague(first.companyId, target) : null;
        if (target && !manager) problems.push('the manager is no longer in this company');
        data['managerId'] = target;
        data['directManager'] = manager ? `${manager.firstName} ${manager.lastName}`.trim() : null;
      }
    }
    if (problems.length > 0) {
      return this.repo.moveBatch(batchId, 'SCHEDULED', { status: 'FAILED', failReason: problems.join('; ').slice(0, 190) });
    }

    // Old values are re-read now: what the person had on the day it took effect.
    const fresh = await this.diff(employee, data as Tracked, {
      companyId: first.companyId,
      employeeId: employee.id,
      effectiveDate: first.effectiveDate,
      status: 'APPLIED',
      batchId,
    });
    const won = await this.db.$transaction(async (tx) => {
      const repo = new EmploymentEventRepository(tx);
      if (!(await repo.moveBatch(batchId, 'SCHEDULED', { status: 'APPLIED', appliedAt: now }))) return false;
      for (const row of rows) {
        const match = fresh.find((f) => f.category === row.category);
        if (match) await repo.updateOldValue(row.id, match.oldValue);
      }
      await tx.employee.update({ where: { id: employee.id }, data });
      return true;
    });
    if (won) {
      await this.audit.append({
        entity: 'EMPLOYEE',
        entityId: employee.id,
        action: 'EMPLOYMENT_CHANGED',
        actorType: 'SYSTEM',
        employeeId: employee.id,
        companyId: first.companyId,
        metadata: { batchId, scheduled: true },
      });
    }
    return won;
  }

  // ──────────────────────────────────────────────────── status changes

  /** Engine hook: a status change of the employee machine is history too. */
  async recordStatus(event: TransitionEvent): Promise<void> {
    if (event.entity !== 'EMPLOYEE' || event.from === event.to) return;
    const employee = await this.employees.findById(event.entityId);
    if (!employee?.companyId) return;
    await this.openIfMissing(employee);
    const now = new Date();
    await this.repo.createMany([
      {
        companyId: employee.companyId,
        employeeId: employee.id,
        category: 'STATUS',
        oldValue: asJson({ code: event.from }),
        newValue: asJson({ code: event.to }),
        effectiveDate: dayValue(await this.today(employee.companyId, now)),
        status: 'APPLIED',
        appliedAt: now,
        batchId: randomUUID(),
        reason: event.action,
      },
    ]);
  }

  // ─────────────────────────────────────────────────────────── reads

  /** One employee's history (scope-checked), opening entry included. */
  async list(employeeId: string, actor: Actor) {
    const employee = await this.employees.findById(employeeId, actorScope(actor));
    if (!employee) throw new NotFoundError('employee', employeeId);
    await this.openIfMissing(employee);
    return this.repo.listForEmployee(employeeId);
  }

  /** The company's transfers / promotions, limited to the employees the actor may see. */
  listCompany(
    companyId: string,
    employeeWhere: Prisma.EmployeeWhereInput,
    filter: { status?: string | undefined; from?: string | undefined; to?: string | undefined },
  ) {
    return this.repo.listCompany(
      {
        companyId,
        employee: employeeWhere,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.from || filter.to
          ? {
              effectiveDate: {
                ...(filter.from ? { gte: dayValue(filter.from) } : {}),
                ...(filter.to ? { lte: dayValue(filter.to) } : {}),
              },
            }
          : {}),
      },
      300,
    );
  }

  /** Boot: every placed employee without history gets the opening entry. */
  async ensureOpenings(): Promise<number> {
    let written = 0;
    for (;;) {
      const batch = await this.repo.employeesWithoutHistory(200);
      if (batch.length === 0) break;
      const rows = (await Promise.all(batch.map((e) => this.opening(e)))).filter((r): r is EmploymentEventRow => !!r);
      await this.repo.createMany(rows);
      written += rows.length;
      if (batch.length < 200) break;
    }
    if (written > 0) logger.info({ written }, 'employment history opened');
    return written;
  }
}
