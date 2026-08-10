import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, validate } from '../common/http.js';
import { requireRole } from './require-auth.middleware.js';
import { AuthService } from './auth.service.js';
import type { UserRepository } from './user.repository.js';
import { GuardFailedError } from '../workflow/errors.js';

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'] as const;

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  password: z.string().min(8),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

const passwordSchema = z.object({ password: z.string().min(8) });

/** ADMIN-only staff management: create accounts, assign groups, reset passwords. */
export function usersRouter(users: UserRepository): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await users.list());
    }),
  );

  router.post(
    '/',
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const { password, ...data } = req.body as z.infer<typeof createSchema>;
      const user = await users.create({
        ...data,
        email: data.email.toLowerCase(),
        passwordHash: await AuthService.hashPassword(password),
      });
      res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
    }),
  );

  router.put(
    '/:id',
    validate(updateSchema),
    asyncHandler(async (req, res) => {
      const id = req.params['id'] as string;
      const changes = compact(req.body as z.infer<typeof updateSchema>);
      if (changes.email) changes.email = changes.email.toLowerCase();
      // Self-lockout guard: admins cannot demote or deactivate themselves.
      if (id === req.actor?.id && (changes.role !== undefined || changes.active !== undefined)) {
        throw new GuardFailedError('SELF_LOCKOUT', 'you cannot change your own role or status');
      }
      const user = await users.update(id, changes);
      res.json({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });
    }),
  );

  router.post(
    '/:id/reset-password',
    validate(passwordSchema),
    asyncHandler(async (req, res) => {
      const { password } = req.body as z.infer<typeof passwordSchema>;
      await users.update(req.params['id'] as string, {
        passwordHash: await AuthService.hashPassword(password),
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
