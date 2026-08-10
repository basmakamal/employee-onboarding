import type { Db } from '../common/prisma.js';
import type { Role } from '../generated/prisma/enums.js';

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

  /** Server-side page of staff accounts (search across name/email). */
  async listPaged(query: { q?: string; page: number; limit: number }) {
    const q = query.q?.trim();
    const where = q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {};
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
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
    data: { role?: Role; active?: boolean; passwordHash?: string; name?: string; email?: string },
  ) {
    return this.db.user.update({ where: { id }, data });
  }

  create(data: { email: string; name: string; role: Role; passwordHash?: string }) {
    return this.db.user.create({ data });
  }
}
