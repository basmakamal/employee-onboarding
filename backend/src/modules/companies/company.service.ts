import type { Db } from '../../common/prisma.js';
import type { Actor } from '../../workflow/engine.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';

export interface CompanyInput {
  code: string;
  nameAr: string;
  nameEn: string;
  active?: boolean | undefined;
}

const COMPANY_SELECT = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  active: true,
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
  ) {}

  list() {
    return this.db.company.findMany({ select: COMPANY_SELECT, orderBy: [{ active: 'desc' }, { nameEn: 'asc' }] });
  }

  async get(id: string) {
    const row = await this.db.company.findUnique({ where: { id }, select: COMPANY_SELECT });
    if (!row) throw new NotFoundError('company', id);
    return row;
  }

  async create(input: CompanyInput, actor: Actor) {
    const code = input.code.trim().toUpperCase();
    if (await this.db.company.findUnique({ where: { code } })) {
      throw new GuardFailedError('DUPLICATE_CODE', `a company with code ${code} already exists`);
    }
    const row = await this.db.company.create({
      data: { code, nameAr: input.nameAr.trim(), nameEn: input.nameEn.trim(), active: input.active ?? true },
      select: COMPANY_SELECT,
    });
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
    changes: { nameAr?: string | undefined; nameEn?: string | undefined; active?: boolean | undefined },
    actor: Actor,
  ) {
    const wasActive = (await this.get(id)).active;
    const row = await this.db.company.update({
      where: { id },
      data: {
        ...(changes.nameAr !== undefined ? { nameAr: changes.nameAr.trim() } : {}),
        ...(changes.nameEn !== undefined ? { nameEn: changes.nameEn.trim() } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
      },
      select: COMPANY_SELECT,
    });
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
