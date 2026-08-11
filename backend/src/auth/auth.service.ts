import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '../generated/prisma/enums.js';
import type { UserRepository } from './user.repository.js';
import type { RefreshTokenStore } from './refresh-token.store.js';
import { UnauthorizedError } from '../workflow/errors.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL_SECONDS = 7 * 24 * 3600;
const BCRYPT_ROUNDS = 10;

export interface TokenPayload {
  sub: string;
  role: Role;
  /** Distinguishes the two token kinds so one can never stand in for the other. */
  kind: 'access' | 'refresh';
  /** Refresh tokens only: the id the revocation store tracks. */
  jti?: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly secrets: { access: string; refresh: string },
    /**
     * Optional (Redis) revocation store. With it, refresh tokens are
     * single-use and killable; without it (dev/tests) they stay stateless
     * exactly as before.
     */
    private readonly refreshStore?: RefreshTokenStore,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email.toLowerCase());
    // Same error for every failure mode — no user-enumeration oracle.
    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedError('invalid email or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedError('invalid email or password');

    return {
      user: publicUser(user),
      accessToken: this.sign(user.id, user.role, 'access'),
      refreshToken: await this.issueRefresh(user.id, user.role),
    };
  }

  /** Rotate: a valid refresh token yields a fresh access+refresh pair. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = this.verify(refreshToken, 'refresh');
    // Single-use: redeeming kills the old token, so a stolen copy that is
    // replayed later — by the thief or the victim — comes up dead.
    if (this.refreshStore) {
      const live = payload.jti && (await this.refreshStore.consume(payload.sub, payload.jti));
      if (!live) throw new UnauthorizedError('invalid or expired token');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');

    return {
      user: publicUser(user),
      accessToken: this.sign(user.id, user.role, 'access'),
      refreshToken: await this.issueRefresh(user.id, user.role),
    };
  }

  /** Logout: kill the presented refresh token server-side (best effort). */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken || !this.refreshStore) return;
    try {
      const payload = this.verify(refreshToken, 'refresh');
      if (payload.jti) await this.refreshStore.revoke(payload.sub, payload.jti);
    } catch {
      // An invalid token has nothing to revoke.
    }
  }

  /** Verify an access token and load its (still-active) user. */
  async authenticate(accessToken: string): Promise<PublicUser> {
    const payload = this.verify(accessToken, 'access');
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');
    return publicUser(user);
  }

  private async issueRefresh(sub: string, role: Role): Promise<string> {
    const jti = randomUUID();
    const token = jwt.sign({ sub, role, kind: 'refresh', jti } satisfies TokenPayload, this.secrets.refresh, {
      expiresIn: REFRESH_TTL_SECONDS,
    });
    await this.refreshStore?.save(sub, jti, REFRESH_TTL_SECONDS);
    return token;
  }

  private sign(sub: string, role: Role, kind: TokenPayload['kind']): string {
    const secret = kind === 'access' ? this.secrets.access : this.secrets.refresh;
    return jwt.sign({ sub, role, kind } satisfies TokenPayload, secret, {
      expiresIn: kind === 'access' ? ACCESS_TTL : REFRESH_TTL_SECONDS,
    });
  }

  private verify(token: string, kind: TokenPayload['kind']): TokenPayload {
    const secret = kind === 'access' ? this.secrets.access : this.secrets.refresh;
    try {
      const payload = jwt.verify(token, secret) as TokenPayload;
      if (payload.kind !== kind) throw new Error('wrong token kind');
      return payload;
    } catch {
      throw new UnauthorizedError('invalid or expired token');
    }
  }
}

function publicUser(u: { id: string; name: string; email: string; role: Role }): PublicUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
