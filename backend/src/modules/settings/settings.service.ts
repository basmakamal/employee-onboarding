import { z } from 'zod';
import nodemailer from 'nodemailer';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Notifier, OutboundMessage } from '../../notifications/notifier.js';
import { config } from '../../common/config.js';
import { logger } from '../../common/logger.js';
import { decryptString, encryptString } from '../../common/crypto.js';
import { GuardFailedError } from '../../workflow/errors.js';

export const mailSettingsSchema = z.object({
  provider: z.enum(['console', 'gmail', 'microsoft', 'custom']).default('console'),
  host: z.string().optional(),
  port: z.coerce.number().int().positive().optional(),
  user: z.string().optional(),
  /** Write-only from the API; never returned. */
  password: z.string().optional(),
  from: z.string().optional(),
});

export type MailSettings = z.infer<typeof mailSettingsSchema>;

/** Provider presets — picking gmail/microsoft fills these automatically. */
const PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'smtp.gmail.com', port: 587 },
  microsoft: { host: 'smtp.office365.com', port: 587 },
};

const MAIL_KEY = 'mail';
const CACHE_MS = 30_000;

export class SettingsService {
  private cached: { value: MailSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  /** Current mail settings; env-based defaults when nothing is stored. */
  async getMailSettings(): Promise<MailSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;

    const row = await this.prisma.setting.findUnique({ where: { key: MAIL_KEY } });
    const stored = row ? mailSettingsSchema.parse(JSON.parse(row.value)) : null;
    if (stored?.password) stored.password = decryptString(stored.password);
    const value: MailSettings = stored
      ? stored
      : {
          provider: config.NOTIFIER === 'smtp' ? 'microsoft' : 'console',
          ...(config.SMTP_HOST ? { host: config.SMTP_HOST } : {}),
          ...(config.SMTP_PORT ? { port: config.SMTP_PORT } : {}),
          ...(config.SMTP_USER ? { user: config.SMTP_USER } : {}),
          ...(config.SMTP_PASS ? { password: config.SMTP_PASS } : {}),
          ...(config.MAIL_FROM ? { from: config.MAIL_FROM } : {}),
        };
    this.cached = { value, at: Date.now() };
    return value;
  }

  /** Masked variant for the settings page (password never leaves the server). */
  async getMailSettingsMasked() {
    const { password, ...rest } = await this.getMailSettings();
    return { ...rest, hasPassword: Boolean(password) };
  }

  /** Save; empty password means "keep the existing one". */
  async updateMailSettings(input: MailSettings): Promise<void> {
    const current = await this.getMailSettings();
    const preset = PRESETS[input.provider];
    const next: MailSettings = {
      ...input,
      ...(preset ? { host: preset.host, port: preset.port } : {}),
      ...(input.password ? {} : current.password ? { password: current.password } : {}),
    };
    // Secrets never hit the disk in plaintext.
    const persisted = {
      ...next,
      ...(next.password ? { password: encryptString(next.password) } : {}),
    };
    await this.prisma.setting.upsert({
      where: { key: MAIL_KEY },
      update: { value: JSON.stringify(persisted) },
      create: { key: MAIL_KEY, value: JSON.stringify(persisted) },
    });
    this.cached = null;
  }

  /** Send a test email through whatever is currently configured. */
  async sendTest(to: string): Promise<void> {
    const notifier = new DynamicNotifier(this);
    await notifier.send({
      to,
      subject: 'HR System — test email / رسالة تجريبية',
      text: 'Your email settings work. إعدادات البريد تعمل بنجاح.',
    });
  }

  /** Build a transporter from settings (throws when smtp is incomplete). */
  async buildTransport() {
    const settings = await this.getMailSettings();
    if (settings.provider === 'console') return null;
    if (!settings.host || !settings.user || !settings.password) {
      throw new GuardFailedError(
        'MAIL_INCOMPLETE',
        'mail settings are incomplete: host, user and password are required',
      );
    }
    return {
      transporter: nodemailer.createTransport({
        host: settings.host,
        port: settings.port ?? 587,
        secure: false, // STARTTLS on 587 for gmail + office365
        auth: { user: settings.user, pass: settings.password },
      }),
      from: settings.from ?? settings.user,
    };
  }
}

/**
 * Notifier that follows the admin's saved settings at send time — changing
 * the provider in the settings page applies without a restart.
 */
export class DynamicNotifier implements Notifier {
  constructor(private readonly settings: SettingsService) {}

  async send(message: OutboundMessage): Promise<void> {
    const transport = await this.settings.buildTransport();
    if (!transport) {
      logger.info(
        { to: message.to, subject: message.subject },
        `[email:console] ${message.text.slice(0, 120)}`,
      );
      return;
    }
    await transport.transporter.sendMail({
      from: transport.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
