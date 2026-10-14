import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, pagedQuery, validate, validateQuery } from '../../common/http.js';
import { actorScope, contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { EmploymentHistoryService } from './employment-history.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const changeSchema = z
  .object({
    /** The company's local date the change takes effect — today or earlier applies at once. */
    effectiveDate: day,
    orgUnitId: z.string().min(1).nullable().optional(),
    positionId: z.string().min(1).nullable().optional(),
    managerId: z.string().min(1).nullable().optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.orgUnitId !== undefined || v.positionId !== undefined || v.managerId !== undefined, {
    message: 'choose a new branch / department, job title or manager',
    path: ['orgUnitId'],
  });

const listSchema = z.object({
  status: z.enum(['SCHEDULED', 'APPLIED', 'CANCELLED', 'FAILED']).optional(),
  from: day.optional(),
  to: day.optional(),
});

/**
 * /api/employees/... — employment history. Mounted BEFORE the employee
 * router so `/employees/changes` is not read as an employee id. Reading
 * follows the employee file (any staff member, inside their scope);
 * changing someone's placement needs `employees.write`.
 */
export function employmentHistoryRouter(service: EmploymentHistoryService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  /** Transfers / promotions across the company (upcoming and past), limited to the actor's scope. */
  router.get(
    '/changes',
    validateQuery(listSchema),
    asyncHandler(async (req, res) => {
      const { companyId } = contextOf(req);
      const q = pagedQuery<z.infer<typeof listSchema>>(req);
      res.json(await service.listCompany(companyId, actorScope(actor(req)) ?? { companyId }, q));
    }),
  );

  router.get(
    '/:id/history',
    asyncHandler(async (req, res) => {
      res.json(await service.list(req.params['id'] as string, actor(req)));
    }),
  );

  router.post(
    '/:id/changes',
    requirePermission('employees.write'),
    validate(changeSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof changeSchema>;
      res.status(201).json(await service.schedule(req.params['id'] as string, body, actor(req)));
    }),
  );

  router.delete(
    '/:id/changes/:batchId',
    requirePermission('employees.write'),
    asyncHandler(async (req, res) => {
      await service.cancel(req.params['id'] as string, req.params['batchId'] as string, actor(req));
      res.status(204).end();
    }),
  );

  return router;
}
