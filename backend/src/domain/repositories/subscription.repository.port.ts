import { ActorType, Prisma, Subscription, SubscriptionStatus } from '@prisma/client';

export interface SubscriptionRepository {
  ensureTrialAtCreation(
    tx: Prisma.TransactionClient,
    args: { businessId: string; now: Date; trialDays?: number },
  ): Promise<Subscription>;
  getByBusiness(businessId: string): Promise<Subscription | null>;
  /** Eligible: status in (TRIAL, TRIAL_GRACE, ACTIVE, PAID_GRACE). */
  isBookingEligible(businessId: string): Promise<boolean>;
  /** Guarded status transition; false if the row is not in `from`. */
  transitionStatus(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      from: SubscriptionStatus;
      to: SubscriptionStatus;
      actorType: ActorType;
      actorUserId?: string | null;
      reason?: string | null;
    },
  ): Promise<boolean>;
  appendHistory(
    tx: Prisma.TransactionClient,
    args: {
      subscriptionId: string;
      businessId: string;
      fromStatus: SubscriptionStatus | null;
      toStatus: SubscriptionStatus;
      actorType: ActorType;
      actorUserId?: string | null;
      reason?: string | null;
    },
  ): Promise<void>;
}