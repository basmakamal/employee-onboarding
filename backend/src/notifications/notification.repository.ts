import type { Db } from '../common/prisma.js';
import type { NotificationChannel } from '../generated/prisma/enums.js';

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  create(data: {
    channel: NotificationChannel;
    recipientUserId?: string;
    recipientEmail?: string;
    locale?: string;
    subject?: string;
    body: string;
    entity?: string;
    entityId?: string;
  }) {
    return this.db.notification.create({ data });
  }

  markSent(id: string, sentAt: Date) {
    return this.db.notification.update({ where: { id }, data: { status: 'SENT', sentAt } });
  }

  markFailed(id: string) {
    return this.db.notification.update({ where: { id }, data: { status: 'FAILED' } });
  }

  /** In-app bell: unread first, newest first. */
  listForUser(userId: string, limit = 20) {
    return this.db.notification.findMany({
      where: { recipientUserId: userId, channel: 'IN_APP' },
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  markRead(id: string, readAt: Date) {
    return this.db.notification.update({ where: { id }, data: { readAt } });
  }

  unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({
      where: { recipientUserId: userId, channel: 'IN_APP', readAt: null },
    });
  }

  markAllRead(userId: string, readAt: Date) {
    return this.db.notification.updateMany({
      where: { recipientUserId: userId, channel: 'IN_APP', readAt: null },
      data: { readAt },
    });
  }
}
