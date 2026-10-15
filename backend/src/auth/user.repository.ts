import type { Db } from '../common/prisma.js';
import type { Role } from '../generated/prisma/enums.js';

/** What the staff list and the invitation flow need to know about an account. */
export const USER_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  mustChangePassword: true,
  invitedAt: true,
  passwordChangedAt: true,
  lastLoginAt: true,
} as const;

/**
 * A user's assignments travel with the account: the session needs them on
 * every request (authenticate runs per call), and one join is cheaper than
 * a second round trip.
 */
export const WITH_ASSIGNMENTS = {
  assignments: {
    select: {
      companyId: true,
      orgUnitId: true,
      role: { select: { code: true, active: true, permissions: { select: { permission: true } } } },
    },
  },
} as const;

export class UserRepository {
  constructor(private readonly db: Db) {}

  findById(id: string) {
    return this.db.user.findUnique({ where: { id }, include: WITH_ASSIGNMENTS });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email }, include: WITH_ASSIGNMENTS });
  }

  /** The workspace the user is in — validated by the service before it is stored. */
  setActiveCompany(id: string, companyId: string | null) {
    return this.db.user.update({ where: { id }, data: { activeCompanyId: companyId }, include: WITH_ASSIGNMENTS });
  }

  /**
   * Active staff of a role — notification fan-out targets. With a company,
   * only people who can work in that company: a global assignment, an
   * assignment in that company, or (legacy) no assignment rows at all.
   * Staff of another company never hear about this company's records.
   */
  listActiveByRole(role: Role, companyId?: string | null) {
    return this.db.user.findMany({
      where: {
        role,
        active: true,
        ...(companyId
          ? {
              OR: [
                { assignments: { none: {} } },
                { assignments: { some: { companyId: null } } },
                { assignments: { some: { companyId } } },
              ],
            }
          : {}),
      },
    });
  }

  /** Named primary owners of a process — only the ones still active. */
  listActiveByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.user.findMany({ where: { id: { in: ids }, active: true } });
  }

  /** Server-side page of staff accounts (search across name/email). */
  async listPaged(query: { q?: string; page: number; limit: number }) {
    const q = query.q?.trim();
    // Staff accounts only — leftover employee accounts (role EMPLOYEE) are switched off and hidden.
    const where = {
      role: { not: 'EMPLOYEE' as const },
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: USER_LIST_SELECT,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);
    return { items, total };
  }

  update(
    id: string,
    data: {
      role?: Role;
      active?: boolean;
      passwordHash?: string;
      name?: string;
      email?: string;
      mustChangePassword?: boolean;
      invitedAt?: Date | null;
      passwordChangedAt?: Date | null;
      lastLoginAt?: Date | null;
      photoKey?: string | null;
    },
  ) {
    return this.db.user.update({ where: { id }, data });
  }

  create(data: {
    email: string;
    name: string;
    role: Role;
    passwordHash?: string;
    mustChangePassword?: boolean;
    invitedAt?: Date | null;
  }) {
    return this.db.user.create({ data });
  }

  /**
   * Hard delete. Optional links (audit actor, employee creator, notifications)
   * are nulled by the database; a user who owns required history (contracts,
   * custody forms, offboarding requests, employee requests) cannot be deleted
   * and the caller turns that into a friendly refusal.
   */
  remove(id: string) {
    return this.db.user.delete({ where: { id } });
  }
}
