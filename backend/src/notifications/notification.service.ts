import type { NotificationRepository } from './notification.repository.js';
import type { Notifier, OutboundMessage } from './notifier.js';
import { renderTemplate, type Locale } from './templates.js';
import type { UserRepository } from '../auth/user.repository.js';
import { logger } from '../common/logger.js';

interface EntityRef {
  entity: string;
  entityId: string;
}

/** Hands a persisted, ready-to-send email to the queue worker. */
export type MailEnqueuer = (job: {
  notificationId: string;
  message: OutboundMessage;
}) => Promise<unknown>;

/**
 * One door for all outbound notifications:
 *   - every email is persisted first (PENDING), then delivered, then marked
 *     SENT or FAILED — the notifications table is a complete send log
 *   - staff notifications also create an IN_APP row (the bell)
 * Delivery is either inline (no Redis — original behavior) or handed to the
 * BullMQ mail queue, which retries transient failures in the worker before
 * marking the row FAILED. Either way, a broken mailer never breaks the
 * workflow that triggered the message.
 */
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly users: UserRepository,
    private readonly notifier: Notifier,
    /** When present, emails are queued instead of sent in the request path. */
    private readonly enqueue?: MailEnqueuer,
  ) {}

  /** Email an external person (trainee / employee). Arabic by default. */
  async notifyExternal(
    email: string,
    templateKey: string,
    params: { name?: string; daysWaiting?: number; linkUrl?: string },
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    const message = renderTemplate(templateKey, locale, params);
    const row = await this.notifications.create({
      channel: 'EMAIL',
      recipientEmail: email,
      locale,
      subject: message.subject,
      body: message.text,
      ...ref,
    });
    await this.deliver(row.id, {
      to: email,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }

  /** Notify every active HR user: email + in-app bell entry. */
  notifyHr(
    templateKey: string,
    params: { name?: string; daysWaiting?: number; linkUrl?: string },
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    return this.notifyRole('HR', templateKey, params, ref, locale);
  }

  /** Notify every active user of a role group: email + in-app bell entry. */
  async notifyRole(
    role: string,
    templateKey: string,
    params: { name?: string; status?: string; daysWaiting?: number; linkUrl?: string },
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    const staff = await this.users.listActiveByRole(role as never);
    const message = renderTemplate(templateKey, locale, params);

    for (const user of staff) {
      await this.notifications.create({
        channel: 'IN_APP',
        recipientUserId: user.id,
        locale,
        subject: message.subject,
        body: message.text,
        ...ref,
      });

      const emailRow = await this.notifications.create({
        channel: 'EMAIL',
        recipientUserId: user.id,
        recipientEmail: user.email,
        locale,
        subject: message.subject,
        body: message.text,
        ...ref,
      });
      await this.deliver(emailRow.id, {
        to: user.email,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    }
  }

  /**
   * Queue when a queue is wired, otherwise send inline. Both paths swallow
   * failures after recording them — callers never see mailer errors.
   */
  private async deliver(notificationId: string, message: OutboundMessage): Promise<void> {
    if (this.enqueue) {
      try {
        await this.enqueue({ notificationId, message });
      } catch (err) {
        // Redis down: fall back to inline so the message still goes out.
        logger.error({ err, notificationId }, 'mail enqueue failed — sending inline');
        await this.sendInline(notificationId, message);
      }
      return;
    }
    await this.sendInline(notificationId, message);
  }

  private async sendInline(notificationId: string, message: OutboundMessage): Promise<void> {
    try {
      await this.notifier.send(message);
      await this.notifications.markSent(notificationId, new Date());
    } catch (err) {
      logger.error({ err, notificationId }, 'email send failed');
      await this.notifications.markFailed(notificationId);
    }
  }
}
