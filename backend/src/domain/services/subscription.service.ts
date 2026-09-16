import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ActorContext } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { domainErrors } from '../errors/domain-errors';
import { SubscriptionRepository } from '../repositories/subscription.repository.port';
import { ScheduleRepository } from '../repositories/schedule.repository.port';
import {
  SCHEDULE_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from '../repositories/tokens';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';

/**
 * Subscription eligibility gate + pause/resume lifecycle (Prompt 41 §22;
 * doc 15; REQ-125 … REQ-158).
 *
 * Only eligibility checks are implemented — no price (unchanged §46 item 1), no
 * reminder timing (§46 item 3), no billing/approval workflow. Resume promotes
 * the latest PENDING schedule version (R151) like any other resume path.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptionRepo: SubscriptionRepository,
    @Inject(SCHEDULE_REPOSITORY) private readonly scheduleRepo: ScheduleRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    private readonly tenantGuard: TenantGuard,
  ) {}

  /** Gate: throws SUBSCRIPTION_EXPIRED when the business cannot take bookings. */
  async bookingGate(businessId: string): Promise<void> {
    const eligible = await this.subscriptionRepo.isBookingEligible(businessId);
    if (!eligible) throw domainErrors.subscriptionDisabled();
  }

  async manualResume(ctx: ActorContext, businessId: string): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const sub = await this.subscriptionRepo.getByBusiness(businessId);
    if (!sub || sub.status === 'EXPIRED') {
      throw domainErrors.subscriptionDisabled('Cannot resume: the subscription is expired.');
    }
    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      await tx.businessSettings.update({ where: { businessId }, data: { isPaused: false, reopenAt: null } });
      await this.promoteLatestPending(tx, businessId, ctx.actorUserId ?? 'system', 'Resumed by owner');
    });
  }

  /** Scheduled auto-resume (R153/R154/R231). Idempotent. */
  async attemptAutoResume(businessId: string): Promise<{ resumed: boolean; reason?: string }> {
    const settings = await this.prisma.businessSettings.findUnique({ where: { businessId } });
    if (!settings?.isPaused || !settings.reopenAt) return { resumed: false, reason: 'Not in scheduled pause.' };
    if (this.clock.now() < settings.reopenAt) return { resumed: false, reason: 'Not yet time.' };

    const sub = await this.subscriptionRepo.getByBusiness(businessId);
    if (!sub) return { resumed: false, reason: 'No subscription.' };
    if (sub.status === 'EXPIRED') {
      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        await this.subscriptionRepo.appendHistory(tx, {
          subscriptionId: sub.id,
          businessId,
          fromStatus: 'EXPIRED',
          toStatus: 'EXPIRED',
          actorType: 'SYSTEM',
          reason: 'Auto-resume refused: subscription expired',
        });
      });
      return { resumed: false, reason: 'Subscription expired.' };
    }

    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      await tx.businessSettings.update({ where: { businessId }, data: { isPaused: false, reopenAt: null } });
      await this.promoteLatestPending(tx, businessId, 'system', 'Auto-resume');
    });
    return { resumed: true };
  }

  async getByBusiness(businessId: string) {
    return this.subscriptionRepo.getByBusiness(businessId);
  }

  private async promoteLatestPending(
    tx: import('@prisma/client').Prisma.TransactionClient,
    businessId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const pending = await this.scheduleRepo.listPendingVersions(businessId);
    if (pending.length === 0) return;
    const latest = pending[pending.length - 1];
    await this.scheduleRepo.demoteActiveVersions(tx, { businessId, replacedAt: new Date() });
    await this.scheduleRepo.promotePendingVersion(tx, { versionId: latest.id, businessId, appliedBy: actorId, reason });
    await this.scheduleRepo.setBusinessActiveVersion(tx, { businessId, versionId: latest.id });
  }
}