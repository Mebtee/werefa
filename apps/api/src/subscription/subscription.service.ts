import { Injectable } from '@nestjs/common';
import type { Prisma, Subscription, SubscriptionPayment } from '@prisma/client';
import { SUBSCRIPTION_PRICE_MINOR } from '@werefa/shared';
import { validateProofFile } from '../booking/booking-proof';
import { isUniqueViolation } from '../booking/booking-lock';
import { SuperAdminPrismaService } from '../booking/super-admin.prisma.service';
import {
  AppException,
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import { withOwnerBusinessContext, type TenantTransaction } from '../database/tenant-executor';
import { SecurityEventService } from '../iam/security-events.service';
import { bodyObject, readString } from '../iam/validation';
import { StorageService } from '../storage/storage.service';
import {
  TRIAL_DAYS,
  addDays,
  derivedStatus,
  extendPaidPeriod,
  minuteTrunc,
  paidGraceEndsAtOf,
  type SubscriptionDates,
} from './subscription-lifecycle';
import {
  SUBSCRIPTION_NOTIFICATION_TYPE,
  SubscriptionNotificationService,
} from './subscription-notifications';

export interface SubscriptionProofFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface ReviewActor {
  userId: string;
  role: 'Admin' | 'SuperAdmin';
}

/**
 * Subscription & billing service (Prompt 14, REQ-125..141, doc 15).
 *
 * Owner flows run under the RLS-scoped `app` role (owner scope); Admin / Super
 * Admin review flows run on the elevated `app_superadmin` connection (like
 * BookingAdminService) so they may read cross-tenant without touching the
 * tenant context, with every read/mutation audited through security events.
 *
 * Concurrency (doc 15 §6): a payment is a single-use ticket. Review claims it
 * atomically (PENDING → APPROVED | REJECTED via updateMany); a claimant that
 * loses the race gets a Conflict. Submission is idempotent on `submissionKey`.
 * An Admin/Super Admin can never review a payment of a business they own.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elevated: SuperAdminPrismaService,
    private readonly storage: StorageService,
    private readonly security: SecurityEventService,
    private readonly notifications: SubscriptionNotificationService,
  ) {}

  // -------------------------------------------------------------------------
  // Owner flows (/businesses/:businessId/subscription)
  // -------------------------------------------------------------------------

  /** Subscription overview: current derived status + recent payment requests. */
  async overview(actor: { userId: string }, businessId: string) {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, async (tx) => {
      const subscription = await this.ensureSubscription(tx, businessId);
      const payments = await tx.subscriptionPayment.findMany({
        where: { businessId },
        orderBy: { submittedAt: 'desc' },
        take: 10,
      });
      return {
        subscription: this.subscriptionView(subscription),
        payments: payments.map(paymentView),
      };
    });
  }

  /**
   * Submit a manual bank-transfer payment request with a proof upload
   * (REQ-136). Replays (`submissionKey`) return the existing request.
   */
  async submitPayment(
    actor: { userId: string },
    businessId: string,
    file: SubscriptionProofFile | undefined,
    bodyRaw: unknown,
  ): Promise<{ payment: ReturnType<typeof paymentView>; created: boolean }> {
    const proof = validateProofFile(
      file ? { buffer: file.buffer, mimetype: file.mimetype, size: file.size } : undefined,
    );
    const payload = bodyObject(bodyRaw);
    const submissionKey = readString(payload, 'submissionKey', { required: true, max: 120 });
    if (!submissionKey)
      throw new ValidationException([{ field: 'submissionKey', message: 'Required.' }]);
    const note = readString(payload, 'note', { max: 1000 }) ?? null;

    const staged = await this.storage.put(
      businessId,
      'SUBSCRIPTION_PROOF',
      proof.buffer,
      proof.mimetype,
    );
    try {
      const result = await withOwnerBusinessContext(
        this.prisma,
        actor.userId,
        businessId,
        async (tx) => {
          const subscription = await this.ensureSubscription(tx, businessId);
          const existing = await tx.subscriptionPayment.findUnique({
            where: { submissionKey },
          });
          if (existing) return { created: false as const, payment: existing, subscription };

          const now = new Date();
          const businessInfo = await tx.business.findUnique({
            where: { id: businessId },
            select: { name: true },
          });
          const payment = await tx.subscriptionPayment.create({
            data: {
              businessId,
              subscriptionId: subscription.id,
              status: 'PENDING',
              amountMinor: SUBSCRIPTION_PRICE_MINOR,
              storageKey: staged.key,
              mime: proof.mimetype,
              sizeBytes: proof.size,
              submissionKey,
              note,
              submittedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          });
          // REQ-140: fan-out email to the (exactly) two Admin accounts. The
          // fan-out occurs in the delivery pipeline; here we only persist the
          // durable domain event in the same transaction as the payment.
          await this.notifications.enqueue(tx, {
            businessId,
            type: SUBSCRIPTION_NOTIFICATION_TYPE.paymentSubmittedAdmin,
            payload: {
              paymentId: payment.id,
              businessId,
              businessName: businessInfo?.name ?? 'Business',
              amountMinor: SUBSCRIPTION_PRICE_MINOR.toString(),
              submittedAt: now.toISOString(),
            },
          });
          return { created: true as const, payment, subscription };
        },
      );

      if (result.created) {
        // Audit the actual submission once; idempotent replays are not
        // re-recorded (they are not a new payment request).
        await this.security.record({
          type: 'SUBSCRIPTION_PAYMENT_SUBMITTED',
          userId: actor.userId,
          businessId,
          result: 'SUCCESS',
        });
      }
      return { payment: paymentView(result.payment), created: result.created };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const replayed = await this.replayByIdempotencyKey(actor.userId, businessId, submissionKey);
        if (replayed) return { payment: paymentView(replayed), created: false };
      }
      await this.storage.delete(staged.key).catch(() => undefined);
      throw err;
    }
  }

  /** Authorize an owner's access to their own proof object and hand back a short-lived presigned read. */
  async getProof(
    actor: { userId: string },
    businessId: string,
    paymentId: string,
  ): Promise<{ url: string; mime: string; sizeBytes: number; submittedAt: Date }> {
    const payment = await withOwnerBusinessContext(this.prisma, actor.userId, businessId, (tx) =>
      tx.subscriptionPayment.findUnique({ where: { id: paymentId, businessId } }),
    );
    this.requirePayment(payment);
    const url = await this.storage.presignRead(payment.storageKey, 300);
    if (!url) throw new NotFoundException('Proof object is no longer available.');
    return {
      url,
      mime: payment.mime,
      sizeBytes: payment.sizeBytes,
      submittedAt: payment.submittedAt,
    };
  }

  /** Append-only status-transition history for the owner dashboard (REQ-141). */
  async history(actor: { userId: string }, businessId: string) {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, async (tx) => {
      const subscription = await this.ensureSubscription(tx, businessId);
      const rows = await tx.subscriptionStatusHistory.findMany({
        where: { businessId },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });
      return {
        status: derivedStatus(datesOf(subscription)),
        history: rows.map((row) => ({
          id: row.id,
          fromStatus: row.fromStatus,
          toStatus: row.toStatus,
          actorType: row.actorType,
          reason: row.reason,
          occurredAt: row.occurredAt,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Admin / Super Admin review flows (/admin/subscriptions, /super-admin/...)
  // -------------------------------------------------------------------------

  /** Review queue: payments with business + owner email context. */
  async adminList(
    actor: ReviewActor,
    opts: { status?: SubscriptionPayment['status']; skip?: number; take?: number } = {},
  ): Promise<AdminPaymentRow[]> {
    const where: Prisma.SubscriptionPaymentWhereInput = {};
    if (opts.status) where.status = opts.status;
    const payments = await this.elevated.subscriptionPayment.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: Math.min(opts.take ?? 50, 200),
      skip: opts.skip ?? 0,
      include: { business: { select: { id: true, name: true, publicSlug: true } } },
    });
    const ownerEmails = await this.ownerEmailsFor(payments.map((p) => p.businessId));
    return payments.map((payment) =>
      adminRow(payment, ownerEmails.get(payment.businessId) ?? null),
    );
  }

  /** Full review detail for a single payment + proof presign URL. */
  async adminDetail(actor: ReviewActor, paymentId: string) {
    const payment = await this.elevated.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: {
        business: { select: { id: true, name: true, publicSlug: true, contactEmail: true } },
      },
    });
    this.requirePayment(payment);
    const ownerEmails = await this.ownerEmailsFor([payment.businessId]);
    const proofUrl = await this.storage.presignRead(payment.storageKey, 300);
    return adminRow(payment, ownerEmails.get(payment.businessId) ?? null, proofUrl);
  }

  /** Approve a pending payment: extend the paid period +30d (REQ-130/137). */
  async approve(actor: ReviewActor, paymentId: string) {
    const now = new Date();
    return this.elevated.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({
        where: { id: paymentId },
        include: { business: { select: { id: true, name: true, publicSlug: true } } },
      });
      this.requirePayment(payment);
      await this.assertNotBusinessOwner(tx, payment.businessId, actor.userId);

      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedByUserId: actor.userId, reviewedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('This payment was already reviewed.');
      }

      const subscription = await tx.subscription.findUnique({
        where: { businessId: payment.businessId },
      });
      if (!subscription) throw new ConflictException('Business subscription is missing.');
      const extension = extendPaidPeriod(datesOf(subscription), now);
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          paidPeriodStartAt: extension.paidPeriodStartAt,
          paidEndsAt: extension.paidEndsAt,
          paidGraceEndsAt: paidGraceEndsAtOf(extension.paidEndsAt),
          updatedAt: now,
        },
      });
      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: subscription.id,
          businessId: payment.businessId,
          fromStatus: derivedStatus(datesOf(subscription), now),
          toStatus: 'ACTIVE',
          actorType: actor.role === 'SuperAdmin' ? 'SUPER_ADMIN' : 'ADMIN',
          actorUserId: actor.userId,
          reason: 'Subscription payment approved',
          occurredAt: now,
        },
      });
      await this.notifications.enqueue(tx as TenantTransaction, {
        businessId: payment.businessId,
        type: SUBSCRIPTION_NOTIFICATION_TYPE.paymentApprovedOwner,
        payload: {
          paymentId,
          businessId: payment.businessId,
          amountMinor: payment.amountMinor.toString(),
          approvedAt: now.toISOString(),
          paidEndsAt: extension.paidEndsAt.toISOString(),
        },
      });
      await this.security.record({
        type: 'SUBSCRIPTION_PAYMENT_APPROVED',
        userId: actor.userId,
        businessId: payment.businessId,
        result: 'SUCCESS',
      });
      payment.status = 'APPROVED';
      payment.reviewedByUserId = actor.userId;
      payment.reviewedAt = now;
      return {
        payment: adminRow(payment, null),
        subscription: this.subscriptionView(updated),
      };
    });
  }

  /** Reject a pending payment; the reason is delivered to the owner (REQ-138). */
  async reject(actor: ReviewActor, paymentId: string, reason: string) {
    if (!reason) throw new ValidationException([{ field: 'reason', message: 'Required.' }]);
    const now = new Date();
    return this.elevated.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({
        where: { id: paymentId },
        include: { business: { select: { id: true, name: true, publicSlug: true } } },
      });
      this.requirePayment(payment);
      await this.assertNotBusinessOwner(tx, payment.businessId, actor.userId);

      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewedByUserId: actor.userId,
          reviewedAt: now,
          rejectionReason: reason,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('This payment was already reviewed.');
      }
      await this.notifications.enqueue(tx as TenantTransaction, {
        businessId: payment.businessId,
        type: SUBSCRIPTION_NOTIFICATION_TYPE.paymentRejectedOwner,
        payload: {
          paymentId,
          businessId: payment.businessId,
          amountMinor: payment.amountMinor.toString(),
          rejectionReason: reason,
          rejectedAt: now.toISOString(),
        },
      });
      await this.security.record({
        type: 'SUBSCRIPTION_PAYMENT_REJECTED',
        userId: actor.userId,
        businessId: payment.businessId,
        result: 'SUCCESS',
      });
      payment.status = 'REJECTED';
      payment.reviewedByUserId = actor.userId;
      payment.reviewedAt = now;
      payment.rejectionReason = reason;
      return { payment: adminRow(payment, null), rejectedAt: now };
    });
  }

  /** Super Admin audit detail: payment + subscription + full status history. */
  async superAdminDetail(actor: ReviewActor, paymentId: string) {
    const detail = await this.adminDetail(actor, paymentId);
    const history = await this.elevated.subscriptionStatusHistory.findMany({
      where: { businessId: detail.businessId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
    const subscription = await this.elevated.subscription.findUnique({
      where: { businessId: detail.businessId },
    });
    return {
      payment: detail,
      subscription: subscription ? this.subscriptionView(subscription) : null,
      history: history.map((row) => ({
        id: row.id,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        reason: row.reason,
        occurredAt: row.occurredAt,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Backfill-safe: every business must have exactly one subscription row. When
   * one is missing (tenants created before the Prompt 14 migration) it is
   * materialized from the legacy `business.trialEndsAt` boundary so history and
   * payments attach to a real row without changing the derived state.
   */
  private async ensureSubscription(
    tx: TenantTransaction,
    businessId: string,
  ): Promise<Subscription> {
    const existing = await tx.subscription.findUnique({ where: { businessId } });
    if (existing) return existing;
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: { trialEndsAt: true },
    });
    const now = minuteTrunc(new Date());
    const trialEndsAt = minuteTrunc(business?.trialEndsAt ?? addDays(now, TRIAL_DAYS));
    const trialStartedAt = minuteTrunc(
      business?.trialEndsAt !== null && business?.trialEndsAt !== undefined
        ? new Date(business.trialEndsAt.getTime() - TRIAL_DAYS * 86_400_000)
        : now,
    );
    return tx.subscription.create({
      data: {
        businessId,
        status: derivedStatus({
          trialStartedAt,
          trialEndsAt,
          paidPeriodStartAt: null,
          paidEndsAt: null,
          paidGraceEndsAt: null,
        }),
        trialStartedAt,
        trialEndsAt,
        priceMinor: SUBSCRIPTION_PRICE_MINOR,
      },
    });
  }

  private async replayByIdempotencyKey(
    userId: string,
    businessId: string,
    submissionKey: string,
  ): Promise<SubscriptionPayment | null> {
    return withOwnerBusinessContext(this.prisma, userId, businessId, async (tx) => {
      const existing = await tx.subscriptionPayment.findUnique({ where: { submissionKey } });
      return existing?.businessId === businessId ? existing : null;
    });
  }

  private async ownerEmailsFor(businessIds: string[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(businessIds)];
    if (ids.length === 0) return new Map();
    const owners = await this.elevated.businessOwner.findMany({
      where: { businessId: { in: ids } },
    });
    const userIds = [...new Set(owners.map((o) => o.userId))];
    const users = await this.elevated.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
    const result = new Map<string, string | null>();
    for (const id of ids) {
      result.set(
        id,
        emailByUserId.get(owners.find((o) => o.businessId === id)?.userId ?? '') ?? null,
      );
    }
    return result;
  }

  private subscriptionView(subscription: Subscription) {
    const dates = datesOf(subscription);
    const status = derivedStatus(dates);
    return {
      status,
      canAcceptBookings: status !== 'EXPIRED',
      trialStartedAt: subscription.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      paidPeriodStartAt: subscription.paidPeriodStartAt?.toISOString() ?? null,
      paidEndsAt: subscription.paidEndsAt?.toISOString() ?? null,
      paidGraceEndsAt: subscription.paidGraceEndsAt?.toISOString() ?? null,
      priceMinor: (subscription.priceMinor ?? SUBSCRIPTION_PRICE_MINOR).toString(),
    };
  }

  private requirePayment<T extends SubscriptionPayment>(payment: T | null): asserts payment is T {
    if (!payment) throw new NotFoundException('Subscription payment not found.');
  }

  /** The two platform Admins must never review a business they themselves own. */
  private async assertNotBusinessOwner(
    tx: TenantTransaction,
    businessId: string,
    userId: string,
  ): Promise<void> {
    const owned = await tx.businessOwner.findUnique({
      where: { businessId_userId: { businessId, userId } },
    });
    if (owned) {
      throw new AppException(
        'FORBIDDEN',
        403,
        'You cannot review a subscription payment for a business you own.',
      );
    }
  }
}

export interface AdminPaymentRow {
  id: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  ownerEmail: string | null;
  status: SubscriptionPayment['status'];
  amountMinor: string;
  note: string | null;
  mime: string;
  sizeBytes: number;
  submissionKey: string;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
  proofUrl?: string | null;
}

function adminRow(
  payment: SubscriptionPayment & { business: { id: string; name: string; publicSlug: string } },
  ownerEmail: string | null,
  proofUrl?: string | null,
): AdminPaymentRow {
  return {
    id: payment.id,
    businessId: payment.businessId,
    businessName: payment.business.name,
    businessSlug: payment.business.publicSlug,
    ownerEmail,
    status: payment.status,
    amountMinor: payment.amountMinor.toString(),
    note: payment.note,
    mime: payment.mime,
    sizeBytes: payment.sizeBytes,
    submissionKey: payment.submissionKey,
    submittedAt: payment.submittedAt,
    reviewedAt: payment.reviewedAt,
    reviewedByUserId: payment.reviewedByUserId,
    rejectionReason: payment.rejectionReason,
    proofUrl,
  };
}

function paymentView(payment: SubscriptionPayment) {
  return {
    id: payment.id,
    status: payment.status,
    amountMinor: payment.amountMinor.toString(),
    note: payment.note,
    mime: payment.mime,
    sizeBytes: payment.sizeBytes,
    submittedAt: payment.submittedAt,
    reviewedAt: payment.reviewedAt,
    rejectionReason: payment.rejectionReason,
  };
}

function datesOf(subscription: Subscription): SubscriptionDates {
  return {
    trialStartedAt: subscription.trialStartedAt,
    trialEndsAt: subscription.trialEndsAt,
    paidPeriodStartAt: subscription.paidPeriodStartAt,
    paidEndsAt: subscription.paidEndsAt,
    paidGraceEndsAt: subscription.paidGraceEndsAt,
  };
}
