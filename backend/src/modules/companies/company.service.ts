import type { Db } from '../../common/prisma.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { AssignmentService } from '../../auth/assignment.service.js';

export interface CompanyInput {
  code: string;
  nameAr: string;
  nameEn: string;
  active?: boolean | undefined;
  /** The company manager (staff account) — kept in step with a COMPANY_MANAGER assignment. */
  managerId?: string | null | undefined;
}

const COMPANY_SELECT = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  active: true,
  managerId: true,
  manager: { select: { id: true, name: true, email: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { employees: true, orgUnits: true, assignments: true } },
} as const;

/**
 * Global company administration (Super Admin). This is the ONLY HR-adjacent
 * surface that works without a selected company — and it exposes nothing
 * about a company's people: counts only, so the selector page can show
 * "12 employees" without listing one.
 */
export class CompanyService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogRepository,
    /** Keeps the manager seat and its assignment together; absent in older tests. */
    private readonly assignments?: Pick<AssignmentService, 'syncManager'>,
  ) {}

  list() {
    return this.db.company.findMany({ select: COMPANY_SELECT, orderBy: [{ active: 'desc' }, { nameEn: 'asc' }] });
  }

  async get(id: string) {
    const row = await this.db.company.findUnique({ where: { id }, select: COMPANY_SELECT });
    if (!row) throw new NotFoundError('company', id);
    return row;
  }

  /** A company's units for the assignment editor — names and placement only. */
  async listUnits(id: string) {
    await this.get(id);
    return this.db.orgUnit.findMany({
      where: { companyId: id },
      select: { id: true, code: true, nameAr: true, nameEn: true, depth: true, active: true, parentId: true },
      orderBy: { path: 'asc' },
    });
  }

  async create(input: CompanyInput, actor: Actor) {
    const code = input.code.trim().toUpperCase();
    if (await this.db.company.findUnique({ where: { code } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a company with code ${code} already exists`);
    }
    const row = await this.db.company.create({
      data: {
        code,
        nameAr: input.nameAr.trim(),
        nameEn: input.nameEn.trim(),
        active: input.active ?? true,
        managerId: input.managerId ?? null,
      },
      select: COMPANY_SELECT,
    });
    if (input.managerId) {
      await this.assignments?.syncManager({ kind: 'COMPANY', companyId: row.id }, null, input.managerId, actor);
    }
    await this.audit.append({
      entity: 'COMPANY',
      entityId: row.id,
      action: 'COMPANY_CREATED',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      companyId: row.id,
      metadata: { code },
    });
    return row;
  }

  /** The code is the stable handle — it never changes after creation. */
  async update(
    id: string,
    changes: {
      nameAr?: string | undefined;
      nameEn?: string | undefined;
      active?: boolean | undefined;
      managerId?: string | null | undefined;
    },
    actor: Actor,
  ) {
    const before = await this.get(id);
    const wasActive = before.active;
    const previousManager = before.managerId;
    const row = await this.db.company.update({
      where: { id },
      data: {
        ...(changes.nameAr !== undefined ? { nameAr: changes.nameAr.trim() } : {}),
        ...(changes.nameEn !== undefined ? { nameEn: changes.nameEn.trim() } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        ...(changes.managerId !== undefined ? { managerId: changes.managerId ?? null } : {}),
      },
      select: COMPANY_SELECT,
    });
    if (changes.managerId !== undefined && (changes.managerId ?? null) !== previousManager) {
      await this.assignments?.syncManager({ kind: 'COMPANY', companyId: id }, previousManager, changes.managerId ?? null, actor);
    }
    await this.audit.append({
      entity: 'COMPANY',
      entityId: id,
      action: wasActive && changes.active === false ? 'COMPANY_DEACTIVATED' : 'COMPANY_UPDATED',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      companyId: id,
      metadata: { changes: Object.keys(changes) },
    });
    return row;
  }
}
