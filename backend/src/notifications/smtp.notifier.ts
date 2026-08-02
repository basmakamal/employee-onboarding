import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../common/config.js';
import type { Notifier, OutboundMessage } from './notifier.js';

/**
 * Production email via the company Microsoft (Office 365 / Exchange) SMTP
 * server. Activated with NOTIFIER=smtp + SMTP_* env vars.
 */
export class SmtpNotifier implements Notifier {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: Config) {
    this.from = config.MAIL_FROM ?? config.SMTP_USER ?? 'no-reply@localhost';
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT ?? 587,
      secure: false, // Office365 uses STARTTLS on 587
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
