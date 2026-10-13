import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { contextOf, requirePermission } from '../../auth/authz/authorize.js';
import type { OrgService } from './org.service.js';

/** Unit / title codes: letters or digits first (e.g. CS-CALL, 52), then letters, digits, dash, underscore. */
const CODE = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/);

const unitSchema = z.object({
  parentId: z.string().min(1).nullable().optional(),
  type: z.string().trim().min(1).max(40),
  code: CODE,
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  managerId: z.string().min(1).nullable().optional(),
  active: z.boolean().optional(),
});

const positionSchema = z.object({
  code: CODE,
  titleAr: z.string().trim().min(1).max(120),
  titleEn: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
});

/**
 * /api/org — the active company's branch / department tree and job titles.
 * Mounted behind requireCompany(): every call carries a CompanyContext, so
 * nothing here can touch another company's units or titles.
 */
export function orgRouter(service: OrgService): Router {
  const router = Router();

  router.get(
    '/units',
    requirePermission('org.read', 'org.manage', 'employees.read'),
    asyncHandler(async (req, res) => {
      res.json(await service.listUnits(contextOf(req)));
    }),
  );

  router.post(
    '/units',
    requirePermission('org.manage'),
    validate(unitSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.createUnit(contextOf(req), req.body as z.infer<typeof unitSchema>));
    }),
  );

  router.put(
    '/units/:id',
    requirePermission('org.manage'),
    validate(unitSchema.partial()),
    asyncHandler(async (req, res) => {
      res.json(await service.updateUnit(contextOf(req), req.params['id'] as string, req.body as Partial<z.infer<typeof unitSchema>>));
    }),
  );

  router.delete(
    '/units/:id',
    requirePermission('org.manage'),
    asyncHandler(async (req, res) => {
      await service.deleteUnit(contextOf(req), req.params['id'] as string);
      res.status(204).end();
    }),
  );

  router.get(
    '/positions',
    requirePermission('org.read', 'org.manage', 'employees.read'),
    asyncHandler(async (req, res) => {
      res.json(await service.listPositions(contextOf(req)));
    }),
  );

  router.post(
    '/positions',
    requirePermission('org.manage'),
    validate(positionSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.createPosition(contextOf(req), req.body as z.infer<typeof positionSchema>));
    }),
  );

  router.put(
    '/positions/:id',
    requirePermission('org.manage'),
    validate(positionSchema.partial()),
    asyncHandler(async (req, res) => {
      res.json(await service.updatePosition(contextOf(req), req.params['id'] as string, req.body as Partial<z.infer<typeof positionSchema>>));
    }),
  );

  router.delete(
    '/positions/:id',
    requirePermission('org.manage'),
    asyncHandler(async (req, res) => {
      await service.deletePosition(contextOf(req), req.params['id'] as string);
      res.status(204).end();
    }),
  );

  return router;
}
