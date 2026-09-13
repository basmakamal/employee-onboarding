import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
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

/** /api/lists — every dropdown, for signed-in staff. Adding is HR's too; editing is admin's. */
export function listsRouter(lists: ListService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ lists: await lists.all() });
    }),
  );

  router.post(
    '/:key/values',
    requireRole('HR', 'ADMIN'),
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createSchema>;
      res.status(201).json(await lists.create(req.params['key'] as string, body));
    }),
  );

  router.put(
    '/:key/values/:id',
    requireRole('ADMIN'),
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof updateSchema>;
      res.json(await lists.update(req.params['key'] as string, req.params['id'] as string, body));
    }),
  );

  router.delete(
    '/:key/values/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      await lists.remove(req.params['key'] as string, req.params['id'] as string);
      res.status(204).end();
    }),
  );

  return router;
}

/** /api/public/lists — what the data form shows a new hire, no sign-in. */
export function publicListsRouter(lists: ListService): Router {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ lists: await lists.forPublicForm() });
    }),
  );
  return router;
}
