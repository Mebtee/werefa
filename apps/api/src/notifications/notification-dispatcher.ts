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
  SUPPRESSED_RECIPIENT,
  deliveryIdempotencyKey,
  isReminderType,
  parseScheduleAffected,
  readPayload,
  type DeliveryBookingContext,
} from './notification-catalog';
import { renderCustomerTelegram, renderOwnerAffectedEmail } from './notification-templates';

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
            serviceItems: { select: { nameSnapshot: true, durationMinutes: true } },
          },
        })
      : null;

    const connection = delivery.notification.bookingId
      ? await tx.telegramConnection.findUnique({
          where: { bookingId: delivery.notification.bookingId },
          select: { status: true, chatId: true },
        })
      : null;

    return { delivery, booking, connection };
  }

  /** Send (OUTSIDE any DB transaction) then finalize the claim. Returns outcome. */
  private async executeAndFinalize(
    claimed: ClaimedDelivery,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    const { delivery, booking, connection } = claimed;
    try {
      return delivery.channel === 'TELEGRAM'
        ? await this.deliverTelegram(delivery, booking, connection)
        : await this.deliverEmail(delivery);
    } catch (err) {
      return this.finalizeFailure(delivery, 'TRANSIENT', err, new Date());
    }
  }

  private async deliverTelegram(
    delivery: DeliveryRowView,
    booking: BookingView | null,
    connection: ConnectionView | null,
  ): Promise<'sent' | 'failed' | 'suppressed' | 'deadLettered'> {
    const now = new Date();
    const type = delivery.notification.type;
    const chatId = parseChatId(delivery.recipient);
    if (chatId === null) return this.finalizeSuppressed(delivery, 'no active chat', now);

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
    return this.finalizeSuppressed(delivery, 'unsupported email notification type', now);
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
  serviceItems: { nameSnapshot: string; durationMinutes: number }[];
}

export interface ConnectionView {
  status: string;
  chatId: bigint | null;
}

export interface ClaimedDelivery {
  delivery: DeliveryRowView;
  booking: BookingView | null;
  connection: ConnectionView | null;
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
