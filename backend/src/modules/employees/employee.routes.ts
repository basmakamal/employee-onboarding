import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import type { EmployeeService } from './employee.service.js';
import type { Actor } from '../../workflow/engine.js';

const processActionSchema = z.object({
  holdReason: z.string().optional(),
  holdNote: z.string().optional(),
  certificateStorageKey: z.string().optional(),
});

const KINDS = ['gosi', 'medical', 'criminal'] as const;

export function employeeRouter(service: EmployeeService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await service.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await service.getDetails(req.params['id'] as string, actor(req)));
    }),
  );

  /** POST /:id/processes/:kind/actions/:action — the three process cards. */
  router.post(
    '/:id/processes/:kind/actions/:action',
    validate(processActionSchema),
    asyncHandler(async (req, res) => {
      const kind = req.params['kind'] as (typeof KINDS)[number];
      if (!KINDS.includes(kind)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `unknown process ${kind}` } });
        return;
      }
      const input = compact(req.body as z.infer<typeof processActionSchema>);
      res.json(
        await service.actOnProcess(
          req.params['id'] as string,
          kind,
          (req.params['action'] as string).toUpperCase(),
          actor(req),
          input,
        ),
      );
    }),
  );

  return router;
}
