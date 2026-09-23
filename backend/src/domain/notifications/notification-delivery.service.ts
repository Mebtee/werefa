/**
 * Notification delivery worker + appointment-reminder sweep (Prompt 51).
 *
 * A single in-process sweep (guarded by TELEGRAM_ENABLED) does two jobs:
 *
 *  1. Writes due appointment reminders (N04/N05 = REQ-063/REQ-064) into the
 *     outbox. Reminders are derived — each CONFIRMED booking has exactly two
 *     due windows 24h and 1h before start — and the write is exactly-once via
 *     the delivery idempotency key, so an unconnected customer never receives
 *     a reminder and no reminder is ever re-mailed.
 *  2. Claims PENDING Telegram deliveries and delivers them through the provider,
 *     with bounded retries: FAILED → backoff → DEAD_LETTERED at
 *     `TELEGRAM_DELIVERY_MAX_ATTEMPTS`. Unresolved chats (revoked connections)
 *     become SUPPRESSED. Stale SENDING rows (process died mid-send) are
 *     reclaimed.
 *
 * Booking validity NEVER depends on delivery (REQ-056); failures are recorded,
 * never thrown, and never held against the booking.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT, CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { BookingNotificationEvent } from '../events/domain-events';
import { TelegramProvider, TELEGRAM_PROVIDER } from './telegram-provider.port';
import { NotificationMessageRenderer } from './notification-message-renderer';
import { acceptCallbackData, rejectCallbackData, parsePayloadRef } from './notification-catalog';
import { NotificationOutboxEventBus } from './notification-outbox-event-bus';

const REMINDER_GRACE_MS = 60 * 60 * 1000; // reminder due window after its threshold
const STALE_SENDING_MS = 10 * 60 * 1000; // reclaim a SENDING delivery stuck for 10min
const CLAIM_BATCH = 25;

export interface SweepResult {
  /** Reminder outbox rows written (may be SUPPRESSED). */
  remindersWritten: number;
  attempted: number;
  sent: number;
  failed: number;
  deadLettered: number;
  suppressed: number;
}

@Injectable()
export class NotificationDeliveryService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_PROVIDER) private readonly provider: TelegramProvider,
    private readonly renderer: NotificationMessageRenderer,
    private readonly outbox: NotificationOutboxEventBus,
  ) {}

  /** One sweep cycle: reminders -> delivery. Returns counts for observability. */
  async sweep(now = new Date()): Promise<SweepResult> {
    const remindersWritten = await this.writeDueReminders(now);
    const delivery = await this.deliverPending(now);
    return { remindersWritten, ...delivery };
  }

  /** Write REMINDER_24H / REMINDER_1H outbox rows for due CONFIRMED bookings. */
  async writeDueReminders(now = new Date()): Promise<number> {
    const to = new Date(now.getTime() + 25 * 3600 * 1000);
    const bookings = await this.prisma.booking.findMany({
      where: { status: 'CONFIRMED', startAt: { gt: now, lt: to } },
      select: { id: true, businessId: true, customerPhone: true, startAt: true },
    });

    let written = 0;
    for (const booking of bookings) {
      const untilStart = booking.startAt.getTime() - now.getTime();
      const types: Array<'REMINDER_24H' | 'REMINDER_1H'> = [];
      if (untilStart >= 23 * 3600 * 1000 && untilStart <= 24 * 3600 * 1000 + REMINDER_GRACE_MS) {
        types.push('REMINDER_24H');
      }
      if (untilStart >= 0 && untilStart <= 3600 * 1000) {
        types.push('REMINDER_1H');
      }
      for (const type of types) {
        const event: BookingNotificationEvent = {
          type,
          businessId: booking.businessId,
          bookingId: booking.id,
          customerPhone: booking.customerPhone,
          occurredAt: now,
        };
        await this.outbox.writeBookingEvent(event);
        written++;
      }
    }
    return written;
  }

  /** Claim and deliver PENDING Telegram deliveries (bounded retries). */
  async deliverPending(now = new Date()): Promise<Omit<SweepResult, 'remindersWritten'>> {
    await this.reclaimStale(now);

    const rows = await this.prisma.notificationDelivery.findMany({
      where: {
        channel: 'TELEGRAM',
        state: 'PENDING',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: CLAIM_BATCH,
      include: { notification: true },
    });

    const result: Omit<SweepResult, 'remindersWritten'> = {
      attempted: 0,
      sent: 0,
      failed: 0,
      deadLettered: 0,
      suppressed: 0,
    };

    for (const row of rows) {
      const claimed = await this.prisma.notificationDelivery.updateMany({
        where: { id: row.id, state: 'PENDING' },
        data: { state: 'SENDING' },
      });
      if (claimed.count === 0) continue;
      result.attempted++;

      try {
        const outcome = await this.deliverOne(row, now);
        result[outcome] = (result[outcome] as number) + 1;
      } catch {
        // safety: a renderer/provider bug must never crash the sweep
        result.failed++;
      }
    }
    return result;
  }

  private async deliverOne(
    row: {
      id: string;
      recipientType: string;
      recipientRef: string;
      payloadRef: string | null;
      attempts: number;
      notification: { businessId: string | null; type: string };
    },
    now: Date,
  ): Promise<'sent' | 'failed' | 'deadLettered' | 'suppressed'> {
    const businessId = row.notification.businessId;
    if (!businessId) return this.markSuppressed(row.id);

    // Resolve the chat bound to the delivery.
    let chatId: bigint | null = null;
    if (row.recipientType === 'CUSTOMER') {
      const connection = await this.prisma.telegramConnection.findFirst({
        where: { businessId, customerPhone: row.recipientRef, kind: 'CUSTOMER', state: 'CONNECTED' },
        orderBy: { connectedAt: 'desc' },
        select: { chatId: true },
      });
      chatId = connection?.chatId ?? null;
    } else if (row.recipientType === 'OWNER') {
      const connection = await this.prisma.telegramConnection.findUnique({
        where: { id: row.recipientRef },
        select: { chatId: true, state: true, businessId: true },
      });
      if (connection && connection.businessId === businessId && connection.state === 'CONNECTED') {
        chatId = connection.chatId;
      }
    }

    if (chatId === null) return this.markSuppressed(row.id);
    if (!this.config.telegramEnabled) return this.markSuppressed(row.id);

    // Render the message from the persisted kind + booking/business snapshots.
    const parsed = parsePayloadRef(row.payloadRef);

    // Subscription N15 — rejection reason to the business Telegram (REQ-138).
    if (row.notification.type === 'SUBSCRIPTION_PROOF_REJECTED') {
      if (!parsed.proofId) return this.markSuppressed(row.id);
      const [proof, business] = await Promise.all([
        this.prisma.subscriptionProof.findUnique({ where: { id: parsed.proofId } }),
        this.prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
      ]);
      if (!business) return this.markSuppressed(row.id);
      const text = this.renderer.renderSubscriptionProofRejected({
        businessName: business.name,
        rejectionReason: proof?.rejectionReason ?? null,
      });
      const sent = await this.provider.sendMessage({ chatId, text });
      if (sent.ok) {
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { state: 'SENT', sentAt: now, lastError: null },
        });
        return 'sent';
      }
      return this.recordFailure(row, now, sent.error);
    }

    if (!parsed.bookingId) return this.markSuppressed(row.id);

    const [booking, business] = await Promise.all([
      this.prisma.booking.findUnique({
        where: { id: parsed.bookingId },
        include: {
          components: true,
          payment: { select: { id: true, status: true, method: true, prepaidMinor: true } },
        },
      }),
      this.prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    ]);
    if (!booking || !business) return this.markSuppressed(row.id);

    const isOwner = row.recipientType === 'OWNER';
    const text = isOwner
      ? this.renderer.renderOwnerProofReceived({ booking, businessName: business.name })
      : this.renderer.render({
          type: row.notification.type,
          booking,
          businessName: business.name,
          rejectionReason: await this.rejectionReason(businessId, booking.id, row.notification.type),
        }).text;

    let replyMarkup:
      | { inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> }
      | undefined;
    if (isOwner) {
      replyMarkup = {
        inlineKeyboard: [
          [
            { text: '✓ Accept', callbackData: acceptCallbackData(parsed.acceptToken ?? '') },
            { text: '✗ Reject', callbackData: rejectCallbackData(parsed.rejectToken ?? '') },
          ],
        ],
      };
    }

    const sent = await this.provider.sendMessage({ chatId, text, replyMarkup });
    if (sent.ok) {
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { state: 'SENT', sentAt: now, lastError: null },
      });
      return 'sent';
    }
    return this.recordFailure(row, now, sent.error);
  }

  /** Bounded-retry bookkeeping shared by every Telegram delivery path. */
  private async recordFailure(
    row: { id: string; attempts: number },
    now: Date,
    error: string | null | undefined,
  ): Promise<'deadLettered' | 'failed'> {
    const attempts = row.attempts + 1;
    const max = this.config.telegramDeliveryMaxAttempts;
    if (attempts >= max) {
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { state: 'DEAD_LETTERED', attempts, lastError: truncate(error) },
      });
      return 'deadLettered';
    }
    await this.prisma.notificationDelivery.update({
      where: { id: row.id },
      data: {
        state: 'PENDING',
        attempts,
        lastError: truncate(error),
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
      },
    });
    return 'failed';
  }

  private async rejectionReason(businessId: string, bookingId: number, type: string): Promise<string | null> {
    if (type !== 'PAYMENT_REJECTED') return null;
    const entry = await this.prisma.bookingStatusHistory.findFirst({
      where: { businessId, bookingId, toStatus: 'REJECTED' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { reason: true },
    });
    return entry?.reason ?? null;
  }

  /** SENDING rows that never completed (crashed worker) return to the queue. */
  private async reclaimStale(now: Date): Promise<void> {
    const stale = await this.prisma.notificationDelivery.findMany({
      where: { state: 'SENDING', updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
      select: { id: true, attempts: true },
      take: CLAIM_BATCH,
    });
    for (const row of stale) {
      const attempts = row.attempts + 1;
      if (attempts >= this.config.telegramDeliveryMaxAttempts) {
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { state: 'DEAD_LETTERED', attempts, lastError: 'claimed and stuck (SENDING timeout)' },
        });
      } else {
        await this.prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { state: 'PENDING', attempts, nextAttemptAt: now },
        });
      }
    }
  }

  private async markSuppressed(id: string): Promise<'suppressed'> {
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { state: 'SUPPRESSED', lastError: 'no connected Telegram chat' },
    });
    return 'suppressed';
  }
}

function backoffMs(attempt: number): number {
  // 30s, 1m, 2m, 4m ... capped at 10 minutes.
  return Math.min(600_000, 30_000 * 2 ** (attempt - 1));
}

function truncate(value: string | null | undefined): string | null {
  return value ? value.slice(0, 2000) : null;
}