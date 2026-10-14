import type { PrismaClient } from '../../generated/prisma/client.js';
import { scopeWhere, type CompanyContext } from '../../auth/authz/authorize.js';
import type { AssignmentService } from '../../auth/assignment.service.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';

export interface UnitInput {
  parentId?: string | null | undefined;
  type: string;
  code: string;
  nameAr: string;
  nameEn: string;
  managerId?: string | null | undefined;
  active?: boolean | undefined;
}

export interface PositionInput {
  code: string;
  titleAr: string;
  titleEn: string;
  active?: boolean | undefined;
}

const UNIT_SELECT = {
  id: true,
  parentId: true,
  type: true,
  code: true,
  nameAr: true,
  nameEn: true,
  path: true,
  depth: true,
  active: true,
  managerId: true,
  manager: { select: { id: true, name: true, email: true } },
  _count: { select: { children: true, employees: true } },
} as const;

const POSITION_SELECT = {
  id: true,
  code: true,
  titleAr: true,
  titleEn: true,
  active: true,
  _count: { select: { employees: true } },
} as const;

/**
 * The organisation of ONE company: the branch / department tree and the
 * job-title master. Every call runs inside a CompanyContext, so a unit from
 * another company can never become a parent, a manager, or a target.
 *
 * Tree rules, enforced here and nowhere else:
 *   - parent must be an active unit of the same company
 *   - a unit cannot be moved under itself or its own descendants (the
 *     materialised path makes that a prefix check)
 *   - a unit with children, employees or assignments cannot be deleted
 *   - the manager seat and its UNIT_MANAGER assignment move together
 */
export class OrgService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditLogRepository,
    private readonly assignments: AssignmentService,
  ) {}

  // ─────────────────────────────────────────────────────────── units

  /** Flat, ordered by path — the UI folds it into a tree. */
  listUnits(ctx: CompanyContext) {
    return this.db.orgUnit.findMany({ where: { companyId: ctx.companyId }, select: UNIT_SELECT, orderBy: { path: 'asc' } });
  }

  async getUnit(ctx: CompanyContext, id: string) {
    const row = await this.db.orgUnit.findFirst({ where: { id, companyId: ctx.companyId }, select: UNIT_SELECT });
    if (!row) throw new NotFoundError('org unit', id);
    return row;
  }

  async createUnit(ctx: CompanyContext, input: UnitInput) {
    const code = input.code.trim().toUpperCase();
    await this.assertCodeFree(ctx.companyId, code);
    const parent = input.parentId ? await this.getUnit(ctx, input.parentId) : null;
    if (parent && !parent.active) throw new GuardFailedError('PARENT_INACTIVE', 'the parent unit is inactive', 'parentId');
    await this.assertManager(input.managerId);

    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.orgUnit.create({
        data: {
          companyId: ctx.companyId,
          parentId: parent?.id ?? null,
          type: input.type,
          code,
          nameAr: input.nameAr.trim(),
          nameEn: input.nameEn.trim(),
          path: '',
          depth: parent ? parent.depth + 1 : 0,
          managerId: input.managerId ?? null,
          active: input.active ?? true,
        },
      });
      // The path needs the id — set it in the same transaction.
      return tx.orgUnit.update({
        where: { id: created.id },
        data: { path: `${parent?.path ?? '/'}${created.id}/` },
        select: UNIT_SELECT,
      });
    });
    if (input.managerId) {
      await this.assignments.syncManager({ kind: 'UNIT', companyId: ctx.companyId, orgUnitId: row.id }, null, input.managerId, ctx.actor);
    }
    await this.auditUnit(ctx, row.id, 'UNIT_CREATED', { code, parentId: parent?.id ?? '' });
    return row;
  }

  async updateUnit(ctx: CompanyContext, id: string, changes: Partial<UnitInput>) {
    const unit = await this.getUnit(ctx, id);
    const code = changes.code !== undefined ? changes.code.trim().toUpperCase() : unit.code;
    if (code !== unit.code) await this.assertCodeFree(ctx.companyId, code);
    if (changes.managerId !== undefined) await this.assertManager(changes.managerId);

    // Moving: validate the new parent, then rewrite every path in the subtree.
    let newParent: { id: string; path: string; depth: number } | null | undefined;
    if (changes.parentId !== undefined && (changes.parentId ?? null) !== unit.parentId) {
      if (changes.parentId === null) newParent = null;
      else {
        const p = await this.getUnit(ctx, changes.parentId);
        if (p.id === unit.id || p.path.startsWith(unit.path)) {
          throw new GuardFailedError('CYCLE', 'a unit cannot be placed under itself or one of its descendants', 'parentId');
        }
        if (!p.active) throw new GuardFailedError('PARENT_INACTIVE', 'the parent unit is inactive', 'parentId');
        newParent = p;
      }
    }

    const row = await this.db.$transaction(async (tx) => {
      if (newParent !== undefined) {
        const oldPath = unit.path;
        const newPath = `${newParent?.path ?? '/'}${unit.id}/`;
        const depthDelta = (newParent ? newParent.depth + 1 : 0) - unit.depth;
        const subtree = await tx.orgUnit.findMany({
          where: { companyId: ctx.companyId, path: { startsWith: oldPath } },
          select: { id: true, path: true, depth: true },
        });
        for (const node of subtree) {
          await tx.orgUnit.update({
            where: { id: node.id },
            data: { path: newPath + node.path.slice(oldPath.length), depth: node.depth + depthDelta },
          });
        }
        await tx.orgUnit.update({ where: { id: unit.id }, data: { parentId: newParent?.id ?? null } });
      }
      return tx.orgUnit.update({
        where: { id: unit.id },
        data: {
          ...(changes.type !== undefined ? { type: changes.type } : {}),
          code,
          ...(changes.nameAr !== undefined ? { nameAr: changes.nameAr.trim() } : {}),
          ...(changes.nameEn !== undefined ? { nameEn: changes.nameEn.trim() } : {}),
          ...(changes.active !== undefined ? { active: changes.active } : {}),
          ...(changes.managerId !== undefined ? { managerId: changes.managerId ?? null } : {}),
        },
        select: UNIT_SELECT,
      });
    });
    if (changes.managerId !== undefined && (changes.managerId ?? null) !== unit.managerId) {
      await this.assignments.syncManager(
        { kind: 'UNIT', companyId: ctx.companyId, orgUnitId: unit.id },
        unit.managerId,
        changes.managerId ?? null,
        ctx.actor,
      );
    }
    await this.auditUnit(ctx, unit.id, newParent !== undefined ? 'UNIT_MOVED' : 'UNIT_UPDATED', { changes: Object.keys(changes) });
    return row;
  }

  /** Refused while anything still hangs off the unit — the message says what. */
  async deleteUnit(ctx: CompanyContext, id: string) {
    const unit = await this.getUnit(ctx, id);
    const assignments = await this.db.userAssignment.count({ where: { orgUnitId: id } });
    const blockers = [
      unit._count.children ? `${unit._count.children} child unit(s)` : null,
      unit._count.employees ? `${unit._count.employees} employee(s)` : null,
      assignments ? `${assignments} manager/role assignment(s)` : null,
    ].filter(Boolean);
    if (blockers.length) {
      throw new GuardFailedError('UNIT_IN_USE', `this unit still has ${blockers.join(', ')} — move or clear them first`);
    }
    await this.db.orgUnit.delete({ where: { id } });
    await this.auditUnit(ctx, id, 'UNIT_DELETED', { code: unit.code });
  }

  private async assertCodeFree(companyId: string, code: string) {
    const clash = await this.db.orgUnit.findUnique({ where: { companyId_code: { companyId, code } }, select: { id: true } });
    if (clash) throw new GuardFailedError('DUPLICATE_CODE', `a unit with code ${code} already exists in this company`, 'code');
  }

  private async assertManager(userId: string | null | undefined) {
    if (!userId) return;
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { active: true } });
    if (!user || !user.active) throw new GuardFailedError('BAD_MANAGER', 'the manager must be an active staff account', 'managerId');
  }

  private auditUnit(ctx: CompanyContext, unitId: string, action: string, metadata: Record<string, string | string[]>) {
    return this.audit.append({
      entity: 'ORG_UNIT',
      entityId: unitId,
      action,
      actorType: ctx.actor.type,
      ...(ctx.actor.id ? { actorId: ctx.actor.id } : {}),
      companyId: ctx.companyId,
      metadata,
    });
  }

  /**
   * Who reports to whom: the active people the actor may see, each with
   * their direct manager. The UI folds this into a tree (people whose
   * manager is outside the actor's view start a branch of their own).
   */
  listReporting(ctx: CompanyContext) {
    return this.db.employee.findMany({
      where: { AND: [scopeWhere(ctx), { status: 'ACTIVE' }] },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNo: true,
        managerId: true,
        position: { select: { titleAr: true, titleEn: true } },
        orgUnit: { select: { nameAr: true, nameEn: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 2000,
    });
  }

  // ───────────────────────────────────────────────────────── titles

  listPositions(ctx: CompanyContext) {
    return this.db.position.findMany({ where: { companyId: ctx.companyId }, select: POSITION_SELECT, orderBy: [{ active: 'desc' }, { code: 'asc' }] });
  }

  async createPosition(ctx: CompanyContext, input: PositionInput) {
    const code = input.code.trim().toUpperCase();
    const clash = await this.db.position.findUnique({ where: { companyId_code: { companyId: ctx.companyId, code } }, select: { id: true } });
    if (clash) throw new GuardFailedError('DUPLICATE_CODE', `a title with code ${code} already exists in this company`, 'code');
    const row = await this.db.position.create({
      data: { companyId: ctx.companyId, code, titleAr: input.titleAr.trim(), titleEn: input.titleEn.trim(), active: input.active ?? true },
      select: POSITION_SELECT,
    });
    await this.auditPosition(ctx, row.id, 'TITLE_CREATED', { code });
    return row;
  }

  async updatePosition(ctx: CompanyContext, id: string, changes: Partial<PositionInput>) {
    const existing = await this.db.position.findFirst({ where: { id, companyId: ctx.companyId }, select: POSITION_SELECT });
    if (!existing) throw new NotFoundError('title', id);
    const code = changes.code !== undefined ? changes.code.trim().toUpperCase() : existing.code;
    if (code !== existing.code) {
      const clash = await this.db.position.findUnique({ where: { companyId_code: { companyId: ctx.companyId, code } }, select: { id: true } });
      if (clash) throw new GuardFailedError('DUPLICATE_CODE', `a title with code ${code} already exists in this company`, 'code');
    }
    const row = await this.db.position.update({
      where: { id },
      data: {
        code,
        ...(changes.titleAr !== undefined ? { titleAr: changes.titleAr.trim() } : {}),
        ...(changes.titleEn !== undefined ? { titleEn: changes.titleEn.trim() } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
      },
      select: POSITION_SELECT,
    });
    await this.auditPosition(ctx, id, 'TITLE_UPDATED', { changes: Object.keys(changes) });
    return row;
  }

  async deletePosition(ctx: CompanyContext, id: string) {
    const existing = await this.db.position.findFirst({ where: { id, companyId: ctx.companyId }, select: POSITION_SELECT });
    if (!existing) throw new NotFoundError('title', id);
    if (existing._count.employees > 0) {
      throw new GuardFailedError('TITLE_IN_USE', `${existing._count.employees} employee(s) hold this title — deactivate it instead`);
    }
    await this.db.position.delete({ where: { id } });
    await this.auditPosition(ctx, id, 'TITLE_DELETED', { code: existing.code });
  }

  private auditPosition(ctx: CompanyContext, id: string, action: string, metadata: Record<string, string | string[]>) {
    return this.audit.append({
      entity: 'POSITION',
      entityId: id,
      action,
      actorType: ctx.actor.type,
      ...(ctx.actor.id ? { actorId: ctx.actor.id } : {}),
      companyId: ctx.companyId,
      metadata,
    });
  }
}
