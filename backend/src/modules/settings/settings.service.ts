import { z } from 'zod';
import nodemailer, { type Transporter } from 'nodemailer';
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

export const calendarSchema = z.object({
  /** Weekend day numbers, JS getUTCDay(): 0=Sun … 5=Fri, 6=Sat. */
  weekendDays: z.array(z.number().int().min(0).max(6)).min(0).max(6),
});

export type CalendarSettings = z.infer<typeof calendarSchema>;

/** Friday + Saturday (Saudi Arabia). */
const DEFAULT_CALENDAR: CalendarSettings = { weekendDays: [5, 6] };

const MAIL_KEY = 'mail';
const CALENDAR_KEY = 'calendar';
const CACHE_MS = 30_000;

export class SettingsService {
  private cached: { value: MailSettings; at: number } | null = null;
  private calendarCache: { value: CalendarSettings; at: number } | null = null;
  /** Pooled transporter, keyed by the settings object it was built from. */
  private transportCache: {
    key: MailSettings;
    value: { transporter: Transporter; from: string } | null;
  } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  /** Work calendar (weekend days) — used by the SLA working-day math. */
  async getCalendar(): Promise<CalendarSettings> {
    if (this.calendarCache && Date.now() - this.calendarCache.at < CACHE_MS) {
      return this.calendarCache.value;
    }
    const row = await this.prisma.setting.findUnique({ where: { key: CALENDAR_KEY } });
    const value = row ? calendarSchema.parse(JSON.parse(row.value)) : DEFAULT_CALENDAR;
    this.calendarCache = { value, at: Date.now() };
    return value;
  }

  async updateCalendar(input: CalendarSettings): Promise<CalendarSettings> {
    await this.prisma.setting.upsert({
      where: { key: CALENDAR_KEY },
      update: { value: JSON.stringify(input) },
      create: { key: CALENDAR_KEY, value: JSON.stringify(input) },
    });
    this.calendarCache = null;
    return input;
  }

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

  /**
   * Pooled transporter from the current settings (throws when smtp is
   * incomplete). Reused for every message until the settings cache turns
   * over — the old per-message transport re-did the SMTP handshake on
   * every single email.
   */
  async buildTransport() {
    const settings = await this.getMailSettings();
    // Same cached settings object → same pooled transporter.
    if (this.transportCache && this.transportCache.key === settings) {
      return this.transportCache.value;
    }
    this.transportCache?.value?.transporter.close();

    let value: { transporter: Transporter; from: string } | null = null;
    if (settings.provider !== 'console') {
      if (!settings.host || !settings.user || !settings.password) {
        throw new GuardFailedError(
          'MAIL_INCOMPLETE',
          'mail settings are incomplete: host, user and password are required',
        );
      }
      value = {
        transporter: nodemailer.createTransport({
          pool: true,
          maxConnections: 3,
          host: settings.host,
          port: settings.port ?? 587,
          secure: false, // STARTTLS on 587 for gmail + office365
          auth: { user: settings.user, pass: settings.password },
        }),
        from: settings.from ?? settings.user,
      };
    }
    this.transportCache = { key: settings, value };
    return value;
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
      // Both parts: nodemailer sends multipart/alternative, so clients that
      // block HTML still get a readable message.
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }
}
