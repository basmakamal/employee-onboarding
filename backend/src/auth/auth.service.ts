import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '../generated/prisma/enums.js';
import type { UserRepository } from './user.repository.js';
import type { RefreshTokenStore } from './refresh-token.store.js';
import { ForbiddenError, GuardFailedError, UnauthorizedError } from '../workflow/errors.js';
import { logger } from '../common/logger.js';
import type { AuditEntry } from '../workflow/audit-log.repository.js';
import { SYSTEM_ROLES } from './authz/permissions.js';
import {
  allowedCompanies,
  effectivePermissions,
  mayUseCompany,
  resolveScope,
  roleCodes,
  type AssignmentView,
  type Scope,
} from './authz/scope.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL_SECONDS = 7 * 24 * 3600;
const BCRYPT_ROUNDS = 10;

/** Temporary passwords: readable over the phone — no 0/O, 1/l/I look-alikes. */
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const TEMP_LENGTH = 12;

export interface TokenPayload {
  sub: string;
  role: Role;
  /** Distinguishes the two token kinds so one can never stand in for the other. */
  kind: 'access' | 'refresh';
  /** Refresh tokens only: the id the revocation store tracks. */
  jti?: string;
}

export interface SessionCompany {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  /** Legacy single role — kept for the transition; `roles` is the truth. */
  role: Role;
  /** Role codes in force in the active company (global roles always). */
  roles: string[];
  /** Permission codes the UI may show controls for — the server re-checks every call. */
  permissions: string[];
  /** Companies this user may work in (every active one for a global role). */
  companies: SessionCompany[];
  /** The selected workspace, re-validated against the assignments on each request. */
  activeCompany: SessionCompany | null;
  /** True while the account still runs on a temporary (invitation / reset) password. */
  mustChangePassword: boolean;
  /** A profile picture is stored and can be fetched from /api/auth/me/photo. */
  hasPhoto: boolean;
  /** Set for a self-service account: the employee this sign-in belongs to (the UI shows "My space"). */
  employeeId: string | null;
}

/** What the request middleware needs beyond the public view. */
export interface AuthenticatedUser extends PublicUser {
  scope: Scope;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/** The slice of the companies table the session resolver needs. */
export interface CompanyLookup {
  listActive(): Promise<SessionCompany[]>;
  listActiveByIds(ids: string[]): Promise<SessionCompany[]>;
  unitPaths(ids: string[]): Promise<Record<string, string>>;
}

/** Audit sink for company-context changes (sensitive by the brief). */
export interface AuditSink {
  append(entry: AuditEntry): Promise<unknown>;
}

/** The user row as the repository returns it, with assignments when loaded. */
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  passwordHash: string | null;
  mustChangePassword?: boolean;
  photoKey?: string | null;
  activeCompanyId?: string | null;
  employeeId?: string | null;
  employee?: { id: string; companyId: string | null; status: string } | null;
  assignments?: Array<{
    companyId: string | null;
    orgUnitId: string | null;
    role: { code: string; active: boolean; permissions: Array<{ permission: string }> };
  }>;
}

const LEGACY_BUNDLE = new Map(SYSTEM_ROLES.map((r) => [r.code, r.permissions]));

/**
 * A self-service sign-in works only while its employee is employed: before
 * the start (account prepared in advance) and after the end it is refused.
 */
function assertSelfServiceOpen(user: UserRow): void {
  if (user.role !== 'EMPLOYEE') return;
  if (!user.employee || user.employee.status !== 'ACTIVE' || !user.employee.companyId) {
    throw new GuardFailedError('ACCOUNT_NOT_ACTIVE', 'your access opens on your first working day and closes when your employment ends');
  }
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly secrets: { access: string; refresh: string },
    /**
     * Optional (Redis) revocation store. With it, refresh tokens are
     * single-use and killable; without it (dev/tests) they stay stateless
     * exactly as before. A store that fails at runtime degrades to
     * stateless with an error logged — never to a locked-out login.
     */
    private readonly refreshStore?: RefreshTokenStore,
    /** Companies + unit paths; absent (tests) = no company workspace. */
    private readonly companies?: CompanyLookup,
    private readonly audit?: AuditSink,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  /** A fresh temporary password for an invitation or an admin reset. */
  static generateTempPassword(): string {
    let out = '';
    for (let i = 0; i < TEMP_LENGTH; i += 1) {
      out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
    }
    return out;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email.toLowerCase());
    // Same error for every failure mode — no user-enumeration oracle.
    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedError('invalid email or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedError('invalid email or password');
    assertSelfServiceOpen(user);

    // Best-effort stamp; a failure here must never block a valid sign-in.
    try {
      await this.users.update(user.id, { lastLoginAt: new Date() });
    } catch {
      /* ignore */
    }

    return {
      user: await this.session(user),
      accessToken: this.sign(user.id, user.role, 'access'),
      refreshToken: await this.issueRefresh(user.id, user.role),
    };
  }

  /**
   * The signed-in person sets their own password. Clears the "must change"
   * flag, which is what ends the invitation phase and disables "resend".
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.active || !user.passwordHash) {
      throw new UnauthorizedError('account unavailable');
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedError('current password is incorrect');

    const updated = await this.users.update(userId, {
      passwordHash: await AuthService.hashPassword(newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    });
    return this.session({ ...user, ...updated });
  }

  /** The signed-in person edits their own display name. */
  async updateProfile(userId: string, changes: { name: string }): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedError('account unavailable');
    const updated = await this.users.update(userId, { name: changes.name.trim() });
    return this.session({ ...user, ...updated });
  }

  /** Store the new picture's key; returns the replaced key so the caller can delete the file. */
  async setPhoto(userId: string, photoKey: string): Promise<{ user: PublicUser; previousKey: string | null }> {
    const before = await this.users.findById(userId);
    if (!before) throw new UnauthorizedError('account unavailable');
    const updated = await this.users.update(userId, { photoKey });
    return { user: await this.session({ ...before, ...updated }), previousKey: before.photoKey ?? null };
  }

  async photoKeyOf(userId: string): Promise<string | null> {
    const user = await this.users.findById(userId);
    return user?.photoKey ?? null;
  }

  /**
   * Enter a company workspace. The choice is validated against the user's
   * assignments and the company's existence BEFORE it is stored; the
   * stored value is re-validated on every later request anyway. `null`
   * leaves the workspace (back to the selector). Audited: the brief treats
   * context changes as sensitive administrative actions.
   */
  async selectCompany(userId: string, companyId: string | null): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');
    if (companyId !== null) {
      const views = this.views(user);
      if (!mayUseCompany(views, companyId)) throw new ForbiddenError('you are not assigned to this company');
      const known = this.companies ? await this.companies.listActiveByIds([companyId]) : [];
      if (known.length === 0) throw new ForbiddenError('this company is not available');
    }
    const updated = await this.users.setActiveCompany(userId, companyId);
    await this.audit?.append({
      entity: 'USER',
      entityId: userId,
      action: companyId ? 'COMPANY_SELECTED' : 'COMPANY_CLEARED',
      actorType: 'USER',
      actorId: userId,
      companyId,
      metadata: { from: user.activeCompanyId ?? '', to: companyId ?? '' },
    });
    return this.session(updated);
  }

  /** Rotate: a valid refresh token yields a fresh access+refresh pair. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = this.verify(refreshToken, 'refresh');
    // Single-use: redeeming kills the old token, so a stolen copy that is
    // replayed later — by the thief or the victim — comes up dead.
    if (this.refreshStore && payload.jti) {
      const live = await this.consumeRefresh(payload.sub, payload.jti);
      if (!live) throw new UnauthorizedError('invalid or expired token');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');
    assertSelfServiceOpen(user);

    return {
      user: await this.session(user),
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
      // An invalid token has nothing to revoke — and a dead store must not block logout.
    }
  }

  /** Verify an access token and load its (still-active) user with the resolved scope. */
  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const payload = this.verify(accessToken, 'access');
    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('account unavailable');
    assertSelfServiceOpen(user);
    return this.session(user);
  }

  // ------------------------------------------------------------- session

  /**
   * Assignments as the scope functions want them. An account with no
   * assignment rows (a database where the legacy mapping has not run yet)
   * keeps exactly its old single-role powers, globally — so nothing locks
   * out between the migration and the mapping.
   */
  private views(user: UserRow): AssignmentView[] {
    // A self-service account lives in its employee's company and holds no staff permission.
    if (user.role === 'EMPLOYEE') {
      const companyId = user.employee?.companyId;
      return companyId
        ? [{ roleCode: 'EMPLOYEE', permissions: [], companyId, orgUnitId: null, orgUnitPath: null }]
        : [];
    }
    const rows = (user.assignments ?? []).filter((a) => a.role.active);
    if (rows.length > 0) {
      return rows.map((a) => ({
        roleCode: a.role.code,
        permissions: a.role.permissions.map((p) => p.permission),
        companyId: a.companyId,
        orgUnitId: a.orgUnitId,
        orgUnitPath: null,
      }));
    }
    const legacy = user.role === 'ADMIN' ? 'SUPER_ADMIN' : user.role;
    return [
      {
        roleCode: legacy,
        permissions: LEGACY_BUNDLE.get(legacy) ?? [],
        companyId: null,
        orgUnitId: null,
        orgUnitPath: null,
      },
    ];
  }

  private async session(user: UserRow): Promise<AuthenticatedUser> {
    const views = this.views(user);
    const allowed = allowedCompanies(views);
    const companies = !this.companies
      ? []
      : allowed === 'all'
        ? await this.companies.listActive()
        : await this.companies.listActiveByIds(allowed);

    // The stored choice counts only while it is still allowed; a user with
    // exactly one company is simply in it.
    let active = companies.find((c) => c.id === user.activeCompanyId) ?? null;
    if (!active && companies.length === 1) active = companies[0] ?? null;
    const companyId = active?.id ?? null;

    const unitIds = views
      .filter((a) => a.orgUnitId && a.companyId === companyId)
      .map((a) => a.orgUnitId as string);
    const paths = unitIds.length && this.companies ? await this.companies.unitPaths(unitIds) : {};
    const resolved = views.map((a) => ({ ...a, orgUnitPath: a.orgUnitId ? (paths[a.orgUnitId] ?? null) : null }));

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roles: roleCodes(resolved, companyId),
      permissions: [...effectivePermissions(resolved, companyId)],
      companies,
      activeCompany: active,
      mustChangePassword: user.mustChangePassword ?? false,
      hasPhoto: !!user.photoKey,
      employeeId: user.role === 'EMPLOYEE' ? (user.employeeId ?? null) : null,
      // Defense in depth: a self-service account's scope matches no one, should any staff query ever run for it.
      scope:
        user.role === 'EMPLOYEE'
          ? { companyId, all: false, orgUnitPaths: [] }
          : resolveScope(resolved, companyId),
    };
  }

  // -------------------------------------------------------------- tokens

  private async issueRefresh(sub: string, role: Role): Promise<string> {
    const jti = randomUUID();
    const token = jwt.sign({ sub, role, kind: 'refresh', jti } satisfies TokenPayload, this.secrets.refresh, {
      expiresIn: REFRESH_TTL_SECONDS,
    });
    try {
      await this.refreshStore?.save(sub, jti, REFRESH_TTL_SECONDS);
    } catch (err) {
      // Redis down or refusing: sign-in still works, the token is simply stateless.
      logger.error({ err }, 'refresh-token store unavailable — issuing a stateless refresh token');
    }
    return token;
  }

  private async consumeRefresh(sub: string, jti: string): Promise<boolean> {
    try {
      return await (this.refreshStore as RefreshTokenStore).consume(sub, jti);
    } catch (err) {
      logger.error({ err }, 'refresh-token store unavailable — accepting the token statelessly');
      return true;
    }
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
