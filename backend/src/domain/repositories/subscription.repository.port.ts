import {
  ActorType,
  Prisma,
  Subscription,
  SubscriptionProof,
  SubscriptionReviewState,
  SubscriptionStatus,
} from '@prisma/client';

export interface SubscriptionProofWithBusiness {
  proof: SubscriptionProof;
  businessName: string;
  ownerEmail: string;
}

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

  /** Translate to the canonical time-derived status (idempotent, SYSTEM history). */
  advanceToCanonicalStatus(
    businessId: string,
    desired: SubscriptionStatus,
    reason: string,
  ): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Proof workflow (Prompt 52; REQ-136/137/138, REQ-140). Reuses the REQ-121
  // `submission_key` idempotency architecture: a replayed upload is exactly-once.
  // -------------------------------------------------------------------------
  findProofBySubmissionKey(submissionKey: string): Promise<SubscriptionProof | null>;
  createProof(
    tx: Prisma.TransactionClient,
    args: {
      subscriptionId: string;
      businessId: string;
      submissionKey: string;
      fileObjectId: string | null;
      requestedAt: Date;
    },
  ): Promise<SubscriptionProof>;
  getProofById(proofId: string): Promise<SubscriptionProof | null>;
  /** Proof with owning business name + owner email for admin review results. */
  getProofWithBusiness(proofId: string): Promise<SubscriptionProofWithBusiness | null>;
  listProofsByBusiness(businessId: string): Promise<SubscriptionProof[]>;
  listProofsByReviewState(state: SubscriptionReviewState): Promise<SubscriptionProofWithBusiness[]>;
  /** Guarded PENDING → target review state; false on stale/duplicate decision. */
  reviewProof(
    tx: Prisma.TransactionClient,
    args: {
      proofId: string;
      businessId: string;
      state: SubscriptionReviewState;
      reviewedBy: string;
      rejectionReason?: string | null;
      approvedUntil?: Date | null;
    },
  ): Promise<boolean>;
  /** Persist a paid band (activated/extended by an approval, REQ-130/131). */
  setPaidBand(
    tx: Prisma.TransactionClient,
    args: { businessId: string; periodEndsAt: Date; paidGraceEndsAt: Date },
  ): Promise<void>;
}