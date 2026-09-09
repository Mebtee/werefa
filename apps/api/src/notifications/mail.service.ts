import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { Logger } from '../common/logger/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body (delivery pipeline only; still requires a plain-text fallback). */
  html?: string;
}

/**
 * Outbound platform mail.
 *
 * Providers:
 *  - `test` env → in-memory capture (assertable, no network).
 *  - `mailhog` / `smtp` → SMTP (MailHog on :1025 in local dev).
 *  - `ses` → NOT IMPLEMENTED (deliberate; fails loudly, never silent-drop).
 *
 * Delivery is best-effort and non-fatal to the request that triggered it
 * (domain transactions never depend on delivery success, doc 14).
 */
export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

class MemoryMailProvider implements MailProvider {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(structuredClone(message));
  }
}

@Injectable()
export class MailService {
  private readonly provider: MailProvider;
  private readonly memory: MemoryMailProvider | null;
  private transport: Transporter | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    if (config.appEnv === 'test') {
      this.memory = new MemoryMailProvider();
      this.provider = this.memory;
    } else {
      this.memory = null;
      this.provider = new SmtpProvider(config, logger);
    }
  }

  /** In-memory captures for tests (empty outside test env). */
  get captured(): MailMessage[] {
    return this.memory?.sent ?? [];
  }

  get sentCount(): number {
    return this.memory?.sent.length ?? 0;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.sendStrict(message);
    } catch (err) {
      // Never fail the triggering transaction because mail delivery failed.
      this.logger.error('Outbound mail failed; delivery is best-effort', { to: message.to }, err);
    }
  }

  /**
   * Strict send: LET failures propagate. Used by the delivery pipeline, which
   * records the outcome as its own durable effect (notification_delivery) with
   * retry/backoff — never inside a booking/payment transaction.
   */
  async sendStrict(message: MailMessage): Promise<void> {
    await this.provider.send(message);
  }
}

class SmtpProvider implements MailProvider {
  private transport: Transporter | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  private getTransport(): Transporter {
    if (this.transport) return this.transport;
    if (this.config.mailProvider === 'ses') {
      throw new Error('MAIL_PROVIDER=ses is not implemented; use mailhog/smtp.');
    }
    const host = process.env.SMTP_HOST ?? 'localhost';
    const port = Number.parseInt(process.env.SMTP_PORT ?? '1025', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    this.transport = nodemailer.createTransport({
      host,
      port,
      secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
      ignoreTLS: !user, // MailHog needs no TLS/auth
      auth: user && pass ? { user, pass } : undefined,
    });
    this.logger.info('SMTP transport initialised', {
      host,
      port,
      provider: this.config.mailProvider,
    });
    return this.transport;
  }

  async send(message: MailMessage): Promise<void> {
    await this.getTransport().sendMail({
      from: this.config.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
