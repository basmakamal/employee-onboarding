import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../../common/http.js';
import { requireRole } from '../../auth/require-auth.middleware.js';
import { mailSettingsSchema, type SettingsService } from './settings.service.js';
import type { SlaRuleRepository } from '../../workflow/sla-rule.repository.js';
import type { OwnershipService } from '../../workflow/ownership.service.js';

const testSchema = z.object({ to: z.string().email() });

const ruleUpdateSchema = z.object({
  afterValue: z.number().int().positive().optional(),
  afterUnit: z.enum(['HOURS', 'CALENDAR_DAYS', 'WORKING_DAYS']).optional(),
  notifySubject: z.boolean().optional(),
  notifyHr: z.boolean().optional(),
  notifyRole: z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN']).optional(),
  escalateToRole: z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN']).nullable().optional(),
  active: z.boolean().optional(),
});

const ownershipSchema = z.object({
  roles: z.array(z.enum(['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'])).min(1),
});

/** ADMIN-only system settings. */
export function settingsRouter(
  service: SettingsService,
  slaRules: SlaRuleRepository,
  ownership: OwnershipService,
): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  // ---- Status ownership (which group handles which status) ----
  router.get(
    '/ownership',
    asyncHandler(async (_req, res) => {
      res.json(await ownership.list());
    }),
  );

  router.put(
    '/ownership/:id',
    validate(ownershipSchema),
    asyncHandler(async (req, res) => {
      const { roles } = req.body as z.infer<typeof ownershipSchema>;
      res.json(await ownership.update(req.params['id'] as string, roles));
    }),
  );

  // ---- Automation (SLA) rules ----
  router.get(
    '/sla',
    asyncHandler(async (_req, res) => {
      res.json(await slaRules.list());
    }),
  );

  router.put(
    '/sla/:id',
    validate(ruleUpdateSchema),
    asyncHandler(async (req, res) => {
      const changes = req.body as z.infer<typeof ruleUpdateSchema>;
      res.json(
        await slaRules.update(req.params['id'] as string, {
          ...compact(changes),
          // nullable escalateToRole must survive compact()
          ...(changes.escalateToRole === null ? { escalateToRole: null } : {}),
        }),
      );
    }),
  );

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
