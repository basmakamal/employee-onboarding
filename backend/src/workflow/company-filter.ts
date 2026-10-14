/**
 * Which records one company's automation rule may see.
 *
 * A rule watches its own company's records only. Records that were never
 * placed in a company (legacy data from before multi-company) are watched
 * by the MAIN company's rules, so nothing silently drops out of automation.
 */
export interface CompanyFilter {
  companyId: string;
  /** True for the main company: it also watches records with no company. */
  includeUnassigned: boolean;
}

/** `where` fragment for the employee table. */
export function employeeCompanyWhere(filter?: CompanyFilter) {
  if (!filter) return {};
  return filter.includeUnassigned
    ? { OR: [{ companyId: filter.companyId }, { companyId: null }] }
    : { companyId: filter.companyId };
}

/** `where` fragment for a table that belongs to an employee (forms, processes, documents…). */
export function viaEmployeeCompanyWhere(filter?: CompanyFilter) {
  return filter ? { employee: employeeCompanyWhere(filter) } : {};
}
