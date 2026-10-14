import type { RequestHandler } from 'express';
import { actorScope, type EmployeeScope } from '../../auth/authz/authorize.js';
import { NotFoundError } from '../../workflow/errors.js';

/** Fixed paths under /employees that are not an employee id. */
const NOT_AN_ID = new Set(['changes', 'options']);

/**
 * One guard in front of every `/employees/:id/...` route: the employee must
 * belong to the selected company and sit inside the actor's branch scope,
 * or the request ends in a 404 (the same answer as "does not exist", so ids
 * of other companies cannot be probed). Individual handlers may check
 * again; this makes sure none can forget to.
 */
export function employeeScopeGuard(employees: {
  findById(id: string, scope?: EmployeeScope): Promise<unknown | null>;
}): RequestHandler {
  return (req, _res, next) => {
    const id = req.params['id'];
    if (!id || NOT_AN_ID.has(id)) {
      next();
      return;
    }
    employees
      .findById(id, actorScope(req.actor) ?? { companyId: '\u0000' })
      .then((found) => next(found ? undefined : new NotFoundError('employee', id)))
      .catch(next);
  };
}
