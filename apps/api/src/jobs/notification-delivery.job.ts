import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobQueueService, type JobDefinition, type JobPayload } from './job-queue.service';
import { NotificationDispatcher } from '../notifications/notification-dispatcher';

export const NOTIFICATION_DELIVERY = 'notification-delivery';
const EVERY_MINUTE = '* * * * *';

/**
 * Delivery sweep (doc 17 §notification-retry, Prompt 13): every minute
 *  1. `fanOutDue()` — turn unprocessed outbox rows into delivery intents,
 *  2. `processDue()` — send due intents with bounded exponential retry.
 *
 * Pull-based (no Redis scheduling beyond the cron trigger), idempotent, and
 * safe to run concurrently with itself (unique idempotency keys + claim race).
 * In the `test` environment the worker does not start; integration/unit tests
 * invoke the dispatcher directly.
 */
@Injectable()
export class NotificationDeliveryJob implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryJob.name);

  constructor(
    private readonly jobs: JobQueueService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  onModuleInit(): void {
    const delivery: JobDefinition<JobPayload> = {
      name: NOTIFICATION_DELIVERY,
      maxAttempts: 3,
      backoffMs: 30_000,
      repeatCron: EVERY_MINUTE,
      handler: async () => {
        const fanned = await this.dispatcher.fanOutDue();
        const stats = await this.dispatcher.processDue();
        if (fanned > 0 || stats.sent > 0 || stats.deadLettered > 0) {
          this.logger.log(
            `Delivery sweep: fanout=${fanned} sent=${stats.sent} failed=${stats.failed} ` +
              `suppressed=${stats.suppressed} dead=${stats.deadLettered}`,
          );
        }
      },
    };
    this.jobs.register(delivery);
  }
}
