import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext } from '../database/tenant-executor';
import { SYSTEM_ACTOR_ID } from '../business/business.service';
import { JobQueueService, type JobDefinition, type JobPayload } from './job-queue.service';
import {
  SubscriptionNotificationService,
  SUBSCRIPTION_NOTIFICATION_TYPE,
} from '../subscription/subscription-notifications';
import {
  derivedStatus,
  reminderDecision,
  type SubscriptionRow,
} from '../subscription/subscription-lifecycle';

export const SUBSCRIPTION_STATUS_REFRESH = 'subscription-status-refresh';
export const SUBSCRIPTION_REMINDERS = 'subscription-reminders';
const EVERY_MINUTE = '* * * * *';

/** Once-per-band reminder (grace bands are ≤5 days; lead is 3 days). */
const REMINDER_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const REMINDER_TYPE_OF_KIND: Record<string, string> = {
  PAID_END: SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidEnd,
  TRIAL_END: SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialEnd,
  PAID_GRACE: SUBSCRIPTION_NOTIFICATION_TYPE.reminderPaidGrace,
  TRIAL_GRACE: SUBSCRIPTION_NOTIFICATION_TYPE.reminderTrialGrace,
};

/**
 * Background subscription lifecycle (Prompt 14, doc 15 §3) — the only writer of
 * the persisted `status` column (for reporting/history; the booking gates read
 * derived state at query time) and the reminder queue:
 *
 *  - Status refresh: whenever the DERIVED status differs from the persisted
 *    one, the row is updated and a `subscription_status_history` transition is
 *    appended (SYSTEM actor). Idempotent + monotonic — no advisory lock needed.
 *  - Reminders: queues at most one reminder per band via the notification
 *    outbox (dedup window covers the whole grace length), matching
 *    `reminderDecision`. Delivery re-validates staleness anyway.
 *
 * In the `test` environment the worker does not start; integration tests call
 * the sweep methods directly.
 */
@Injectable()
export class SubscriptionLifecycleJob implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionLifecycleJob.name);

  constructor(
    private readonly jobs: JobQueueService,
    private readonly prisma: PrismaService,
    private readonly notifications: SubscriptionNotificationService,
  ) {}

  onModuleInit(): void {
    const refresh: JobDefinition<JobPayload> = {
      name: SUBSCRIPTION_STATUS_REFRESH,
      maxAttempts: 3,
      backoffMs: 30_000,
      repeatCron: EVERY_MINUTE,
      handler: async () => {
        const transitions = await this.refreshStatuses();
        if (transitions > 0)
          this.logger.log(`Status refresh: ${transitions} subscription transition(s) recorded`);
      },
    };
    const reminders: JobDefinition<JobPayload> = {
      name: SUBSCRIPTION_REMINDERS,
      maxAttempts: 3,
      backoffMs: 30_000,
      repeatCron: EVERY_MINUTE,
      handler: async () => {
        const queued = await this.queueDueReminders();
        if (queued > 0)
          this.logger.log(`Reminder sweep: ${queued} subscription reminder(s) queued`);
      },
    };
    this.jobs.register(refresh);
    this.jobs.register(reminders);
  }

  /** Exposed for tests: persist derived status changes + append history rows. */
  async refreshStatuses(): Promise<number> {
    const now = new Date();
    const rows = await this.findSubscriptions();
    let transitions = 0;
    for (const row of rows) {
      const derived = derivedStatus(toDates(row), now);
      if (derived === row.status) continue;
      await withTenantContext(
        this.prisma,
        { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
        async (tx) => {
          await tx.subscription.update({
            where: { id: row.id },
            data: { status: derived, updatedAt: now },
          });
          await tx.subscriptionStatusHistory.create({
            data: {
              subscriptionId: row.id,
              businessId: row.businessId,
              fromStatus: row.status,
              toStatus: derived,
              actorType: 'SYSTEM',
              actorUserId: SYSTEM_ACTOR_ID,
              reason: transitionReason(row.status, derived),
              occurredAt: now,
            },
          });
        },
      );
      transitions += 1;
    }
    return transitions;
  }

  /** Exposed for tests: queue due renewal reminders, deduplicating per band. */
  async queueDueReminders(): Promise<number> {
    const now = new Date();
    const dedupBefore = new Date(now.getTime() - REMINDER_DEDUP_WINDOW_MS);
    const rows = await this.findSubscriptions();
    let queued = 0;
    for (const row of rows) {
      const decision = reminderDecision(toDates(row), now);
      if (!decision) continue;
      const type = REMINDER_TYPE_OF_KIND[decision.kind];
      if (!type) continue;
      const already = await withTenantContext(
        this.prisma,
        { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
        (tx) =>
          tx.notification.findFirst({
            where: {
              businessId: row.businessId,
              tenantScope: 'SUBSCRIPTION',
              type,
              createdAt: { gte: dedupBefore },
            },
            select: { id: true },
          }),
      );
      if (already) continue;
      await withTenantContext(
        this.prisma,
        { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
        async (tx) => {
          await this.notifications.enqueue(tx, {
            businessId: row.businessId,
            type,
            payload: { boundaryAt: decision.boundaryAt.toISOString() },
          });
        },
      );
      queued += 1;
    }
    return queued;
  }

  private findSubscriptions(): Promise<SubscriptionRow[]> {
    return withTenantContext(this.prisma, { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' }, (tx) =>
      tx.subscription.findMany({
        select: {
          id: true,
          businessId: true,
          status: true,
          trialStartedAt: true,
          trialEndsAt: true,
          paidPeriodStartAt: true,
          paidEndsAt: true,
          paidGraceEndsAt: true,
        },
        take: 500,
      }),
    );
  }
}

function toDates(row: SubscriptionRow) {
  return {
    trialStartedAt: row.trialStartedAt,
    trialEndsAt: row.trialEndsAt,
    paidPeriodStartAt: row.paidPeriodStartAt,
    paidEndsAt: row.paidEndsAt,
    paidGraceEndsAt: row.paidGraceEndsAt,
  };
}

function transitionReason(from: string, to: string): string {
  switch (`${from}>${to}`) {
    case 'TRIAL>TRIAL_GRACE':
      return 'Trial period ended; grace period started';
    case 'TRIAL_GRACE>EXPIRED':
      return 'Trial grace period expired';
    case 'ACTIVE>PAID_GRACE':
      return 'Paid period ended; grace period started';
    case 'PAID_GRACE>EXPIRED':
      return 'Paid grace period expired';
    case 'NONE>TRIAL':
      return 'Trial started';
    default:
      return 'Subscription status refreshed';
  }
}
