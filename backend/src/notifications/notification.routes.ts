import { Router } from 'express';
import { asyncHandler } from '../common/http.js';
import type { NotificationRepository } from './notification.repository.js';

/** The signed-in user's in-app bell. */
export function notificationRouter(notifications: NotificationRepository): Router {
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

  return router;
}
