import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { JobQueueService } from './job-queue.service';
import type { JobDefinition, JobPayload } from './job-queue.service';
import { SecurityEventService } from '../iam/security-events.service';

export interface SecurityEventRetentionPayload extends JobPayload {
  /** Events older than this many days are purged (defaults to 365). */
  olderThanDays?: number;
}

/**
 * Platform job: purge security events older than the 1-year retention window
 * (REQ-204, architecture doc 22 §5 — "weekly purge job + audited platform
 * purge"). Runs at platform scope (no businessId) on a weekly repeatable
 * schedule. Bounded batching keeps each sweep restart-safe and low-impact;
 * every run that removed rows records a SECURITY_EVENT_PURGE audit event so
 * retention itself is observable (doc 22 §5).
 */
export const SECURITY_EVENT_RETENTION = 'security-event-retention';
export const SECURITY_RETENTION_DAYS = 365;
export const SECURITY_RETENTION_BATCH = 1_000;
export const SECURITY_RETENTION_CRON = '0 2 * * 1'; // Monday 02:00, platform TZ.

@Injectable()
export class JobRegistrar implements OnModuleInit {
  private readonly logger = new Logger(JobRegistrar.name);

  constructor(
    private readonly jobs: JobQueueService,
    private readonly prisma: PrismaService,
    private readonly security: SecurityEventService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const definition: JobDefinition<SecurityEventRetentionPayload> = {
      name: SECURITY_EVENT_RETENTION,
      maxAttempts: 3,
      backoffMs: 15_000,
      repeatCron: SECURITY_RETENTION_CRON,
      handler: async (payload) => {
        await this.runRetention(payload.olderThanDays);
      },
    };
    this.jobs.register(definition);
  }

  /**
   * Idempotent, restart-safe purge: recomputes the cutoff from now each run
   * and deletes in bounded batches (oldest-first), so an interrupted sweep
   * simply resumes at the next run. Exposed for direct/unit invocation.
   *
   * @returns the number of rows purged this run.
   */
  async runRetention(olderThanDays = SECURITY_RETENTION_DAYS): Promise<number> {
    const days = olderThanDays > 0 ? olderThanDays : SECURITY_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let purged = 0;

    // Batch loop: pull the oldest ids below the cutoff a bounded batch at a
    // time. Deleting oldest-first keeps the window stable across batches, so
    // restarts/re-runs never skip or duplicate rows.
    for (;;) {
      const ids = await this.prisma.securityEvent.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: SECURITY_RETENTION_BATCH,
      });
      if (ids.length === 0) break;
      await this.prisma.securityEvent.deleteMany({
        where: { id: { in: ids.map((row) => row.id) } },
      });
      purged += ids.length;
      if (ids.length < SECURITY_RETENTION_BATCH) break;
    }

    if (purged > 0) {
      // Audited platform purge (doc 22 §5): a fresh audit event inside the
      // window records how many rows were removed, so the retained history
      // stays attributable.
      await this.security.record({
        type: 'SECURITY_EVENT_PURGE',
        result: 'SUCCESS',
        metadata: {
          purgedCount: purged,
          olderThanDays: days,
          cutoff: cutoff.toISOString(),
        },
      });
    }
    this.logger.log(`Security-event retention purged ${purged} rows`, {
      days,
      appEnv: this.config.appEnv,
    });
    return purged;
  }
}
