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

export class UserRepository {
  constructor(private readonly db: Db) {}

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  /** Active staff of a role — notification fan-out targets. */
  listActiveByRole(role: Role) {
    return this.db.user.findMany({ where: { role, active: true } });
  }

  /** Named primary owners of a process — only the ones still active. */
  listActiveByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.user.findMany({ where: { id: { in: ids }, active: true } });
  }

  /** Server-side page of staff accounts (search across name/email). */
  async listPaged(query: { q?: string; page: number; limit: number }) {
    const q = query.q?.trim();
    const where = q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {};
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
