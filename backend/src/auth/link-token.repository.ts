import type { Db } from '../common/prisma.js';
import type { LinkPurpose } from '../generated/prisma/enums.js';

export class LinkTokenRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    employeeId: string;
    purpose: LinkPurpose;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.db.linkToken.create({ data });
  }

  /** A token is valid if it matches, is unexpired, and was never used. */
  findValid(tokenHash: string, now: Date) {
    return this.db.linkToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      include: { employee: true },
    });
  }

  markUsed(id: string, usedAt: Date) {
    return this.db.linkToken.update({ where: { id }, data: { usedAt } });
  }
}
