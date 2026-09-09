import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { JobQueueService } from './job-queue.service';
import type { JobDefinition, JobPayload } from './job-queue.service';

export interface SecurityEventRetentionPayload extends JobPayload {
  /** Events older than this many days are purged (defaults to 365). */
  olderThanDays?: number;
}

/**
 * Platform job: purge security events older than the retention window
 * (architecture doc 22 — 1-year retention). Runs at platform scope (no
 * businessId). Foundation example of real job + worker wiring. Batched paging
 * and Prometheus/Sentry counters are added with the observability job later.
 */
export const SECURITY_EVENT_RETENTION = 'security-event-retention';

@Injectable()
export class JobRegistrar implements OnModuleInit {
  private readonly logger = new Logger(JobRegistrar.name);

  constructor(
    private readonly jobs: JobQueueService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const definition: JobDefinition<SecurityEventRetentionPayload> = {
      name: SECURITY_EVENT_RETENTION,
      maxAttempts: 3,
      backoffMs: 15_000,
      handler: async (payload) => {
        const retentionDays = 365;
        const days = payload.olderThanDays ?? retentionDays;
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const { count } = await this.prisma.securityEvent.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        this.logger.log(`Security-event retention purged ${count} rows`, {
          days,
          appEnv: this.config.appEnv,
        });
      },
    };
    this.jobs.register(definition);
  }
}
