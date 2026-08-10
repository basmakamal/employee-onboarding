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

  list() {
    return this.db.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
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
