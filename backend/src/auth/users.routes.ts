import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, compact, pagedQuery, validate, validateQuery } from '../common/http.js';
import { requireRole } from './require-auth.middleware.js';
import { AuthService } from './auth.service.js';
import type { UserRepository } from './user.repository.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { GuardFailedError, NotFoundError } from '../workflow/errors.js';

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'] as const;

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  /** Optional: when omitted a temporary password is generated. */
  password: z.string().min(8).optional(),
  /** Email the person their login details; they must set a new password on first sign-in. */
  sendInvitation: z.boolean().default(false),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

const passwordSchema = z.object({ password: z.string().min(8) });

/** What the admin screen sees of an account (never the hash). */
function view(u: {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  mustChangePassword: boolean;
  invitedAt: Date | null;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
    invitedAt: u.invitedAt,
    passwordChangedAt: u.passwordChangedAt,
    lastLoginAt: u.lastLoginAt,
  };
}

/**
 * ADMIN-only staff management: create accounts, assign groups, reset
 * passwords, and invite. An invitation emails the login link plus a
 * temporary password; the person must replace it at first sign-in. Until
 * they do, the invitation can be re-sent (with a fresh temporary password).
 */
export function usersRouter(
  users: UserRepository,
  notifications: NotificationService,
  appUrl: string,
): Router {
  const router = Router();
  router.use(requireRole('ADMIN'));

  const listQuerySchema = z.object({
    q: z.string().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });

  const sendInvitation = (user: { id: string; name: string; email: string }, tempPassword: string) =>
    notifications.notifyExternal(
      user.email,
      'staff.invitation',
      { name: user.name, email: user.email, tempPassword, linkUrl: `${appUrl}/login` },
      { entity: 'USER', entityId: user.id },
    );

  /** Server-side paged staff list: { items, total }. */
  router.get(
    '/',
    validateQuery(listQuerySchema),
    asyncHandler(async (req, res) => {
      res.json(await users.listPaged(pagedQuery(req)));
    }),
  );

  router.post(
    '/',
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as z.infer<typeof createSchema>;
      const generated = !body.password;
      const password = body.password ?? AuthService.generateTempPassword();
      const now = new Date();

      const user = await users.create({
        name: body.name,
        role: body.role,
        email: body.email.toLowerCase(),
        passwordHash: await AuthService.hashPassword(password),
        // Anything the admin typed or we generated is temporary by definition.
        mustChangePassword: true,
        invitedAt: body.sendInvitation ? now : null,
      });
      if (body.sendInvitation) await sendInvitation(user, password);

      res.status(201).json({
        ...view(user),
        // Only when nobody else will ever see it: the admin has to pass it on by hand.
        ...(generated && !body.sendInvitation ? { tempPassword: password } : {}),
      });
    }),
  );

  /**
   * (Re)send the invitation. Allowed only while the person has not signed
   * in and chosen their own password — after that, a resend would silently
   * replace a password they know with one they don't.
   */
  router.post(
    '/:id/invite',
    asyncHandler(async (req, res) => {
      const id = req.params['id'] as string;
      const user = await users.findById(id);
      if (!user) throw new NotFoundError('user', id);
      if (!user.active) throw new GuardFailedError('USER_INACTIVE', 'the account is deactivated');
      if (user.passwordChangedAt || !user.mustChangePassword) {
        throw new GuardFailedError(
          'ALREADY_ACTIVE',
          'this person has already signed in and set their own password',
        );
      }
      const tempPassword = AuthService.generateTempPassword();
      const updated = await users.update(id, {
        passwordHash: await AuthService.hashPassword(tempPassword),
        mustChangePassword: true,
        invitedAt: new Date(),
      });
      await sendInvitation(updated, tempPassword);
      res.json(view(updated));
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
      res.json(view(user));
    }),
  );

  /**
   * Delete a staff account. Refused for yourself, and for accounts that own
   * history the system must keep (contracts, custody forms, offboardings,
   * requests) — deactivate those instead.
   */
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = req.params['id'] as string;
      if (id === req.actor?.id) throw new GuardFailedError('SELF_LOCKOUT', 'you cannot delete your own account');
      const user = await users.findById(id);
      if (!user) throw new NotFoundError('user', id);
      try {
        await users.remove(id);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2003') {
          throw new GuardFailedError(
            'USER_HAS_HISTORY',
            'this account created records the system must keep — deactivate it instead of deleting',
          );
        }
        throw err;
      }
      res.status(204).end();
    }),
  );

  /** Admin sets a temporary password by hand; the person must change it next time. */
  router.post(
    '/:id/reset-password',
    validate(passwordSchema),
    asyncHandler(async (req, res) => {
      const { password } = req.body as z.infer<typeof passwordSchema>;
      await users.update(req.params['id'] as string, {
        passwordHash: await AuthService.hashPassword(password),
        mustChangePassword: true,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
