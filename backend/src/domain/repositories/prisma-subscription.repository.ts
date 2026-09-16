import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, Subscription } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { SubscriptionRepository } from './subscription.repository.port';

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
}