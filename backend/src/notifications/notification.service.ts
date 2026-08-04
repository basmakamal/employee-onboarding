import type { NotificationRepository } from './notification.repository.js';
import type { Notifier } from './notifier.js';
import { renderTemplate, type Locale } from './templates.js';
import type { UserRepository } from '../auth/user.repository.js';
import { logger } from '../common/logger.js';

interface EntityRef {
  entity: string;
  entityId: string;
}

/**
 * One door for all outbound notifications:
 *   - every email is persisted first (PENDING), then sent, then marked
 *     SENT or FAILED — the notifications table is a complete send log
 *   - staff notifications also create an IN_APP row (the bell)
 * Failures are logged, never thrown — a broken mailer must not break the
 * workflow that triggered the message.
 */
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly users: UserRepository,
    private readonly notifier: Notifier,
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
    try {
      await this.notifier.send({ to: email, subject: message.subject, text: message.text });
      await this.notifications.markSent(row.id, new Date());
    } catch (err) {
      logger.error({ err, notificationId: row.id }, 'email send failed');
      await this.notifications.markFailed(row.id);
    }
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
      try {
        await this.notifier.send({ to: user.email, subject: message.subject, text: message.text });
        await this.notifications.markSent(emailRow.id, new Date());
      } catch (err) {
        logger.error({ err, notificationId: emailRow.id }, 'email send failed');
        await this.notifications.markFailed(emailRow.id);
      }
    }
  }
}
