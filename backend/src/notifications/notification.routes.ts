import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, pagedQuery, validateQuery } from '../common/http.js';
import type { NotificationRepository } from './notification.repository.js';

const listQuerySchema = z.object({
  /** The bell wants a handful; the mobile inbox wants a page. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
});

/** The signed-in user's in-app notifications: web bell and mobile inbox. */
export function notificationRouter(notifications: NotificationRepository): Router {
  const router = Router();

  router.get(
    '/',
    validateQuery(listQuerySchema),
    asyncHandler(async (req, res) => {
      const userId = req.actor?.id ?? '';
      const { limit, unreadOnly } = pagedQuery<z.infer<typeof listQuerySchema>>(req);
      const [items, unread] = await Promise.all([
        notifications.listForUser(userId, limit, unreadOnly),
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

  return router;
}
