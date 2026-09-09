import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { MailService } from '../notifications/mail.service';
import { renderPlatformEmail, type PlatformEmailTemplate } from '../notifications/platform-emails';
import { JobQueueService } from './job-queue.service';

export const PLATFORM_EMAIL_JOB = 'platform-email';

export interface EmailJobPayload {
  to: string;
  template: PlatformEmailTemplate;
  params: Record<string, string>;
}

/** Registers the platform-email job (worker path for identity notifications). */
@Injectable()
export class MailJobRegistrar implements OnModuleInit {
  constructor(
    private readonly jobs: JobQueueService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      name: PLATFORM_EMAIL_JOB,
      maxAttempts: 3,
      backoffMs: 30_000,
      handler: async (payload) => {
        const p = payload as unknown as EmailJobPayload;
        const rendered = renderPlatformEmail(this.config, p.template, p.params);
        await this.mail.send({
          to: p.to,
          subject: rendered.subject,
          text: rendered.text,
        });
      },
    });
  }
}

/**
 * Sends a platform email, using the async mail job in dev/prod and the
 * in-memory provider (deterministic capture) in tests.
 */
@Injectable()
export class PlatformEmailer {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jobs: JobQueueService,
    private readonly mail: MailService,
  ) {}

  async sendTo(
    template: PlatformEmailTemplate,
    to: string,
    params: Record<string, string>,
  ): Promise<void> {
    if (this.config.appEnv === 'test') {
      await this.mail.send({
        to,
        ...renderPlatformEmail(this.config, template, params),
      });
      return;
    }
    // Unique job id per email so parallel mails are never deduplicated away.
    const jobId = `${PLATFORM_EMAIL_JOB}:${randomBytes(8).toString('hex')}`;
    await this.jobs.enqueue(PLATFORM_EMAIL_JOB, { to, template, params } as unknown as never, {
      jobId,
    });
  }
}
