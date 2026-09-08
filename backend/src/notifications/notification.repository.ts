import type { Db } from '../common/prisma.js';
import type { NotificationChannel, NotificationStatus } from '../generated/prisma/enums.js';

export interface LogQuery {
  page: number;
  limit: number;
  status?: NotificationStatus;
  channel?: NotificationChannel;
  templateKey?: string;
  /** Matches recipient email, recipient name, or subject. */
  q?: string;
}

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
    templateKey?: string | null;
    templateVersion?: number | null;
  }) {
    return this.db.notification.create({ data });
  }

  findById(id: string) {
    return this.db.notification.findUnique({ where: { id } });
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

  /** The admin/HR email history: one page, newest first, with filters. */
  async listLog(query: LogQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.templateKey ? { templateKey: query.templateKey } : {}),
      ...(query.q
        ? {
            OR: [
              { recipientEmail: { contains: query.q } },
              { subject: { contains: query.q } },
              { recipient: { is: { name: { contains: query.q } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { recipient: { select: { name: true, email: true } } },
      }),
      this.db.notification.count({ where }),
    ]);
    return { items, total };
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
