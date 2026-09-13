import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { SYSTEM_ACTOR_ID } from '../business/business.service';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext, type TenantTransaction } from '../database/tenant-executor';
import { SecurityEventService } from '../iam/security-events.service';
import { MailService } from './mail.service';
import {
  TELEGRAM_PROVIDER,
  classifyMailError,
  isPermanentFailure,
  type DeliveryFailureCategory,
  type TelegramProvider,
} from './providers';
import {
  CUSTOMER_TELEGRAM_TYPES,
  DELIVERY_EXCLUDED_TYPES,
  OWNER_EMAIL_TYPES,
  OWNER_TELEGRAM_TYPES,
  SUBSCRIPTION_ADMIN_EMAIL_TYPES,
  SUBSCRIPTION_OWNER_EMAIL_TYPES,
  SUPPRESSED_RECIPIENT,
  deliveryIdempotencyKey,
  isReminderType,
  isSubscriptionReminderType,
  parseScheduleAffected,
  readPayload,
  readPayloadString,
  subscriptionReminderKindOf,
  type DeliveryBookingContext,
} from './notification-catalog';
import {
  renderCustomerTelegram,
  renderOwnerAffectedEmail,
  renderOwnerTelegramProof,
  renderSubscriptionAdminEmail,
  renderSubscriptionOwnerEmail,
} from './notification-templates';
import { createConnectToken, hashToken } from './telegram-connection.service';
import type { TelegramReplyMarkup } from './providers';
import { StorageService } from '../storage/storage.service';
import { reminderDecision, type SubscriptionDates } from '../subscription/subscription-lifecycle';

/**
 * Delivery pipeline (doc 13 §3/§4/§7, doc 17): the ONLY reader/writer of the
 * `notification_delivery` table.
 *
 *  - `fanOutDue()` — converts UNPROCESSED domain `notification` outbox rows
 *    into durable delivery intents (one row per channel × recipient, UNIQUE
 *    idempotency key ⇒ reruns are no-ops), or SUPPRESSED rows when there is no
 *    connected chat / no contact email / no entries at that moment.
 *  - `processDue()` — claims due rows (PENDING/FAILED → SENDING), performs the
 *    provider call OUTSIDE any open DB transaction (network must never pin a
 *    pooled connection), then finalizes SENT / FAILED(retryable) /
 *    DEAD_LETTERED / SUPPRESSED with bounded exponential backoff.
 *
 * The whole pipeline runs under scope SUPER_ADMIN (SYSTEM actor, doc 04 §7):
 * it reads and writes across every tenant's deliveries and must NEVER run
 * inside a domain (booking/payment/schedule) transaction.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(TELEGRAM_PROVIDER) private readonly telegram: TelegramProvider,
    private readonly mail: MailService,
    private readonly security: SecurityEventService,
    private readonly storage: StorageService,
  ) {}

  /** Super-admin transaction helper shared by every fan-out / finalize step. */
  private withSystem<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return withTenantContext(this.prisma, { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' }, fn);
  }

  /**
   * Fan out due notifications into delivery intents. Returns rows created.
   * Idempotent: existing idempotency keys are skipped by `skipDuplicates`.
   */
  async fanOutDue(): Promise<number> {
    const notifications = await this.withSystem((tx) =>
      tx.notification.findMany({
        where: {
          deliveries: { none: {} },
          type: { notIn: [...DELIVERY_EXCLUDED_TYPES] },
        },
        orderBy: { createdAt: 'asc' },
        take: this.config.deliveryFanoutMaxRows,
        select: { id: true, type: true, businessId: true, bookingId: true, payload: true },
      }),
    );

    let created = 0;
    for (const notification of notifications) {
      created += await this.withSystem((tx) => this.fanOutOne(tx, notification));
    }
    if (created > 0) this.logger.log(`Fan-out: ${created} delivery intent(s) created`);
    return created;
  }

  private async fanOutOne(
    tx: TenantTransaction,
    notification: {
      id: string;
      type: string;
      businessId: string | null;
      bookingId: string | null;
      payload: Prisma.JsonValue | null;
    },
  ): Promise<number> {
    if (!notification.businessId) return 0;
    if (CUSTOMER_TELEGRAM_TYPES.has(notification.type)) {
      if (!notification.bookingId) return 0;
      const connection = await tx.telegramConnection.findUnique({
        where: { bookingId: notification.bookingId },
        select: { status: true, chatId: true },
      });
      const recipient =
        connection?.status === 'ACTIVE' && connection.chatId !== null
          ? String(connection.chatId)
          : SUPPRESSED_RECIPIENT;
      return this.insertIntent(tx, {
        notificationId: notification.id,
        businessId: notification.businessId,
        channel: 'TELEGRAM',
        recipient,
        message: connection?.status === 'ACTIVE' ? null : 'no connected recipient',
      });
    }

    // Prompt 23 (REQ-065/066): a new payment proof fans out to EVERY ACTIVE
    // owner chat of the business (a shared bot may serve one owner with many
    // businesses). Missing connections produce one SUPPRESSED intent so the
    // fan-out remains idempotent.
    if (OWNER_TELEGRAM_TYPES.has(notification.type)) {
      const connections = await tx.businessOwnerTelegramConnection.findMany({
        where: { businessId: notification.businessId, status: 'ACTIVE', chatId: { not: null } },
        select: { chatId: true },
      });
      if (connections.length === 0) {
        return this.insertIntent(tx, {
          notificationId: notification.id,
          businessId: notification.businessId,
          channel: 'TELEGRAM',
          recipient: SUPPRESSED_RECIPIENT,
          message: 'no connected owner chat',
        });
      }
      let created = 0;
      for (const connection of connections) {
        if (connection.chatId === null) continue;
        created += await this.insertIntent(tx, {
          notificationId: notification.id,
          businessId: notification.businessId,
          channel: 'TELEGRAM',
          recipient: String(connection.chatId),
          message: null,
        });
      }
      return created;
    }

    if (OWNER_EMAIL_TYPES.has(notification.type)) {
      const payload = parseScheduleAffected(notification.payload);
      if (!payload.entries || payload.entries.length === 0) return 0;
      const business = await tx.business.findUnique({
        where: { id: notification.businessId },
        select: { contactEmail: true },
      });
      const recipient = business?.contactEmail ?? SUPPRESSED_RECIPIENT;
      return this.insertIntent(tx, {
        notificationId: notification.id,
        businessId: notification.businessId,
        channel: 'EMAIL',
        recipient,
        message: business?.contactEmail ? null : 'business has no contact email',
      });
    }

    // Prompt 14 (REQ-140): a payment submission is fanned out to the (exactly)
    // two earliest Admin platform accounts. Missing accounts simply produce
    // fewer intents — delivery is idempotent, so repeats are no-ops.
    if (SUBSCRIPTION_ADMIN_EMAIL_TYPES.has(notification.type)) {
      const admins = await tx.user.findMany({
        where: { role: 'Admin' },
        orderBy: { createdAt: 'asc' },
        take: 2,
        select: { email: true },
      });
      let created = 0;
      for (const admin of admins) {
        if (!admin.email || admin.email === '') continue;
        created += await this.insertIntent(tx, {
          notificationId: notification.id,
          businessId: notification.businessId,
          channel: 'EMAIL',
          recipient: admin.email,
          message: null,
        });
      }
      return created;
    }

    if (SUBSCRIPTION_OWNER_EMAIL_TYPES.has(notification.type)) {
      const business = await tx.business.findUnique({
        where: { id: notification.businessId },
        select: { contactEmail: true },
      });
      const recipient = business?.contactEmail ?? SUPPRESSED_RECIPIENT;
      return this.insertIntent(tx, {
        notificationId: notification.id,
        businessId: notification.businessId,
        channel: 'EMAIL',
        recipient,
        message: business?.contactEmail ? null : 'business has no contact email',
      });
    }

    return 0; // unrecognized / excluded types: no delivery intent
  }

  private async insertIntent(
    tx: TenantTransaction,
    intent: {
      notificationId: string;
      businessId: string;
      channel: 'EMAIL' | 'TELEGRAM';
      recipient: string;
      message: string | null;
    },
  ): Promise<number> {
    const result = await tx.notificationDelivery.createMany({
      data: [
        {
          notificationId: intent.notificationId,
          businessId: intent.businessId,
          channel: intent.channel,
          recipient: intent.recipient,
          idempotencyKey: deliveryIdempotencyKey(
            intent.notificationId,
            intent.channel,
            intent.recipient,
          ),
          status: intent.message === null ? ('PENDING' as const) : ('SUPPRESSED' as const),
          lastError: intent.message,
        },
      ],
      skipDuplicates: true,
    });
    return result.count;
  }

  // -------------------------------------------------------------------------
  // Delivery execution + retry
  // -------------------------------------------------------------------------

  /** Process due deliveries and return per-outcome counts. */
  async processDue(): Promise<DeliveryRunStats> {
    const now = new Date();
    const due = await this.withSystem((tx) =>
      tx.notificationDelivery.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          OR: [{ status: 'PENDING' }, { status: 'FAILED', nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: this.config.deliveryRetryBatchSize,
        select: { id: true },
      }),
    );
    if (due.length === 0) return { sent: 0, failed: 0, suppressed: 0, deadLettered: 0 };

    const stats: DeliveryRunStats = { sent: 0, failed: 0, suppressed: 0, deadLettered: 0 };
    for (const row of due) {
      const claimed = await this.withSystem((tx) => this.claim(tx, row.id));
      if (!claimed) continue; // lost the claim race to another sweeper instance
      stats[await this.executeAndFinalize(claimed)] += 1;
    }
    return stats;
  }

  /** Claim a due delivery (PENDING/FAILED → SENDING, attempts+1). Returns null if taken. */
  private async claim(tx: TenantTransaction, id: string): Promise<ClaimedDelivery | null> {
    const claim = await tx.notificationDelivery.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SENDING', attempts: { increment: 1 }, nextAttemptAt: null },
    });
    if (claim.count !== 1) return null;

    const delivery = await tx.notificationDelivery.findUnique({
      where: { id },
      include: {
        notification: { select: { id: true, type: true, payload: true, bookingId: true } },
        business: { select: { id: true, name: true, contactEmail: true } },
      },
    });
    if (!delivery) return null;

    const booking = delivery.notification.bookingId
      ? await tx.booking.findUnique({
          where: { id: delivery.notification.bookingId },
          select: {
            id: true,
            status: true,
            startAt: true,
            endAt: true,
            customerName: true,
            customerPhone: true,
            serviceItems: {
              select: { nameSnapshot: true, durationMinutes: true, unitPriceMinor: true },
            },
          },
        })
      : null;

    const connection = delivery.notification.bookingId
      ? await tx.telegramConnection.findUnique({
          where: { bookingId: delivery.notification.bookingId },
          select: { status: true, chatId: true },
        })
      : null;

    // Owner-proof deliveries need the payment + proof at the claim's snapshot
    // (the provider call happens OUTSIDE the transaction, but the source of
    // truth is read here so the send cannot race a commit).
    let ownerMeta: OwnerProofMeta | null = null;
    if (delivery.notification.bookingId && OWNER_TELEGRAM_TYPES.has(delivery.notification.type)) {
      const payment = await tx.payment.findFirst({
        where: { bookingId: delivery.notification.bookingId },
        include: {
          proofs: {
            orderBy: { submittedAt: 'desc' },
            select: { id: true, storageKey: true, mime: true, sizeBytes: true, submittedAt: true },
          },
        },
      });
      if (payment) {
        ownerMeta = {
          paymentId: payment.id,
          method: payment.method,
          prepaidMinor: payment.prepaidMinor,
          proofs: payment.proofs,
        };
      }
    }

    return { delivery, booking, connection, ownerMeta };
  }

  /** Send (OUTSIDE any DB transaction) then finalize the claim. Returns outcome. */
  private async executeAndFinalize(
    claimed: ClaimedDelivery,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    const { delivery, booking, connection, ownerMeta } = claimed;
    try {
      return delivery.channel === 'TELEGRAM'
        ? await this.deliverTelegram(delivery, booking, connection, ownerMeta)
        : await this.deliverEmail(delivery);
    } catch (err) {
      return this.finalizeFailure(delivery, 'TRANSIENT', err, new Date());
    }
  }

  private async deliverTelegram(
    delivery: DeliveryRowView,
    booking: BookingView | null,
    connection: ConnectionView | null,
    ownerMeta: OwnerProofMeta | null,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    const now = new Date();
    const type = delivery.notification.type;
    const chatId = parseChatId(delivery.recipient);
    if (chatId === null) return this.finalizeSuppressed(delivery, 'no active chat', now);

    // Owner proof verification (Prompt 23): photo/document send with Accept and
    // Reject inline action tokens, executed from chat-originated callbacks.
    if (OWNER_TELEGRAM_TYPES.has(type)) {
      return this.deliverOwnerProof(delivery, booking, ownerMeta, chatId, now);
    }

    // Reminder safety (doc 17 §reminder): re-check the AUTHORITATIVE booking
    // state at processing time — a stale queued reminder is suppressed.
    if (isReminderType(type)) {
      const queuedStart = String(readPayload(delivery.notification.payload).startAt ?? '');
      const statusOk = booking?.status === 'CONFIRMED';
      const timeOk = queuedStart !== '' && booking?.startAt.toISOString() === queuedStart;
      if (!booking || !statusOk || !timeOk) {
        return this.finalizeSuppressed(delivery, 'stale reminder (booking changed)', now);
      }
    }

    if (!connection || connection.status !== 'ACTIVE' || connection.chatId === null) {
      return this.finalizeSuppressed(delivery, 'no active chat', now);
    }
    if (!booking) return this.finalizeSuppressed(delivery, 'booking gone', now);

    const message = renderCustomerTelegram(
      type,
      toBookingContext(booking, delivery.business),
      readPayload(delivery.notification.payload),
    );
    const failure = await this.telegram.sendMessage({ chatId, text: message.text });
    if (failure === null) return this.finalizeSent(delivery, now);
    return this.finalizeFailure(delivery, failure, undefined, now);
  }

  /**
   * Owner new-proof delivery (REQ-065/066/067/068): attach the proof object
   * (image → sendPhoto, PDF → sendDocument) with the booking caption and an
   * inline Accept/Reject keyboard. The buttons carry single-use, expiring,
   * opaque action tokens issued here (sha256 stored); the callback flow in
   * OwnerTelegramService executes them with the owner's authority.
   *
   * Stale-safe: if the booking has already left PAYMENT_PENDING the intent is
   * suppressed instead of showing a misleading accept/reject prompt.
   */
  private async deliverOwnerProof(
    delivery: DeliveryRowView,
    booking: BookingView | null,
    ownerMeta: OwnerProofMeta | null,
    chatId: bigint,
    now: Date,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    if (!booking || booking.status !== 'PAYMENT_PENDING') {
      return this.finalizeSuppressed(delivery, 'booking no longer awaits payment', now);
    }
    if (!ownerMeta || ownerMeta.proofs.length === 0) {
      return this.finalizeSuppressed(delivery, 'no proof found', now);
    }

    const wanted = readPayloadString(delivery.notification.payload, 'proofId');
    const proof = ownerMeta.proofs.find((p) => p.id === wanted) ?? ownerMeta.proofs[0];
    if (!proof) return this.finalizeSuppressed(delivery, 'no proof found', now);

    const buffer = await this.storage.get(proof.storageKey);
    if (!buffer) return this.finalizeSuppressed(delivery, 'proof object missing', now);

    const caption = renderOwnerTelegramProof({
      bookingId: booking.id,
      businessName: delivery.business.name,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      startAt: booking.startAt.toISOString(),
      services: booking.serviceItems.map((item) => ({
        name: item.nameSnapshot,
        durationMinutes: item.durationMinutes,
      })),
      paymentMethod: ownerMeta.method,
      totalPriceMinor: booking.serviceItems.reduce(
        (sum, item) => sum + Number(item.unitPriceMinor),
        0,
      ),
      prepaidMinor: Number(ownerMeta.prepaidMinor),
      submittedAt: proof.submittedAt.toISOString(),
    });

    const tokens = await this.issueOwnerActions(chatId, {
      businessId: delivery.business.id,
      bookingId: booking.id,
      paymentId: ownerMeta.paymentId,
      proofId: proof.id,
    });
    if (tokens === null) return this.finalizeSuppressed(delivery, 'action token issue failed', now);

    const replyMarkup: TelegramReplyMarkup = {
      inlineKeyboard: [
        [
          { text: 'Accept payment', callbackData: `pv:accept:${tokens.acceptToken}` },
          { text: 'Reject payment', callbackData: `pv:reject:${tokens.rejectToken}` },
        ],
      ],
    };

    const input = {
      chatId,
      text: caption.text,
      buffer,
      mime: proof.mime,
      replyMarkup,
    };
    const failure =
      proof.mime === 'application/pdf'
        ? await this.telegram.sendDocument(input)
        : await this.telegram.sendPhoto(input);
    if (failure === null) return this.finalizeSent(delivery, now);
    return this.finalizeFailure(delivery, failure, undefined, now);
  }

  /**
   * Issue the single-use Accept/Reject action rows for an owner delivery.
   * The acting owner is the ACTIVE business_owner_telegram_connection for this
   * chat (the action must carry the owner's user_id so its execution runs with
   * that owner's RLS authority). Runs under SUPER_ADMIN scope (the webhook +
   * consumer do too). Raw tokens are returned once for the inline keyboard and
   * then never stored again — only their sha256 hashes persist.
   */
  private async issueOwnerActions(
    chatId: bigint,
    ref: { businessId: string; bookingId: string; paymentId: string; proofId: string },
  ): Promise<{ acceptToken: string; rejectToken: string } | null> {
    const owner = await this.withSystem((tx) =>
      tx.businessOwnerTelegramConnection.findFirst({
        where: { businessId: ref.businessId, chatId, status: 'ACTIVE' },
        select: { userId: true },
      }),
    );
    if (!owner) return null;

    const acceptToken = createConnectToken();
    const rejectToken = createConnectToken();
    const expiresAt = new Date(Date.now() + this.config.ownerTelegramActionTtlMinutes * 60_000);
    const rows = [
      {
        businessId: ref.businessId,
        userId: owner.userId,
        bookingId: ref.bookingId,
        paymentId: ref.paymentId,
        proofId: ref.proofId,
        chatId,
        kind: 'ACCEPT',
        status: 'ISSUED',
        tokenHash: hashToken(acceptToken),
        expiresAt,
      },
      {
        businessId: ref.businessId,
        userId: owner.userId,
        bookingId: ref.bookingId,
        paymentId: ref.paymentId,
        proofId: ref.proofId,
        chatId,
        kind: 'REJECT',
        status: 'ISSUED',
        tokenHash: hashToken(rejectToken),
        expiresAt,
      },
    ];
    const count = await this.withSystem((tx) => tx.ownerTelegramAction.createMany({ data: rows }));
    if (count.count !== 2) return null;
    return { acceptToken, rejectToken };
  }

  private async deliverEmail(
    delivery: DeliveryRowView,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    const now = new Date();
    const type = delivery.notification.type;
    if (OWNER_EMAIL_TYPES.has(type)) {
      const payload = parseScheduleAffected(delivery.notification.payload);
      if ((payload.entries?.length ?? 0) === 0) {
        return this.finalizeSuppressed(delivery, 'no affected entries', now);
      }
      if (!delivery.business.contactEmail) {
        return this.finalizeSuppressed(delivery, 'business has no contact email', now);
      }
      const email = renderOwnerAffectedEmail(payload, delivery.business.name, this.config);
      try {
        await this.mail.sendStrict({
          to: delivery.recipient,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        return this.finalizeSent(delivery, now);
      } catch (err) {
        return this.finalizeFailure(delivery, classifyMailError(err), err, now);
      }
    }

    // Prompt 14: subscription & billing emails (REQ-137/138/139/140).
    if (SUBSCRIPTION_ADMIN_EMAIL_TYPES.has(type)) {
      return this.deliverSubscriptionEmail(
        delivery,
        renderSubscriptionAdminEmail(readPayload(delivery.notification.payload)),
        now,
      );
    }
    if (SUBSCRIPTION_OWNER_EMAIL_TYPES.has(type)) {
      return this.deliverSubscriptionOwnerEmail(delivery, now);
    }
    return this.finalizeSuppressed(delivery, 'unsupported email notification type', now);
  }

  /** Reminder emails are stale-safe: suppressed unless the derived decision still holds. */
  private async deliverSubscriptionOwnerEmail(
    delivery: DeliveryRowView,
    now: Date,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    const type = delivery.notification.type;
    if (isSubscriptionReminderType(type)) {
      const subscription = await this.readSubscriptionFor(delivery.business.id);
      const decision = subscription ? reminderDecision(subscription) : null;
      if (decision?.kind !== subscriptionReminderKindOf(type)) {
        return this.finalizeSuppressed(delivery, 'stale subscription reminder', now);
      }
    }
    const email = renderSubscriptionOwnerEmail(
      type,
      readPayload(delivery.notification.payload),
      delivery.business.name,
    );
    return this.deliverSubscriptionEmail(delivery, email, now);
  }

  private async deliverSubscriptionEmail(
    delivery: DeliveryRowView,
    email: { subject: string; text: string; html: string },
    now: Date,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    try {
      await this.mail.sendStrict({
        to: delivery.recipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      return this.finalizeSent(delivery, now);
    } catch (err) {
      return this.finalizeFailure(delivery, classifyMailError(err), err, now);
    }
  }

  private readSubscriptionFor(businessId: string): Promise<SubscriptionDates | null> {
    return this.withSystem((tx) =>
      tx.subscription.findUnique({
        where: { businessId },
        select: {
          trialStartedAt: true,
          trialEndsAt: true,
          paidPeriodStartAt: true,
          paidEndsAt: true,
          paidGraceEndsAt: true,
        },
      }),
    );
  }

  // --- Finalizers (a claim already owns the row; each writes its own outcome) ---

  private finalizeSent(delivery: DeliveryRowView, now: Date): Promise<'sent'> {
    return this.withSystem((tx) =>
      tx.notificationDelivery
        .update({
          where: { id: delivery.id },
          data: { status: 'SENT', sentAt: now, lastError: null },
        })
        .then(() => 'sent' as const),
    );
  }

  private finalizeSuppressed(
    delivery: DeliveryRowView,
    reason: string,
    now: Date,
  ): Promise<'suppressed'> {
    void now;
    return this.withSystem((tx) =>
      tx.notificationDelivery
        .update({ where: { id: delivery.id }, data: { status: 'SUPPRESSED', lastError: reason } })
        .then(() => 'suppressed' as const),
    );
  }

  private finalizeFailure(
    delivery: DeliveryRowView,
    category: DeliveryFailureCategory,
    err: unknown,
    now: Date,
  ): Promise<'failed' | 'deadLettered'> {
    const errorMessage = err instanceof Error ? err.message : String(category);
    const attempts = delivery.attempts; // already incremented by the claim
    const permanent = isPermanentFailure(category);

    if (permanent || attempts >= this.config.deliveryRetryMaxAttempts) {
      return this.withSystem(async (tx) => {
        await tx.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'DEAD_LETTERED', lastError: `${category}: ${errorMessage}` },
        });
        await this.security.record({
          type: 'NOTIFICATION_DELIVERY_FAILED',
          businessId: delivery.business.id,
          result: `FAILURE:${category}`,
        });
        return 'deadLettered' as const;
      });
    }

    const delayMs = backoffDelay(
      attempts,
      this.config.deliveryRetryBaseDelayMs,
      this.config.deliveryRetryMaxDelayMs,
    );
    return this.withSystem((tx) =>
      tx.notificationDelivery
        .update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            nextAttemptAt: new Date(now.getTime() + delayMs),
            lastError: `${category}: ${errorMessage}`,
          },
        })
        .then(() => 'failed' as const),
    );
  }
}

export interface DeliveryRunStats {
  sent: number;
  failed: number;
  suppressed: number;
  deadLettered: number;
}

export interface DeliveryRowView {
  id: string;
  channel: 'EMAIL' | 'TELEGRAM';
  recipient: string;
  attempts: number;
  business: { id: string; name: string; contactEmail: string | null };
  notification: { type: string; payload: Prisma.JsonValue | null };
}

export interface BookingView {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  customerName: string;
  customerPhone: string;
  serviceItems: { nameSnapshot: string; durationMinutes: number; unitPriceMinor: bigint }[];
}

export interface ConnectionView {
  status: string;
  chatId: bigint | null;
}

export interface OwnerProofMeta {
  paymentId: string;
  method: string;
  prepaidMinor: bigint;
  proofs: { id: string; storageKey: string; mime: string; sizeBytes: number; submittedAt: Date }[];
}

export interface ClaimedDelivery {
  delivery: DeliveryRowView;
  booking: BookingView | null;
  connection: ConnectionView | null;
  ownerMeta: OwnerProofMeta | null;
}

function parseChatId(recipient: string): bigint | null {
  if (recipient === SUPPRESSED_RECIPIENT) return null;
  try {
    const value = BigInt(recipient);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

function toBookingContext(
  booking: BookingView,
  business: { id: string; name: string },
): DeliveryBookingContext {
  return {
    bookingId: booking.id,
    businessId: business.id,
    businessName: business.name,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    status: booking.status,
    services: booking.serviceItems.map((item) => ({
      name: item.nameSnapshot,
      durationMinutes: item.durationMinutes,
    })),
  };
}

/**
 * Bounded exponential backoff: base * 2^(attempts-1), capped at maxDelayMs.
 * `attempts` is the number already made (post-claim increment).
 */
export function backoffDelay(attempts: number, baseMs: number, maxMs: number): number {
  if (attempts <= 1) return Math.min(baseMs, maxMs);
  const exponent = Math.min(attempts - 1, 16);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}
