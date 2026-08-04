import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '../generated/prisma/enums.js';
import type { UserRepository } from './user.repository.js';
import { UnauthorizedError } from '../workflow/errors.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const BCRYPT_ROUNDS = 10;

export interface TokenPayload {
  sub: string;
  role: Role;
  /** Distinguishes the two token kinds so one can never stand in for the other. */
  kind: 'access' | 'refresh';
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
      refreshToken: this.sign(user.id, user.role, 'refresh'),
    };
  }

  /** Rotate: a valid refresh token yields a fresh access+refresh pair. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = this.verify(refreshToken, 'refresh');
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');

    return {
      user: publicUser(user),
      accessToken: this.sign(user.id, user.role, 'access'),
      refreshToken: this.sign(user.id, user.role, 'refresh'),
    };
  }

  /** Verify an access token and load its (still-active) user. */
  async authenticate(accessToken: string): Promise<PublicUser> {
    const payload = this.verify(accessToken, 'access');
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');
    return publicUser(user);
  }

  private sign(sub: string, role: Role, kind: TokenPayload['kind']): string {
    const secret = kind === 'access' ? this.secrets.access : this.secrets.refresh;
    return jwt.sign({ sub, role, kind } satisfies TokenPayload, secret, {
      expiresIn: kind === 'access' ? ACCESS_TTL : REFRESH_TTL,
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
