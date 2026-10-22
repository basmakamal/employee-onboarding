import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import type { AssetService } from './asset.service.js';
import type { Actor } from '../../workflow/engine.js';

const assetSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
});

const itemSchema = z.object({
  assetId: z.string().optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  serialNumber: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  condition: z.enum(['NEW', 'USED']).default('NEW'),
  notes: z.string().optional(),
});

const createFormSchema = z.object({
  employeeId: z.string().min(1),
  deliveryDate: z.coerce.date().optional(),
  items: z.array(itemSchema).min(1),
});

const itemsSchema = z.object({ items: z.array(itemSchema).min(1) });

/** Staff endpoints: the asset registry + custody form lifecycle. */
export function assetRouter(service: AssetService): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  // Registry
  router.get(
    '/assets',
    asyncHandler(async (_req, res) => {
      res.json(await service.listAssets());
    }),
  );
  router.post(
    '/assets',
    requireRole('IT', 'ADMIN'),
    validate(assetSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.createAsset(compact(req.body as z.infer<typeof assetSchema>)));
    }),
  );

  // Custody forms
  router.post(
    '/asset-forms',
    requireRole('IT', 'ADMIN'),
    validate(createFormSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof createFormSchema>;
      res.status(201).json(
        await service.createForm(
          compact({ ...input, items: input.items.map((i) => compact(i)) }),
          actor(req),
        ),
      );
    }),
  );

  router.put(
    '/asset-forms/:id/items',
    requireRole('IT', 'ADMIN'),
    validate(itemsSchema),
    asyncHandler(async (req, res) => {
      const { items } = req.body as z.infer<typeof itemsSchema>;
      res.json(
        await service.replaceItems(
          req.params['id'] as string,
          items.map((i) => compact(i)),
          actor(req),
        ),
      );
    }),
  );

  router.post(
    '/asset-forms/:id/actions/send',
    asyncHandler(async (req, res) => {
      res.json(await service.send(req.params['id'] as string, actor(req)));
    }),
  );
  router.post(
    '/asset-forms/:id/actions/cancel',
    asyncHandler(async (req, res) => {
      res.json(await service.cancel(req.params['id'] as string, actor(req)));
    }),
  );
  router.post(
    '/asset-forms/:id/actions/revise',
    asyncHandler(async (req, res) => {
      res.json(await service.revise(req.params['id'] as string, actor(req)));
    }),
  );

  return router;
}
