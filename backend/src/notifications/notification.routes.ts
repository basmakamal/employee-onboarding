import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, pagedQuery, validateQuery } from '../common/http.js';
import { requirePermission } from '../auth/authz/authorize.js';
import type { NotificationRepository } from './notification.repository.js';
import type { NotificationService } from './notification.service.js';

const logQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  channel: z.enum(['EMAIL', 'IN_APP']).optional(),
  templateKey: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
});

/** The signed-in user's bell, plus the HR/ADMIN email history. */
export function notificationRouter(
  notifications: NotificationRepository,
  service: NotificationService,
): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const userId = req.actor?.id ?? '';
      const [items, unread] = await Promise.all([
        notifications.listForUser(userId),
        notifications.unreadCount(userId),
      ]);
      res.json({ items, unread });
    }),
  );

  router.post(
    '/read-all',
    asyncHandler(async (req, res) => {
      await notifications.markAllRead(req.actor?.id ?? '', new Date());
      res.status(204).end();
    }),
  );

  /** Every message the system has sent — the audit trail for email. */
  router.get(
    '/log',
    requirePermission('emails.view'),
    validateQuery(logQuerySchema),
    asyncHandler(async (req, res) => {
      const q = pagedQuery<z.infer<typeof logQuerySchema>>(req);
      res.json(
        await notifications.listLog({
          page: q.page,
          limit: q.limit,
          ...(q.status ? { status: q.status } : {}),
          ...(q.channel ? { channel: q.channel } : {}),
          ...(q.templateKey ? { templateKey: q.templateKey } : {}),
          ...(q.q ? { q: q.q } : {}),
        }),
      );
    }),
  );

  router.post(
    '/:id/resend',
    requirePermission('emails.view'),
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.resend(req.params['id'] as string));
    }),
  );

  return router;
}
