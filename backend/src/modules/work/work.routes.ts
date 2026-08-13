import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, pagedQuery, validateQuery } from '../../common/http.js';
import { UnauthorizedError } from '../../workflow/errors.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { WorkService } from './work.service.js';

const queueQuerySchema = z.object({
  bucket: z.enum(['overdue', 'today', 'week', 'later']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function actorRole(req: { actor?: { role?: string } }): Role {
  const role = req.actor?.role as Role | undefined;
  if (!role) throw new UnauthorizedError();
  return role;
}

/** GET /api/work — the caller's queue across every machine. */
export function workRouter(service: WorkService): Router {
  const router = Router();

  router.get(
    '/',
    validateQuery(queueQuerySchema),
    asyncHandler(async (req, res) => {
      // Parsed by validateQuery — req.query itself is still raw strings.
      const { bucket, limit } = pagedQuery<z.infer<typeof queueQuerySchema>>(req);
      res.json(await service.queue(actorRole(req), { ...(bucket ? { bucket } : {}), limit }));
    }),
  );

  return router;
}

/** GET /api/me/... — what this session may see and do. */
export function meRouter(service: WorkService): Router {
  const router = Router();

  router.get(
    '/capabilities',
    asyncHandler((req, res) => {
      res.json(service.capabilities(actorRole(req)));
      return Promise.resolve();
    }),
  );

  return router;
}
