import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ActorContext } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { domainErrors } from '../errors/domain-errors';
import { deriveCanonicalStatus, isEligible } from '../lib/subscription-lifecycle';
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
 * Prompt 52: the gate is now TIME-AWARE — the persisted status is advanced to
 * the timestamp-derived canonical status (REQ-128…133) before eligibility is
 * decided, so a business whose trial/paid grace has lapsed stops taking
 * bookings (REQ-133) without waiting for a background job. Only eligibility +
 * lifecycle live here; the manual payment/approval workflow is in
 * SubscriptionBillingService. No price (unchanged §46 item 1) and no reminder
 * timing (§46 item 3) are implemented.
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

  /**
   * Advance the persisted status to the time-derived canonical status and
   * return the effective subscription. Idempotent and guarded: when no band
   * boundary was crossed no write happens; a concurrent advance can never
   * double-write history.
   */
  async reconcileStatus(businessId: string): Promise<import('@prisma/client').Subscription | null> {
    const sub = await this.subscriptionRepo.getByBusiness(businessId);
    if (!sub) return null;
    const desired = deriveCanonicalStatus(sub, this.clock.now());
    if (desired !== sub.status) {
      await this.subscriptionRepo.advanceToCanonicalStatus(
        businessId,
        desired,
        desired === 'EXPIRED'
          ? 'Time-based advancement: subscription expired'
          : `Time-based advancement: canonical status ${desired}`,
      );
      return this.subscriptionRepo.getByBusiness(businessId);
    }
    return sub;
  }

  /** Gate: throws SUBSCRIPTION_EXPIRED when the business cannot take bookings. */
  async bookingGate(businessId: string): Promise<void> {
    const sub = await this.reconcileStatus(businessId);
    if (!sub || !isEligible(sub.status)) throw domainErrors.subscriptionDisabled();
  }

  /** Time-aware eligibility check used by read paths that must NOT write. */
  async isEligibleNow(businessId: string): Promise<boolean> {
    const sub = await this.subscriptionRepo.getByBusiness(businessId);
    if (!sub) return false;
    return isEligible(deriveCanonicalStatus(sub, this.clock.now()));
  }

  async manualResume(ctx: ActorContext, businessId: string): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const sub = await this.reconcileStatus(businessId);
    if (!sub || !isEligible(sub.status)) {
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

    const sub = await this.reconcileStatus(businessId);
    if (!sub) return { resumed: false, reason: 'No subscription.' };
    if (!isEligible(sub.status)) {
      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        await this.subscriptionRepo.appendHistory(tx, {
          subscriptionId: sub.id,
          businessId,
          fromStatus: sub.status,
          toStatus: sub.status,
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