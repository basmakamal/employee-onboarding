import { z } from 'zod';
import nodemailer, { type Transporter } from 'nodemailer';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Notifier, OutboundMessage } from '../../notifications/notifier.js';
import { config } from '../../common/config.js';
import { logger } from '../../common/logger.js';
import { decryptString, encryptString } from '../../common/crypto.js';
import { GuardFailedError } from '../../workflow/errors.js';
import { storagePath } from '../../common/storage.js';

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

/** Where a company's mail settings came from — shown on the settings page. */
export type MailSource = 'company' | 'main' | 'environment';

interface ResolvedMail {
  value: MailSettings;
  source: MailSource;
}

/** The one thing settings need to know about companies. */
export interface MainCompany {
  mainCompanyId(): Promise<string | null>;
}

/**
 * Settings are kept PER COMPANY: each company has its own mail server (so
 * Tabby's e-mails leave from Tabby's mailbox) and its own weekend days.
 *
 * A company that has not configured mail yet sends through the MAIN
 * company's settings (the oldest company), and failing that the .env
 * defaults — so a new company never goes silent while it is being set up.
 */
export class SettingsService {
  private mailCache = new Map<string, { value: ResolvedMail; at: number }>();
  private calendarCache = new Map<string, { value: CalendarSettings; at: number }>();
  /** Pooled transporter per company, keyed by the settings object it was built from. */
  private transportCache = new Map<
    string,
    { key: MailSettings; value: { transporter: Transporter; from: string } | null }
  >();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly companies?: MainCompany,
  ) {}

  private async readRow(companyId: string, key: string) {
    return this.prisma.setting.findUnique({ where: { companyId_key: { companyId, key } } });
  }

  private async writeRow(companyId: string, key: string, value: unknown) {
    const text = JSON.stringify(value);
    await this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key } },
      update: { value: text },
      create: { companyId, key, value: text },
    });
  }

  // ─────────────────────────────────────────────────────────── calendar

  /** A company's work calendar (weekend days) — used by the SLA working-day math. */
  async getCalendar(companyId: string): Promise<CalendarSettings> {
    const hit = this.calendarCache.get(companyId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const row = await this.readRow(companyId, CALENDAR_KEY);
    const value = row ? calendarSchema.parse(JSON.parse(row.value)) : DEFAULT_CALENDAR;
    this.calendarCache.set(companyId, { value, at: Date.now() });
    return value;
  }

  async updateCalendar(companyId: string, input: CalendarSettings): Promise<CalendarSettings> {
    await this.writeRow(companyId, CALENDAR_KEY, input);
    this.calendarCache.delete(companyId);
    return input;
  }

  // ─────────────────────────────────────────────────────────── mail

  private envDefaults(): MailSettings {
    return {
      provider: config.NOTIFIER === 'smtp' ? 'microsoft' : 'console',
      ...(config.SMTP_HOST ? { host: config.SMTP_HOST } : {}),
      ...(config.SMTP_PORT ? { port: config.SMTP_PORT } : {}),
      ...(config.SMTP_USER ? { user: config.SMTP_USER } : {}),
      ...(config.SMTP_PASS ? { password: config.SMTP_PASS } : {}),
      ...(config.MAIL_FROM ? { from: config.MAIL_FROM } : {}),
    };
  }

  /** The company's own stored settings, or null. */
  private async storedMail(companyId: string): Promise<MailSettings | null> {
    const row = await this.readRow(companyId, MAIL_KEY);
    if (!row) return null;
    const stored = mailSettingsSchema.parse(JSON.parse(row.value));
    if (stored.password) stored.password = decryptString(stored.password);
    return stored;
  }

  /** The settings a company's e-mails actually use: its own → the main company's → .env. */
  private async resolveMail(companyId: string | null): Promise<ResolvedMail> {
    const cacheKey = companyId ?? '';
    const hit = this.mailCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

    let value: ResolvedMail | null = null;
    const own = companyId ? await this.storedMail(companyId) : null;
    if (own) value = { value: own, source: 'company' };
    if (!value) {
      const mainId = await this.companies?.mainCompanyId();
      const main = mainId && mainId !== companyId ? await this.storedMail(mainId) : null;
      if (main) value = { value: main, source: 'main' };
    }
    value ??= { value: this.envDefaults(), source: 'environment' };
    this.mailCache.set(cacheKey, { value, at: Date.now() });
    return value;
  }

  /** Current mail settings for a company (with the fallbacks applied). */
  async getMailSettings(companyId: string | null): Promise<MailSettings> {
    return (await this.resolveMail(companyId)).value;
  }

  /** Masked variant for the settings page (password never leaves the server). */
  async getMailSettingsMasked(companyId: string) {
    const { value, source } = await this.resolveMail(companyId);
    const { password, ...rest } = value;
    return { ...rest, hasPassword: Boolean(password), source };
  }

  /** Save the company's own settings; an empty password means "keep the current one". */
  async updateMailSettings(companyId: string, input: MailSettings): Promise<void> {
    // The password kept is the one this company is using today — its own,
    // or the inherited one when it is taking over the main company's box.
    const current = await this.getMailSettings(companyId);
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
    await this.writeRow(companyId, MAIL_KEY, persisted);
    // Another company may have been inheriting these settings.
    this.mailCache.clear();
  }

  /** Send a test email through whatever this company currently uses. */
  async sendTest(companyId: string, to: string): Promise<void> {
    const notifier = new DynamicNotifier(this);
    await notifier.send({
      to,
      companyId,
      subject: 'HR System — test email / رسالة تجريبية',
      text: 'Your email settings work. إعدادات البريد تعمل بنجاح.',
    });
  }

  /**
   * Pooled transporter from a company's current settings (throws when smtp
   * is incomplete). Reused for every message until the settings cache turns
   * over — a per-message transport re-did the SMTP handshake every time.
   */
  async buildTransport(companyId: string | null) {
    const settings = await this.getMailSettings(companyId);
    const cacheKey = companyId ?? '';
    const cached = this.transportCache.get(cacheKey);
    // Same cached settings object → same pooled transporter.
    if (cached && cached.key === settings) return cached.value;
    cached?.value?.transporter.close();

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
    this.transportCache.set(cacheKey, { key: settings, value });
    return value;
  }
}

/**
 * Notifier that follows the saved settings at send time — changing the
 * provider on the settings page applies without a restart. Each message
 * leaves through the mail server of the company it belongs to.
 */
export class DynamicNotifier implements Notifier {
  constructor(private readonly settings: SettingsService) {}

  async send(message: OutboundMessage): Promise<void> {
    const transport = await this.settings.buildTransport(message.companyId ?? null);
    if (!transport) {
      logger.info(
        { to: message.to, subject: message.subject, companyId: message.companyId, attachments: message.attachments?.map((x) => x.filename) },
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
      ...(message.attachments?.length
        ? { attachments: message.attachments.map((a) => ({ filename: a.filename, path: storagePath(a.storageKey), ...(a.contentType ? { contentType: a.contentType } : {}) })) }
        : {}),
    });
  }
}
