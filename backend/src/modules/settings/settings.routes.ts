import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import { mailSettingsSchema, type SettingsService } from './settings.service.js';

const testSchema = z.object({ to: z.string().email() });

/** ADMIN-only system settings. */
export function settingsRouter(service: SettingsService): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  router.get(
    '/mail',
    asyncHandler(async (_req, res) => {
      res.json(await service.getMailSettingsMasked());
    }),
  );

  router.put(
    '/mail',
    validate(mailSettingsSchema),
    asyncHandler(async (req, res) => {
      await service.updateMailSettings(req.body as never);
      res.json(await service.getMailSettingsMasked());
    }),
  );

  router.post(
    '/mail/test',
    validate(testSchema),
    asyncHandler(async (req, res) => {
      const { to } = req.body as z.infer<typeof testSchema>;
      await service.sendTest(to);
      res.json({ ok: true });
    }),
  );

  return router;
}
