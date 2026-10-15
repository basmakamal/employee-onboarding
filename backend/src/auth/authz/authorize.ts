/**
 * The ONE place that answers "may this actor do this, here?".
 *
 * - `requirePermission` gates a route by permission code — the role names
 *   never appear in route files.
 * - `requireCompany` + `contextOf` turn the validated active company into a
 *   `CompanyContext` that services receive; without a selected company the
 *   request is refused, never widened to "all companies".
 * - `scopeWhere` is the Prisma `where` fragment every company-owned query
 *   composes in, so a restricted manager only ever sees their subtree.
 *
 * Actors that carry no `permissions` (older tests, system actors) fall back
 * to the bundle of their legacy role, so the transition is behaviour-
 * preserving: an HR user can do today exactly what HR could do yesterday.
 */
import type { RequestHandler } from 'express';
import type { Actor } from '../../workflow/engine.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CompanyRequiredError, ForbiddenError } from '../../workflow/errors.js';
import { SYSTEM_ROLES, type Permission } from './permissions.js';
import type { Scope } from './scope.js';
import { documented } from '../../docs/route-doc.js';

const LEGACY_BUNDLES = new Map(SYSTEM_ROLES.map((r) => [r.code, new Set<string>(r.permissions)]));

/** Everything the actor may do in their current context. */
export function permissionsOf(actor: Actor | undefined): Set<string> {
  if (!actor || actor.type !== 'USER') return new Set();
  if (actor.permissions) return new Set(actor.permissions);
  // Legacy actor: derive from the single role. ADMIN was "everything".
  const code = actor.role === 'ADMIN' ? 'SUPER_ADMIN' : actor.role ?? '';
  return new Set(LEGACY_BUNDLES.get(code) ?? []);
}

/** Any-of check — a route that several permissions may open lists them all. */
export function can(actor: Actor | undefined, ...permissions: Permission[]): boolean {
  const have = permissionsOf(actor);
  return permissions.some((p) => have.has(p));
}

/** Route gate — run AFTER requireAuth. 403 with a stable code. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    if (!can(req.actor, ...permissions)) {
      next(new ForbiddenError(`requires permission: ${permissions.join(' or ')}`));
      return;
    }
    next();
  };
  return documented(handler, { permissions });
}

/**
 * The validated workspace a request works in. `companyId` comes from the
 * actor (set by authenticate() only after checking the user's assignments),
 * never from the body or the query string.
 */
export interface CompanyContext {
  companyId: string;
  actor: Actor;
  scope: Scope;
}

export function contextOf(req: { actor?: Actor }): CompanyContext {
  const actor = req.actor;
  if (!actor?.companyId) throw new CompanyRequiredError();
  return {
    companyId: actor.companyId,
    actor,
    scope: actor.scope ?? { companyId: actor.companyId, all: true, orgUnitPaths: [] },
  };
}

/**
 * API prefixes that only make sense inside a company workspace. Mounted
 * with requireCompany() in index.ts; everything else under /api (auth,
 * companies, users, settings, templates, lists, the bell) is global.
 */
export const COMPANY_SCOPED_PREFIXES = [
  '/employees',
  '/employee-documents',
  '/offboardings',
  '/reports',
  '/dashboard',
  '/ai',
  '/assets',
  '/asset-forms',
  '/org',
  '/lists',
  // Each company has its own automation, e-mail wording, calendar and mail server.
  '/settings',
  '/email-templates',
  '/email-triggers',
  // Company-wide registers: contracts, documents, offboardings.
  '/registers',
  '/audit',
  '/workforce',
  '/attendance',
  '/leave',
  '/approvals',
] as const;

/**
 * The scope a service applies for this actor. Staff requests always carry a
 * company (requireCompany is mounted on every company-owned prefix); link,
 * system and legacy test actors carry none and are not filtered — their
 * access is bound to the record they arrived with.
 */
export function actorScope(actor: Actor | undefined): EmployeeScope | undefined {
  if (!actor?.companyId) return undefined;
  return scopeWhere({
    companyId: actor.companyId,
    actor,
    scope: actor.scope ?? { companyId: actor.companyId, all: true, orgUnitPaths: [] },
  });
}

/**
 * Compose a query's own filter with a scope WITHOUT clobbering either: both
 * may carry an `OR` (a search vs. a manager's subtrees), so they are joined
 * with AND rather than spread into one object. No scope → the filter as is.
 */
export function withScope(where: Prisma.EmployeeWhereInput, scope: EmployeeScope | undefined): Prisma.EmployeeWhereInput {
  return scope ? { AND: [where, scope] } : where;
}

/** The same scope for a table that hangs off an employee (`employee` relation). */
export function viaEmployee(scope: EmployeeScope | undefined): { employee?: Prisma.EmployeeWhereInput } {
  return scope ? { employee: scope } : {};
}

/**
 * Audit rows a scope may read: rows about its employees, plus — for a
 * company-wide scope only — company-level rows with no employee (company /
 * org / title changes). A branch manager never sees company-level history.
 */
export function auditScope(scope: EmployeeScope | undefined): Prisma.AuditLogWhereInput {
  if (!scope) return {};
  if (scope.OR) return { employee: scope };
  return { OR: [{ employee: { companyId: scope.companyId } }, { companyId: scope.companyId, employeeId: null }] };
}

/** Route gate for company-owned data: no selected company → refused. */
export function requireCompany(): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    if (!req.actor?.companyId) {
      next(new CompanyRequiredError());
      return;
    }
    next();
  };
  return documented(handler, { company: true });
}

/** The `where` fragment shape every scoped repository accepts. */
export type EmployeeScope = {
  companyId: string;
  OR?: Array<{ orgUnit: { path: { startsWith: string } } }>;
};

/**
 * Prisma `where` fragment for a company-owned table that carries
 * `companyId` and `orgUnitId` (employees, positions, org units…). For a
 * child table use `{ employee: scopeWhere(ctx) }`.
 */
export function scopeWhere(ctx: CompanyContext): EmployeeScope {
  if (ctx.scope.all) return { companyId: ctx.companyId };
  if (ctx.scope.orgUnitPaths.length === 0) {
    // A unit manager whose unit is unknown sees nothing — never everything.
    return { companyId: ctx.companyId, OR: [{ orgUnit: { path: { startsWith: '/\u0000/' } } }] };
  }
  return {
    companyId: ctx.companyId,
    OR: ctx.scope.orgUnitPaths.map((prefix) => ({ orgUnit: { path: { startsWith: prefix } } })),
  };
}
