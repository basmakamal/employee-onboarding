import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import type { OffboardingService } from './offboarding.service.js';
import type { Actor } from '../../workflow/engine.js';

const createSchema = z.object({
  employeeId: z.string().min(1),
  reason: z.enum(['RESIGNATION', 'TERMINATION', 'CONTRACT_EXPIRY', 'RETIREMENT', 'DEATH']),
  notes: z.string().optional(),
});

const settlementSchema = z.object({
  workingDays: z.number().int().min(0),
  leaveDays: z.number().min(0),
  deductions: z.number().min(0),
  entitlements: z.number().min(0),
  notes: z.string().optional(),
});

const ACTIONS = {
  start: 'start',
  'to-asset-return': 'toAssetReturn',
  'confirm-assets': 'confirmAssetsReturned',
  'to-settlement': 'toSettlement',
  close: 'close',
  cancel: 'cancel',
} as const;

export function offboardingRouter(service: OffboardingService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  /** HR opens the termination request (machine enforces the rest). */
  router.post(
    '/',
    requireRole('HR', 'ADMIN'),
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const { employeeId, reason, notes } = req.body as z.infer<typeof createSchema>;
      res.status(201).json(await service.create(employeeId, reason, actor(req), notes));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await service.get(req.params['id'] as string, actor(req)));
    }),
  );

  router.post(
    '/:id/actions/:action',
    asyncHandler(async (req, res) => {
      const key = req.params['action'] as keyof typeof ACTIONS;
      const method = ACTIONS[key];
      if (!method) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `unknown action ${key}` } });
        return;
      }
      res.json(await service[method](req.params['id'] as string, actor(req)));
    }),
  );

  /** HR marks one custody item as physically returned. */
  router.put(
    '/:id/assets/:itemId/return',
    requireRole('HR', 'ADMIN'),
    asyncHandler(async (req, res) => {
      res.json(
        await service.markItemReturned(
          req.params['id'] as string,
          req.params['itemId'] as string,
          actor(req),
        ),
      );
    }),
  );

  /** Settlement amounts (HR or FINANCE enter; only FINANCE closes). */
  router.put(
    '/:id/settlement',
    requireRole('HR', 'FINANCE', 'ADMIN'),
    validate(settlementSchema),
    asyncHandler(async (req, res) => {
      const amounts = compact(req.body as z.infer<typeof settlementSchema>);
      res.json(await service.recordSettlement(req.params['id'] as string, amounts, actor(req)));
    }),
  );

  return router;
}
