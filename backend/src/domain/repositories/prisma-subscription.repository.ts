import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, Subscription, SubscriptionProof, SubscriptionReviewState } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import {
  SubscriptionProofWithBusiness,
  SubscriptionRepository,
} from './subscription.repository.port';

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  private static readonly ELIGIBLE_STATUSES: import('@prisma/client').SubscriptionStatus[] = [
    'TRIAL',
    'TRIAL_GRACE',
    'ACTIVE',
    'PAID_GRACE',
  ];

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async ensureTrialAtCreation(
    tx: Prisma.TransactionClient,
    args: { businessId: string; now: Date; trialDays?: number },
  ): Promise<Subscription> {
    const trialDays = args.trialDays ?? 30;
    const graceDays = 3;
    const trialEnd = new Date(args.now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const graceEnd = new Date(trialEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
    return tx.subscription.upsert({
      where: { businessId: args.businessId },
      create: {
        businessId: args.businessId,
        status: 'TRIAL',
        trialStartedAt: args.now,
        trialEndsAt: trialEnd,
        trialGraceEndsAt: graceEnd,
      },
      update: {},
    });
  }

  async getByBusiness(businessId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { businessId } });
  }

  async isBookingEligible(businessId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({
      where: { businessId },
      select: { status: true },
    });
    return sub !== null && PrismaSubscriptionRepository.ELIGIBLE_STATUSES.includes(sub.status);
  }

  async transitionStatus(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      from: import('@prisma/client').SubscriptionStatus;
      to: import('@prisma/client').SubscriptionStatus;
      actorType: import('@prisma/client').ActorType;
      actorUserId?: string | null;
      reason?: string | null;
    },
  ): Promise<boolean> {
    const updated = await tx.subscription.updateMany({
      where: { businessId: args.businessId, status: args.from },
      data: { status: args.to },
    });
    if (updated.count !== 1) return false;
    const sub = await tx.subscription.findUnique({ where: { businessId: args.businessId }, select: { id: true } });
    if (sub) {
      await this.appendHistory(tx, {
        subscriptionId: sub.id,
        businessId: args.businessId,
        fromStatus: args.from,
        toStatus: args.to,
        actorType: args.actorType,
        actorUserId: args.actorUserId ?? null,
        reason: args.reason ?? null,
      });
    }
    return true;
  }

  async appendHistory(
    tx: Prisma.TransactionClient,
    args: {
      subscriptionId: string;
      businessId: string;
      fromStatus: import('@prisma/client').SubscriptionStatus | null;
      toStatus: import('@prisma/client').SubscriptionStatus;
      actorType: import('@prisma/client').ActorType;
      actorUserId?: string | null;
      reason?: string | null;
    },
  ): Promise<void> {
    await tx.subscriptionStatusHistory.create({
      data: {
        subscriptionId: args.subscriptionId,
        businessId: args.businessId,
        fromStatus: args.fromStatus,
        toStatus: args.toStatus,
        actorType: args.actorType,
        actorUserId: args.actorUserId ?? null,
        reason: args.reason ?? null,
      },
    });
  }

  /** Atomic time-advance (REQ-133): guarded by the from-status so a stale
   *  concurrent advance can never double-write history. */
  async advanceToCanonicalStatus(
    businessId: string,
    desired: import('@prisma/client').SubscriptionStatus,
    reason: string,
  ): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({ where: { businessId } });
    if (!sub || sub.status === desired) return true;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.updateMany({
        where: { businessId, status: sub.status },
        data: { status: desired },
      });
      if (updated.count !== 1) return;
      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: sub.id,
          businessId,
          fromStatus: sub.status,
          toStatus: desired,
          actorType: 'SYSTEM',
          actorUserId: null,
          reason,
        },
      });
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Proof workflow
  // -------------------------------------------------------------------------

  async findProofBySubmissionKey(submissionKey: string): Promise<SubscriptionProof | null> {
    return this.prisma.subscriptionProof.findUnique({ where: { submissionKey } });
  }

  async createProof(
    tx: Prisma.TransactionClient,
    args: {
      subscriptionId: string;
      businessId: string;
      submissionKey: string;
      fileObjectId: string | null;
      requestedAt: Date;
    },
  ): Promise<SubscriptionProof> {
    return tx.subscriptionProof.create({
      data: {
        subscriptionId: args.subscriptionId,
        businessId: args.businessId,
        submissionKey: args.submissionKey,
        fileObjectId: args.fileObjectId,
        requestedAt: args.requestedAt,
        reviewState: 'PENDING',
      },
    });
  }

  async getProofById(proofId: string): Promise<SubscriptionProof | null> {
    return this.prisma.subscriptionProof.findUnique({ where: { id: proofId } });
  }

  async getProofWithBusiness(proofId: string): Promise<SubscriptionProofWithBusiness | null> {
    const row = await this.prisma.subscriptionProof.findUnique({
      where: { id: proofId },
      include: {
        business: {
          select: {
            name: true,
            owners: { select: { user: { select: { email: true } } }, take: 1 },
          },
        },
      },
    });
    if (!row) return null;
    return {
      proof: row,
      businessName: row.business.name,
      ownerEmail: row.business.owners[0]?.user.email ?? '',
    };
  }

  async listProofsByBusiness(businessId: string): Promise<SubscriptionProof[]> {
    return this.prisma.subscriptionProof.findMany({
      where: { businessId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async listProofsByReviewState(state: SubscriptionReviewState): Promise<SubscriptionProofWithBusiness[]> {
    const rows = await this.prisma.subscriptionProof.findMany({
      where: { reviewState: state },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
      include: {
        business: {
          select: {
            name: true,
            owners: { select: { user: { select: { email: true } } }, take: 1 },
          },
        },
      },
    });
    return rows.map((row) => ({
      proof: row,
      businessName: row.business.name,
      ownerEmail: row.business.owners[0]?.user.email ?? '',
    }));
  }

  async reviewProof(
    tx: Prisma.TransactionClient,
    args: {
      proofId: string;
      businessId: string;
      state: SubscriptionReviewState;
      reviewedBy: string;
      rejectionReason?: string | null;
      approvedUntil?: Date | null;
    },
  ): Promise<boolean> {
    const updated = await tx.subscriptionProof.updateMany({
      where: { id: args.proofId, businessId: args.businessId, reviewState: 'PENDING' },
      data: {
        reviewState: args.state,
        reviewedBy: args.reviewedBy,
        rejectionReason: args.state === 'REJECTED' ? (args.rejectionReason ?? null) : null,
        approvedUntil: args.state === 'APPROVED' ? (args.approvedUntil ?? null) : null,
      },
    });
    return updated.count === 1;
  }

  async setPaidBand(
    tx: Prisma.TransactionClient,
    args: { businessId: string; periodEndsAt: Date; paidGraceEndsAt: Date },
  ): Promise<void> {
    await tx.subscription.update({
      where: { businessId: args.businessId },
      data: { periodEndsAt: args.periodEndsAt, paidGraceEndsAt: args.paidGraceEndsAt },
    });
  }
}