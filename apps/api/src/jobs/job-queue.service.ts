import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/environment';

export interface JobPayload {
  businessId?: string;
  actorId?: string;
}

export interface JobDefinition<T extends JobPayload = JobPayload> {
  name: string;
  maxAttempts: number;
  backoffMs: number;
  handler: (payload: T) => Promise<void>;
  /**
   * Optional cron expression. When set, the job is registered as a repeatable
   * BullMQ job at worker startup (e.g. the every-minute scheduled-resume sweep).
   */
  repeatCron?: string;
}

/**
 * BullMQ foundation — job queue + worker wiring (doc 17).
 *
 * Foundation scope:
 *  - one named queue + typed job registry
 *  - graceful worker (startup / shutdown), per-job transaction & tenant
 *    context in the handler (payload carries businessId; re-resolved per job)
 *  - no product jobs yet (added in their modules in later prompts)
 */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly connection: IORedis;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly jobs = new Map<string, JobDefinition>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  }

  /** Register a job definition (idempotent by name). */
  register(def: JobDefinition): void {
    if (this.jobs.has(def.name)) {
      throw new Error(`Duplicate job registration: ${def.name}`);
    }
    this.jobs.set(def.name, def);
  }

  async enqueue<T extends JobPayload>(
    name: string,
    payload: T,
    opts?: { delayMs?: number; jobId?: string },
  ): Promise<string | undefined> {
    if (!this.queue) throw new Error('JobQueueService not initialized');
    const def = this.jobs.get(name);
    if (!def) throw new Error(`Unknown job: ${name}`);
    return this.queue
      .add(name, payload, {
        jobId: opts?.jobId ?? this.buildJobId(name, payload),
        attempts: def.maxAttempts,
        backoff: { type: 'exponential', delay: def.backoffMs },
        removeOnComplete: 100,
        removeOnFail: 500,
        delay: opts?.delayMs,
      })
      .then((r) => r.id);
  }

  async onModuleInit(): Promise<void> {
    if (this.config.appEnv === 'test') return; // tests inject their own queue wiring
    this.queue = new Queue(this.config.jobQueueName, { connection: this.connection });
    this.worker = new Worker(
      this.config.jobQueueName,
      async (job) => {
        const def = this.jobs.get(job.name);
        if (!def) {
          this.logger.warn(`No handler for job ${job.name}; dropped`);
          return;
        }
        try {
          await def.handler(job.data as JobPayload);
        } catch (err) {
          this.logger.error(
            `Job ${job.name} failed (attempt ${job.attemptsMade + 1})`,
            err as Error,
          );
          throw err; // BullMQ retries with backoff; dead-letters after max
        }
      },
      { connection: this.connection, concurrency: 3 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.name ?? '<unknown>'} permanently failed`, err);
    });

    // Register periodic (repeat-cron) jobs after the worker is up.
    for (const def of this.jobs.values()) {
      if (!def.repeatCron) continue;
      await this.queue.add(def.name, {} as JobPayload, {
        jobId: `${def.name}:${def.repeatCron}`,
        repeat: { pattern: def.repeatCron },
        attempts: def.maxAttempts,
        backoff: { type: 'exponential', delay: def.backoffMs },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
      this.logger.log(`Repeatable job scheduled: ${def.name} (${def.repeatCron})`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection.quit();
  }

  private buildJobId(name: string, payload: JobPayload): string | undefined {
    // Platform jobs run per-business? For foundation idempotency is by key.
    const businessKey = payload.businessId ? `:${payload.businessId}` : '';
    return `${name}${businessKey}`;
  }
}
