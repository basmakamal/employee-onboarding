import { createHash, randomBytes } from 'node:crypto';
import type { LinkPurpose } from '../generated/prisma/enums.js';
import type { LinkTokenRepository } from './link-token.repository.js';
import { NotFoundError } from '../workflow/errors.js';

export interface IssuedLink {
  /** Raw token — exists only in the email/URL we hand out. */
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * Signed single-purpose links for trainees/employees. Only the SHA-256
 * hash is stored; possession of the raw token IS the authentication.
 * Re-issuing a link invalidates all previous ones of the same purpose.
 */
export class LinkTokenService {
  constructor(
    private readonly repo: LinkTokenRepository,
    private readonly appUrl: string,
    private readonly ttlHours: number,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private path(purpose: LinkPurpose, token: string): string {
    const routes: Record<LinkPurpose, string> = {
      DATA_FORM: `/form/${token}`,
      CONTRACT_APPROVAL: `/approve-contract/${token}`,
      ASSET_APPROVAL: `/approve-assets/${token}`,
      EXIT_INTERVIEW: `/exit-interview/${token}`,
    };
    return routes[purpose];
  }

  async issue(
    purpose: LinkPurpose,
    anchors: { traineeId?: string; employeeId?: string; assetFormId?: string; offboardingId?: string },
    now: Date = new Date(),
  ): Promise<IssuedLink> {
    // One live link per purpose+target: kill the previous ones first.
    await this.repo.invalidateFor(purpose, anchors, now);

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + this.ttlHours * 3_600_000);
    await this.repo.create({ purpose, tokenHash: this.hash(token), expiresAt, ...anchors });

    return { token, url: `${this.appUrl}${this.path(purpose, token)}`, expiresAt };
  }

  /** Resolve a raw token to its live LinkToken row (with relations). */
  async verify(rawToken: string, now: Date = new Date()) {
    const row = await this.repo.findValid(this.hash(rawToken), now);
    if (!row) throw new NotFoundError('link', 'expired or invalid');
    return row;
  }

  markUsed(id: string, at: Date = new Date()) {
    return this.repo.markUsed(id, at);
  }
}
