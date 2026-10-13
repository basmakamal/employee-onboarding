import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { Actor } from '../workflow/engine.js';
import type { AuditLogRepository } from '../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../workflow/errors.js';
import { isPermission } from './authz/permissions.js';

export interface AssignmentInput {
  roleCode: string;
  companyId?: string | null | undefined;
  orgUnitId?: string | null | undefined;
}

export interface RoleInput {
  code: string;
  nameAr: string;
  nameEn: string;
  level?: 'GLOBAL' | 'COMPANY' | 'UNIT' | undefined;
  permissions: string[];
  active?: boolean | undefined;
}

const ROLE_SELECT = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  level: true,
  system: true,
  active: true,
  permissions: { select: { permission: true } },
  _count: { select: { assignments: true } },
} as const;

const ASSIGNMENT_SELECT = {
  id: true,
  roleId: true,
  companyId: true,
  orgUnitId: true,
  createdAt: true,
  role: { select: { code: true, nameAr: true, nameEn: true, level: true } },
  company: { select: { code: true, nameAr: true, nameEn: true } },
} as const;

/**
 * Roles (what a user may do) and assignments (where). Also the ONE place
 * that keeps "manager of X" in step with the matching assignment, so a
 * company or unit manager's login sees exactly their scope without a
 * second mechanism.
 */
export class AssignmentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly audit: AuditLogRepository,
  ) {}

  // ─────────────────────────────────────────────────────────── roles

  listRoles() {
    return this.db.roleDefinition.findMany({ select: ROLE_SELECT, orderBy: [{ system: 'desc' }, { code: 'asc' }] });
  }

  async createRole(input: RoleInput, actor: Actor) {
    const code = input.code.trim().toUpperCase();
    if (await this.db.roleDefinition.findUnique({ where: { code } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a role with code ${code} already exists`);
    }
    const permissions = this.cleanPermissions(input.permissions);
    const row = await this.db.roleDefinition.create({
      data: {
        code,
        nameAr: input.nameAr.trim(),
        nameEn: input.nameEn.trim(),
        level: input.level ?? 'COMPANY',
        active: input.active ?? true,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
      select: ROLE_SELECT,
    });
    await this.auditRole(row.id, 'ROLE_CREATED', actor, { code, permissions });
    return row;
  }

  async updateRole(
    id: string,
    changes: Partial<Omit<RoleInput, 'code'>> & { permissions?: string[] | undefined },
    actor: Actor,
  ) {
    const existing = await this.db.roleDefinition.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!existing) throw new NotFoundError('role', id);
    // A system role can be re-bundled, never switched off or re-levelled.
    if (existing.system && (changes.active === false || (changes.level && changes.level !== existing.level))) {
      throw new GuardFailedError('SYSTEM_ROLE', 'system roles cannot be deactivated or re-levelled');
    }
    const permissions = changes.permissions ? this.cleanPermissions(changes.permissions) : undefined;
    const row = await this.db.$transaction(async (tx) => {
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permission })) });
      }
      return tx.roleDefinition.update({
        where: { id },
        data: {
          ...(changes.nameAr !== undefined ? { nameAr: changes.nameAr.trim() } : {}),
          ...(changes.nameEn !== undefined ? { nameEn: changes.nameEn.trim() } : {}),
          ...(changes.level !== undefined ? { level: changes.level } : {}),
          ...(changes.active !== undefined ? { active: changes.active } : {}),
        },
        select: ROLE_SELECT,
      });
    });
    await this.auditRole(id, 'ROLE_UPDATED', actor, { changes: Object.keys(changes), ...(permissions ? { permissions } : {}) });
    return row;
  }

  async removeRole(id: string, actor: Actor) {
    const existing = await this.db.roleDefinition.findUnique({ where: { id }, select: ROLE_SELECT });
    if (!existing) throw new NotFoundError('role', id);
    if (existing.system) throw new GuardFailedError('SYSTEM_ROLE', 'system roles cannot be deleted');
    if (existing._count.assignments > 0) {
      throw new GuardFailedError('ROLE_IN_USE', `${existing._count.assignments} assignment(s) still use this role`);
    }
    await this.db.roleDefinition.delete({ where: { id } });
    await this.auditRole(id, 'ROLE_DELETED', actor, { code: existing.code });
  }

  private cleanPermissions(codes: string[]): string[] {
    const bad = codes.filter((c) => !isPermission(c));
    if (bad.length) throw new GuardFailedError('BAD_PERMISSION', `unknown permission(s): ${bad.join(', ')}`);
    return [...new Set(codes)];
  }

  private auditRole(roleId: string, action: string, actor: Actor, metadata: Prisma.InputJsonValue) {
    return this.audit.append({
      entity: 'ROLE',
      entityId: roleId,
      action,
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      metadata,
    });
  }

  // ────────────────────────────────────────────────────── assignments

  listForUser(userId: string) {
    return this.db.userAssignment.findMany({ where: { userId }, select: ASSIGNMENT_SELECT, orderBy: { createdAt: 'asc' } });
  }

  /**
   * Replace a user's whole assignment list. Every item is validated: the
   * role exists and is active, the company exists, the unit belongs to
   * that company. Manager seats (companies.managerId / org_units.managerId)
   * are kept in step by the org/company services, not here.
   */
  async replaceForUser(userId: string, items: AssignmentInput[], actor: Actor) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundError('user', userId);
    const roles = await this.db.roleDefinition.findMany({ where: { active: true }, select: { id: true, code: true, level: true } });
    const roleByCode = new Map(roles.map((r) => [r.code, r]));

    const rows: Array<{ roleId: string; companyId: string | null; orgUnitId: string | null }> = [];
    const seen = new Set<string>();
    for (const item of items) {
      const role = roleByCode.get(item.roleCode);
      if (!role) throw new GuardFailedError('BAD_ROLE', `unknown or inactive role ${item.roleCode}`);
      const companyId = item.companyId ?? null;
      const orgUnitId = item.orgUnitId ?? null;
      if (orgUnitId && !companyId) throw new GuardFailedError('BAD_SCOPE', 'a unit assignment needs its company');
      if (companyId) {
        const company = await this.db.company.findUnique({ where: { id: companyId }, select: { id: true } });
        if (!company) throw new GuardFailedError('BAD_COMPANY', 'unknown company');
      }
      if (orgUnitId) {
        const unit = await this.db.orgUnit.findUnique({ where: { id: orgUnitId }, select: { companyId: true } });
        if (!unit || unit.companyId !== companyId) {
          throw new GuardFailedError('BAD_SCOPE', 'the unit does not belong to that company');
        }
      }
      const key = `${role.id}|${companyId}|${orgUnitId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ roleId: role.id, companyId, orgUnitId });
    }

    await this.db.$transaction(async (tx) => {
      await tx.userAssignment.deleteMany({ where: { userId } });
      if (rows.length) {
        await tx.userAssignment.createMany({
          data: rows.map((r) => ({ userId, ...r, createdById: actor.id ?? null })),
        });
      }
    });
    await this.audit.append({
      entity: 'USER',
      entityId: userId,
      action: 'ASSIGNMENTS_REPLACED',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      metadata: { assignments: items.map((i) => `${i.roleCode}@${i.companyId ?? '*'}${i.orgUnitId ? '/' + i.orgUnitId : ''}`) },
    });
    return this.listForUser(userId);
  }

  // ─────────────────────────────────────────────────── manager seats

  /**
   * Keep "manager of this company / unit" and the matching assignment in
   * step: the previous holder loses that one assignment, the new one gets
   * it. Other assignments either person has are untouched.
   */
  async syncManager(
    target: { kind: 'COMPANY'; companyId: string } | { kind: 'UNIT'; companyId: string; orgUnitId: string },
    previousUserId: string | null,
    nextUserId: string | null,
    actor: Actor,
  ): Promise<void> {
    if (previousUserId === nextUserId) return;
    const roleCode = target.kind === 'COMPANY' ? 'COMPANY_MANAGER' : 'UNIT_MANAGER';
    const role = await this.db.roleDefinition.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) throw new GuardFailedError('ROLE_MISSING', `system role ${roleCode} is not seeded`);
    const orgUnitId = target.kind === 'UNIT' ? target.orgUnitId : null;

    if (nextUserId) {
      const user = await this.db.user.findUnique({ where: { id: nextUserId }, select: { id: true, active: true } });
      if (!user || !user.active) throw new GuardFailedError('BAD_MANAGER', 'the manager must be an active staff account');
    }
    await this.db.$transaction(async (tx) => {
      if (previousUserId) {
        await tx.userAssignment.deleteMany({
          where: { userId: previousUserId, roleId: role.id, companyId: target.companyId, orgUnitId },
        });
      }
      if (nextUserId) {
        const exists = await tx.userAssignment.findFirst({
          where: { userId: nextUserId, roleId: role.id, companyId: target.companyId, orgUnitId },
          select: { id: true },
        });
        if (!exists) {
          await tx.userAssignment.create({
            data: { userId: nextUserId, roleId: role.id, companyId: target.companyId, orgUnitId, createdById: actor.id ?? null },
          });
        }
      }
    });
    await this.audit.append({
      entity: target.kind === 'COMPANY' ? 'COMPANY' : 'ORG_UNIT',
      entityId: target.kind === 'COMPANY' ? target.companyId : target.orgUnitId,
      action: 'MANAGER_CHANGED',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      companyId: target.companyId,
      metadata: { from: previousUserId ?? '', to: nextUserId ?? '' },
    });
  }
}
