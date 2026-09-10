import { Module } from '@nestjs/common';
import { SuperAdminPrismaService } from '../booking/super-admin.prisma.service';
import { IamModule } from '../iam/iam.module';
import { JobsModule } from '../jobs/jobs.module';
import { SubscriptionLifecycleJob } from '../jobs/subscription-lifecycle.job';
import {
  SubscriptionAdminController,
  SubscriptionSuperAdminController,
} from './subscription-admin.controller';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionNotificationService } from './subscription-notifications';
import { SubscriptionService } from './subscription.service';

/**
 * Subscription & billing domain module (Prompt 14, Domains 17/18, doc 15).
 *
 * - Owner: overview / status history / payment request with proof upload /
 *   authorized proof read, all under the RLS-scoped `app` role (owner scope).
 * - Admin / Super Admin: cross-business review queue + approve / reject plus a
 *   full audit detail on the elevated `app_superadmin` connection.
 * - Notification outbox rows are written transactionally with the mutations and
 *   are delivered later by the NotificationDispatcher (exactly two Admin
 *   recipients for submissions; business contact for owner-facing events).
 * - Lifecycle: the status-refresh + reminder sweeps register into the job queue.
 */
@Module({
  imports: [IamModule, JobsModule],
  controllers: [
    SubscriptionController,
    SubscriptionAdminController,
    SubscriptionSuperAdminController,
  ],
  providers: [
    SubscriptionService,
    SubscriptionNotificationService,
    SuperAdminPrismaService,
    SubscriptionLifecycleJob,
  ],
  exports: [SubscriptionService, SubscriptionNotificationService],
})
export class SubscriptionModule {}
