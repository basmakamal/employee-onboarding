import type { Redis } from 'ioredis';

/**
 * Server-side memory of which refresh tokens are still live. JWTs stay
 * stateless for the 15-minute access window; refresh tokens — the 7-day
 * credential worth stealing — become single-use and revocable.
 */
export interface RefreshTokenStore {
  /** Register a freshly issued refresh token id for this user. */
  save(userId: string, jti: string, ttlSeconds: number): Promise<void>;
  /**
   * One-time redemption: true only if the token id was live, and it is
   * dead afterwards — a replayed (stolen) refresh token gets false.
   */
  consume(userId: string, jti: string): Promise<boolean>;
  /** Explicit logout. */
  revoke(userId: string, jti: string): Promise<void>;
}

/** One key per live token: refresh:{userId}:{jti}, TTL = token lifetime. */
export class RedisRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly redis: Redis) {}

  private key(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  async save(userId: string, jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(userId, jti), '1', 'EX', ttlSeconds);
  }

  async consume(userId: string, jti: string): Promise<boolean> {
    // DEL is atomic — two concurrent redemptions can't both win.
    return (await this.redis.del(this.key(userId, jti))) === 1;
  }

  async revoke(userId: string, jti: string): Promise<void> {
    await this.redis.del(this.key(userId, jti));
  }
}
