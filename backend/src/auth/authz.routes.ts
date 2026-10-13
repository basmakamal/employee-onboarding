import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../common/http.js';
import { requirePermission } from './authz/authorize.js';
import { PERMISSIONS } from './authz/permissions.js';
import type { AssignmentService } from './assignment.service.js';
import type { Actor } from '../workflow/engine.js';

const roleSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,40}$/),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  level: z.enum(['GLOBAL', 'COMPANY', 'UNIT']).optional(),
  permissions: z.array(z.string().min(1)).max(100),
  active: z.boolean().optional(),
});

const assignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        roleCode: z.string().min(1),
        companyId: z.string().min(1).nullable().optional(),
        orgUnitId: z.string().min(1).nullable().optional(),
      }),
    )
    .max(50),
});

const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

/** /api/roles — roles and the permission catalogue (global administration). */
export function rolesRouter(service: AssignmentService): Router {
  const router = Router();
  router.use(requirePermission('users.manage'));

  /** The catalogue the role editor offers, with bilingual names. */
  router.get(
    '/permissions',
    asyncHandler(async (_req, res) => {
      res.json(Object.entries(PERMISSIONS).map(([code, m]) => ({ code, ...m })));
    }),
  );

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await service.listRoles());
    }),
  );

  router.post(
    '/',
    validate(roleSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.createRole(req.body as z.infer<typeof roleSchema>, actor(req)));
    }),
  );

  router.put(
    '/:id',
    validate(roleSchema.omit({ code: true }).partial()),
    asyncHandler(async (req, res) => {
      res.json(await service.updateRole(req.params['id'] as string, req.body as Partial<z.infer<typeof roleSchema>>, actor(req)));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await service.removeRole(req.params['id'] as string, actor(req));
      res.status(204).end();
    }),
  );

  return router;
}

/** /api/users/:id/assignments — where a user holds which role. */
export function assignmentsRouter(service: AssignmentService): Router {
  const router = Router({ mergeParams: true });
  router.use(requirePermission('users.manage'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await service.listForUser(req.params['id'] as string));
    }),
  );

  router.put(
    '/',
    validate(assignmentsSchema),
    asyncHandler(async (req, res) => {
      const { assignments } = req.body as z.infer<typeof assignmentsSchema>;
      res.json(await service.replaceForUser(req.params['id'] as string, assignments, actor(req)));
    }),
  );

  return router;
}
