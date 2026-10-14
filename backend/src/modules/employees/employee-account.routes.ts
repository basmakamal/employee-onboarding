import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../common/http.js';
import { requirePermission } from '../../auth/authz/authorize.js';
import type { Actor } from '../../workflow/engine.js';
import type { EmployeeAccountService } from './employee-account.service.js';
import { readinessOf } from './readiness.js';

const createSchema = z.object({
  /** Defaults to the employee's own e-mail. */
  email: z.string().trim().email().optional(),
  /** E-mail the temporary password (true), or show it once to HR (false). */
  sendInvitation: z.boolean().default(true),
});

/** /api/employees/:id/account — the employee's self-service sign-in, managed by HR. */
export function employeeAccountRouter(
  service: EmployeeAccountService,
  /** Loads what the readiness checklist needs. */
  readinessSource?: (employeeId: string) => Promise<Parameters<typeof readinessOf>[0] | null>,
): Router {
  const router = Router();
  const actor = (req: { actor?: Actor }): Actor => req.actor ?? { type: 'USER' };

  /** Ready to work and be paid? The checklist the employee file shows. */
  router.get(
    '/:id/readiness',
    asyncHandler(async (req, res) => {
      const input = readinessSource ? await readinessSource(req.params['id'] as string) : null;
      if (!input) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'employee not found' } });
        return;
      }
      res.json(readinessOf(input));
    }),
  );

  router.get(
    '/:id/account',
    asyncHandler(async (req, res) => {
      res.json({ account: await service.get(req.params['id'] as string, actor(req)) });
    }),
  );

  router.post(
    '/:id/account',
    requirePermission('employees.write'),
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createSchema>;
      res.status(201).json(await service.create(req.params['id'] as string, body, actor(req)));
    }),
  );

  router.put(
    '/:id/account',
    requirePermission('employees.write'),
    validate(z.object({ active: z.boolean() })),
    asyncHandler(async (req, res) => {
      const { active } = req.body as { active: boolean };
      res.json({ account: await service.setActive(req.params['id'] as string, active, actor(req)) });
    }),
  );

  router.post(
    '/:id/account/reset-password',
    requirePermission('employees.write'),
    validate(z.object({ sendInvitation: z.boolean().default(true) })),
    asyncHandler(async (req, res) => {
      const { sendInvitation } = req.body as { sendInvitation: boolean };
      res.json(await service.resetPassword(req.params['id'] as string, { sendInvitation }, actor(req)));
    }),
  );

  return router;
}
