/**
 * Effective scope — pure functions over a user's assignments.
 *
 * An assignment is "role R in scope S": both ids NULL = global, company
 * only = the whole company, company + org unit = that unit and everything
 * under it. What a user may DO comes from the roles; WHERE they may do it
 * comes from the scope. Both are resolved for the company the user is
 * working in; a global assignment counts everywhere.
 */

export interface AssignmentView {
  roleCode: string;
  permissions: readonly string[];
  companyId: string | null;
  orgUnitId: string | null;
  /** Materialised path of the unit ("/a/b/"), loaded with the assignment. */
  orgUnitPath: string | null;
}

export interface Scope {
  companyId: string | null;
  /** The whole company (or a global assignment). */
  all: boolean;
  /** When not `all`: the unit subtrees the user may reach, as path prefixes. */
  orgUnitPaths: string[];
}

const isGlobal = (a: AssignmentView) => a.companyId === null && a.orgUnitId === null;
const inCompany = (a: AssignmentView, companyId: string | null) =>
  isGlobal(a) || (companyId !== null && a.companyId === companyId);

/** Assignments that apply while working in `companyId` (global ones always do). */
export function applicable(assignments: AssignmentView[], companyId: string | null): AssignmentView[] {
  return assignments.filter((a) => inCompany(a, companyId));
}

/** Union of the permissions the applicable roles grant. */
export function effectivePermissions(assignments: AssignmentView[], companyId: string | null): Set<string> {
  const out = new Set<string>();
  for (const a of applicable(assignments, companyId)) for (const p of a.permissions) out.add(p);
  return out;
}

/** Role codes in force — the state machines' ownership rows are keyed by these. */
export function roleCodes(assignments: AssignmentView[], companyId: string | null): string[] {
  return [...new Set(applicable(assignments, companyId).map((a) => a.roleCode))];
}

/**
 * Where the user may reach inside the company. One company-wide (or
 * global) assignment opens the whole company; otherwise the union of the
 * assigned unit subtrees. A unit assignment whose path is unknown is
 * ignored rather than widened.
 */
export function resolveScope(assignments: AssignmentView[], companyId: string | null): Scope {
  const mine = applicable(assignments, companyId);
  if (mine.some((a) => a.orgUnitId === null)) return { companyId, all: true, orgUnitPaths: [] };
  const paths = [...new Set(mine.map((a) => a.orgUnitPath).filter((p): p is string => !!p))];
  return { companyId, all: false, orgUnitPaths: paths };
}

/** Which companies the user may select: 'all' for a global assignment. */
export function allowedCompanies(assignments: AssignmentView[]): 'all' | string[] {
  if (assignments.some(isGlobal)) return 'all';
  return [...new Set(assignments.map((a) => a.companyId).filter((c): c is string => !!c))];
}

export function mayUseCompany(assignments: AssignmentView[], companyId: string): boolean {
  const allowed = allowedCompanies(assignments);
  return allowed === 'all' || allowed.includes(companyId);
}

/** True when `path` sits inside one of the scope's subtrees (or the scope is the whole company). */
export function pathInScope(scope: Scope, path: string | null | undefined): boolean {
  if (scope.all) return true;
  if (!path) return false;
  return scope.orgUnitPaths.some((prefix) => path.startsWith(prefix));
}
