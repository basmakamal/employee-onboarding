import type { NotificationRepository } from './notification.repository.js';
import type { Notifier, OutboundMessage } from './notifier.js';
import { renderTemplate, type Locale, type RenderedMessage, type TemplateParams } from './templates.js';
import type { UserRepository } from '../auth/user.repository.js';
import { logger } from '../common/logger.js';
import { NotFoundError } from '../workflow/errors.js';

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
 * Resolves a template key to a message. Injected so the admin-editable
 * templates (TemplateService) can take over from the code defaults; the
 * fallback below is the code path on its own.
 */
export type RenderFn = (
  key: string,
  locale: Locale,
  params: TemplateParams,
) => Promise<RenderedMessage & { templateKey?: string; templateVersion?: number | null }>;

const renderFromCode: RenderFn = (key, locale, params) =>
  Promise.resolve({ ...renderTemplate(key, locale, params), templateKey: key, templateVersion: null });

/**
 * One door for all outbound notifications:
 *   - every email is persisted first (PENDING), then delivered, then marked
 *     SENT or FAILED — the notifications table is a complete send log
 *   - staff notifications also create an IN_APP row (the bell)
 *   - each row records the template (and version) that produced it
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
    /** Realtime nudge after an IN_APP row is created for a user. */
    private readonly onInApp?: (userId: string) => void,
    /** Template resolution — defaults to the built-in code templates. */
    private readonly render: RenderFn = renderFromCode,
  ) {}

  /** Email an external person (trainee / employee). Arabic by default. */
  async notifyExternal(
    email: string,
    templateKey: string,
    params: TemplateParams,
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    const message = await this.render(templateKey, locale, params);
    const row = await this.notifications.create({
      channel: 'EMAIL',
      recipientEmail: email,
      locale,
      subject: message.subject,
      body: message.text,
      templateKey: message.templateKey ?? templateKey,
      templateVersion: message.templateVersion ?? null,
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
    params: TemplateParams,
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    return this.notifyRole('HR', templateKey, params, ref, locale);
  }

  /** Notify every active user of a role group: email + in-app bell entry. */
  async notifyRole(
    role: string,
    templateKey: string,
    params: TemplateParams,
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    const staff = await this.users.listActiveByRole(role as never);
    await this.fanOut(staff, templateKey, params, ref, locale);
  }

  /**
   * The role group that owns the current status ALWAYS gets the message;
   * the named primary owners get it in addition. One message per person
   * even when an owner is also in the group.
   */
  async notifyRoleAndUsers(
    role: string,
    userIds: string[],
    templateKey: string,
    params: TemplateParams,
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    const [group, owners] = await Promise.all([
      this.users.listActiveByRole(role as never),
      this.users.listActiveByIds(userIds),
    ]);
    const seen = new Set<string>();
    const staff = [...group, ...owners].filter((u) => !seen.has(u.id) && seen.add(u.id));
    await this.fanOut(staff, templateKey, params, ref, locale);
  }

  /** Notify specific people (the named primary owners of a process). */
  async notifyUsers(
    userIds: string[],
    templateKey: string,
    params: TemplateParams,
    ref?: EntityRef,
    locale: Locale = 'ar',
  ): Promise<void> {
    const staff = await this.users.listActiveByIds(userIds);
    await this.fanOut(staff, templateKey, params, ref, locale);
  }

  private async fanOut(
    staff: Array<{ id: string; email: string }>,
    templateKey: string,
    params: TemplateParams,
    ref: EntityRef | undefined,
    locale: Locale,
  ): Promise<void> {
    if (staff.length === 0) return;
    const message = await this.render(templateKey, locale, params);
    const stamp = {
      templateKey: message.templateKey ?? templateKey,
      templateVersion: message.templateVersion ?? null,
    };

    for (const user of staff) {
      await this.notifications.create({
        channel: 'IN_APP',
        recipientUserId: user.id,
        locale,
        subject: message.subject,
        body: message.text,
        ...stamp,
        ...ref,
      });
      // Nudge the user's open browser tabs (SSE) — best-effort.
      this.onInApp?.(user.id);

      const emailRow = await this.notifications.create({
        channel: 'EMAIL',
        recipientUserId: user.id,
        recipientEmail: user.email,
        locale,
        subject: message.subject,
        body: message.text,
        ...stamp,
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
   * Send a logged email again, as a NEW row, so the history shows both the
   * original attempt and the resend. The stored body is the plain-text
   * version — that is what goes out; the HTML alternative is not retained.
   */
  async resend(notificationId: string) {
    const original = await this.notifications.findById(notificationId);
    if (!original || original.channel !== 'EMAIL' || !original.recipientEmail) {
      throw new NotFoundError('email', notificationId);
    }
    const copy = await this.notifications.create({
      channel: 'EMAIL',
      recipientEmail: original.recipientEmail,
      ...(original.recipientUserId ? { recipientUserId: original.recipientUserId } : {}),
      locale: original.locale,
      ...(original.subject ? { subject: original.subject } : {}),
      body: original.body,
      templateKey: original.templateKey,
      templateVersion: original.templateVersion,
      ...(original.entity ? { entity: original.entity } : {}),
      ...(original.entityId ? { entityId: original.entityId } : {}),
    });
    await this.deliver(copy.id, {
      to: original.recipientEmail,
      subject: original.subject ?? '',
      text: original.body,
    });
    return copy;
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
