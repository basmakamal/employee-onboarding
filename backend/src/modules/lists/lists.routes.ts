import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { ListService } from './list.service.js';

const createSchema = z.object({
  code: z.string().trim().max(120).optional(),
  labelAr: z.string().trim().max(160),
  labelEn: z.string().trim().max(160),
});

const updateSchema = z.object({
  labelAr: z.string().trim().max(160).optional(),
  labelEn: z.string().trim().max(160).optional(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

/**
 * /api/lists — every dropdown of the SELECTED company, for signed-in staff.
 * Mounted behind requireCompany(): each company has its own lists.
 * Adding is HR's too; editing is admin's.
 */
export function listsRouter(lists: ListService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json({ lists: await lists.all(contextOf(req).companyId) });
    }),
  );

  router.post(
    '/:key/values',
    requirePermission('lists.manage', 'employees.write'),
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createSchema>;
      res.status(201).json(await lists.create(contextOf(req).companyId, req.params['key'] as string, body));
    }),
  );

  router.put(
    '/:key/values/:id',
    requirePermission('lists.manage'),
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateSchema>;
      res.json(await lists.update(contextOf(req).companyId, req.params['key'] as string, req.params['id'] as string, body));
    }),
  );

  router.delete(
    '/:key/values/:id',
    requirePermission('lists.manage'),
    asyncHandler(async (req, res) => {
      await lists.remove(contextOf(req).companyId, req.params['key'] as string, req.params['id'] as string);
      res.status(204).end();
    }),
  );

  return router;
}
