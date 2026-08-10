import type { Db } from '../common/prisma.js';
import type { LinkPurpose } from '../generated/prisma/enums.js';

export class LinkTokenRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    purpose: LinkPurpose;
    tokenHash: string;
    expiresAt: Date;
    employeeId?: string;
    assetFormId?: string;
    offboardingId?: string;
  }) {
    return this.db.linkToken.create({ data });
  }

  /** A token is valid if it matches, is unexpired, and was never used. */
  findValid(tokenHash: string, now: Date) {
    return this.db.linkToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      include: { employee: true, assetForm: true, offboarding: true },
    });
  }

  markUsed(id: string, usedAt: Date) {
    return this.db.linkToken.update({ where: { id }, data: { usedAt } });
  }

  /** Invalidate previous links of the same purpose when re-sending. */
  invalidateFor(
    purpose: LinkPurpose,
    where: { employeeId?: string; assetFormId?: string; offboardingId?: string },
    at: Date,
  ) {
    return this.db.linkToken.updateMany({
      where: { purpose, usedAt: null, ...where },
      data: { usedAt: at },
    });
  }
}
