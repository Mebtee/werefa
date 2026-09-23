/**
 * Notification outbox writer + real DomainEventBus (Prompt 51).
 *
 * Replaces the in-memory bus in production wiring. `publish(...)` persists every
 * notification as `Notification` + `NotificationDelivery` rows (spec §32 outbox;
 * architecture doc 13), gated by the canonical rules:
 *
 *  - Customer N01–N08 are written ONLY as Telegram deliveries; the chat is
 *    resolved per business + phone (REQ-056). A connected customer's delivery
 *    starts PENDING; an unconnected customer's delivery is SUPPRESSED (no
 *    fabricated event is ever surfaced — spec §19 N01–N08).
 *  - Owner N09 (new payment proof, REQ-065/066) is written per connected owner
 *    connection with Accept/Reject callback tokens bound to that connection
 *    (T-09): a structured callback can never route across businesses/chats.
 *  - Auth email events (Prompt 43) are recorded as SUPPRESSED email deliveries
 *    (email delivery is out of scope; no real email is ever sent).
 *
 * Every delivery carries a stable idempotency key (unique constraint) so
 * repeated publishes / reminder sweeps are exactly-once.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { CONFIG } from '../../config/config.constants';
import {
  AuthEmailEvent,
  BookingNotificationEvent,
  DomainEvent,
  DomainEventBus,
  SubscriptionNotificationEvent,
} from '../events/domain-events';
import {
  adminSubscriptionDeliveryIdempotencyKey,
  authDeliveryIdempotencyKey,
  bookingPayloadRef,
  CUSTOMER_NOTIFICATION_SET,
  deliveryIdempotencyKey,
  OWNER_NOTIFICATION_SET,
  ownerSubscriptionDeliveryIdempotencyKey,
  subscriptionPayloadRef,
} from './notification-catalog';

@Injectable()
export class NotificationOutboxEventBus implements DomainEventBus {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async publish(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      try {
        if (isBookingNotificationEvent(event)) {
          await this.writeBookingEvent(event);
        } else if (isSubscriptionNotificationEvent(event)) {
          await this.writeSubscriptionEvent(event);
        } else if (isAuthEmailEvent(event)) {
          await this.writeAuthEmailEvent(event);
        }
      } catch {
        // REQ-056: booking validity NEVER depends on notification delivery.
        // A failed outbox write (busy DB, corrupt snapshot) must not fail the
        // already-committed request. Delivery is best-effort and the worker
        // retries are bounded; the write is exactly-once anyway.
      }
    }
  }

  /**
   * Write one subscription notification (Prompt 52).
   *
   *  - SUBSCRIPTION_PROOF_SUBMITTED (N17, REQ-140): exactly the two Admin
   *    accounts, email only, suppressed (email delivery is out of scope — the
   *    outbox row is the durable record).
   *  - SUBSCRIPTION_PROOF_REJECTED (N15, REQ-138): owner email (suppressed) AND
   *    the business owner Telegram connection (PENDING when connected+enabled).
   */
  async writeSubscriptionEvent(event: SubscriptionNotificationEvent): Promise<void> {
    if (event.type === 'SUBSCRIPTION_PROOF_SUBMITTED') {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', isDeactivated: false },
        orderBy: { email: 'asc' },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.createDelivery({
          businessId: event.businessId,
          type: event.type,
          recipientType: 'SYSTEM',
          recipientRef: admin.id,
          channel: 'EMAIL',
          state: 'SUPPRESSED',
          idempotencyKey: adminSubscriptionDeliveryIdempotencyKey(event.type, event.businessId, admin.id),
          payloadRef: subscriptionPayloadRef(event.proofId),
        });
      }
      return;
    }

    if (event.type === 'SUBSCRIPTION_PROOF_REJECTED') {
      const business = await this.prisma.business.findUnique({
        where: { id: event.businessId },
        select: { owners: { select: { user: { select: { id: true } } }, take: 1 } },
      });
      const owner = business?.owners[0]?.user;
      if (owner) {
        await this.createDelivery({
          businessId: event.businessId,
          type: event.type,
          recipientType: 'SYSTEM',
          recipientRef: owner.id,
          channel: 'EMAIL',
          state: 'SUPPRESSED',
          idempotencyKey: ownerSubscriptionDeliveryIdempotencyKey(event.type, event.businessId, event.proofId),
          payloadRef: subscriptionPayloadRef(event.proofId),
        });
      }
      const enabled = this.channelEnabled();
      const connections = await this.prisma.telegramConnection.findMany({
        where: { businessId: event.businessId, kind: 'BUSINESS_OWNER', state: 'CONNECTED' },
        orderBy: { connectedAt: 'desc' },
        select: { id: true },
      });
      for (const connection of connections) {
        await this.createDelivery({
          businessId: event.businessId,
          type: event.type,
          recipientType: 'OWNER',
          recipientRef: connection.id,
          channel: 'TELEGRAM',
          state: enabled ? 'PENDING' : 'SUPPRESSED',
          idempotencyKey: ownerSubscriptionDeliveryIdempotencyKey(event.type, event.businessId, event.proofId) + `:${connection.id}`,
          payloadRef: subscriptionPayloadRef(event.proofId),
        });
      }
      return;
    }
  }

  /** Write one booking notification (customer N01–N08 + owner N09). */
  async writeBookingEvent(event: BookingNotificationEvent): Promise<void> {
    const business = await this.prisma.business.findUnique({
      where: { id: event.businessId },
      select: { id: true },
    });
    if (!business) return; // business gone — nothing to notify for

    if (CUSTOMER_NOTIFICATION_SET.has(event.type)) {
      await this.writeCustomerDelivery(event);
    }
    if (OWNER_NOTIFICATION_SET.has(event.type)) {
      await this.writeOwnerDeliveries(event);
    }
  }

  private async writeCustomerDelivery(event: BookingNotificationEvent): Promise<void> {
    const connected = await this.prisma.telegramConnection.findFirst({
      where: {
        businessId: event.businessId,
        customerPhone: event.customerPhone,
        kind: 'CUSTOMER',
        state: 'CONNECTED',
      },
      orderBy: { connectedAt: 'desc' },
      select: { id: true },
    });
    const payload = bookingPayloadRef(event.bookingId);
    await this.createDelivery({
      businessId: event.businessId,
      type: event.type,
      recipientType: 'CUSTOMER',
      recipientRef: event.customerPhone,
      channel: 'TELEGRAM',
      state: connected && this.channelEnabled() ? 'PENDING' : 'SUPPRESSED',
      idempotencyKey: deliveryIdempotencyKey('CUSTOMER', event.type, event.bookingId),
      payloadRef: payload,
    });
  }

  private async writeOwnerDeliveries(event: BookingNotificationEvent): Promise<void> {
    const enabled = this.channelEnabled();
    const connections = await this.prisma.telegramConnection.findMany({
      where: { businessId: event.businessId, kind: 'BUSINESS_OWNER', state: 'CONNECTED' },
      orderBy: { connectedAt: 'desc' },
      select: { id: true },
    });
    for (const connection of connections) {
      // Structured Accept/Reject callbacks bound to THIS connection (T-09): a
      // callback token identifies one connection+business+booking and can only
      // be triggered from the chat bound to that connection.
      let tokens: Array<{ id: string }> = [];
      if (enabled) {
        tokens = await this.prisma.telegramCallback.createManyAndReturn({
          select: { id: true },
          data: [
            {
              businessId: event.businessId,
              connectionId: connection.id,
              bookingId: event.bookingId,
              kind: 'ACCEPT_PROOF',
            },
            {
              businessId: event.businessId,
              connectionId: connection.id,
              bookingId: event.bookingId,
              kind: 'REJECT_PROOF',
            },
          ],
        });
      }
      await this.createDelivery({
        businessId: event.businessId,
        type: event.type,
        recipientType: 'OWNER',
        recipientRef: connection.id,
        channel: 'TELEGRAM',
        state: enabled ? 'PENDING' : 'SUPPRESSED',
        idempotencyKey: deliveryIdempotencyKey('OWNER', event.type, event.bookingId) + `:${connection.id}`,
        payloadRef: bookingPayloadRef(event.bookingId, {
          accept: tokens[0]?.id ?? '',
          reject: tokens[1]?.id ?? '',
        }),
      });
    }
  }

  private async writeAuthEmailEvent(event: AuthEmailEvent): Promise<void> {
    await this.createDelivery({
      businessId: null,
      type: event.type,
      recipientType: 'SYSTEM',
      recipientRef: event.userId,
      channel: 'EMAIL',
      state: 'SUPPRESSED',
      idempotencyKey: authDeliveryIdempotencyKey(event.type, event.userId),
      payloadRef: null,
    });
  }

  /** The Telegram channel can only be written PENDING when enabled (fail-safe). */
  private channelEnabled(): boolean {
    return this.config.telegramEnabled;
  }

  /**
   * Atomic write of one Notification + one NotificationDelivery. The
   * `idempotency_key` unique constraint is the exactly-once guard: a coordinated
   * duplicate (replayed publish or overlapping reminder sweep) is a P2002 and is
   * silently skipped — the earlier write wins and nothing is duplicated.
   */
  private async createDelivery(input: {
    businessId: string | null;
    type: string;
    recipientType: 'CUSTOMER' | 'OWNER' | 'SYSTEM';
    recipientRef: string;
    channel: 'TELEGRAM' | 'EMAIL';
    state: 'PENDING' | 'SUPPRESSED';
    idempotencyKey: string;
    payloadRef: string | null;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const notification = await tx.notification.create({
          data: {
            businessId: input.businessId,
            type: input.type,
          },
        });
        await tx.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            recipientType: input.recipientType,
            recipientRef: input.recipientRef,
            channel: input.channel,
            state: input.state,
            idempotencyKey: input.idempotencyKey,
            payloadRef: input.payloadRef,
            ...(input.state === 'PENDING' ? { nextAttemptAt: null } : {}),
          },
        });
      });
    } catch (err) {
      if (isPrismaP2002(err)) {
        return; // exactly-once: an identical notification already exists.
      }
      throw err;
    }
  }
}

function isBookingNotificationEvent(event: DomainEvent): event is BookingNotificationEvent {
  return 'bookingId' in event && 'businessId' in event;
}

function isSubscriptionNotificationEvent(event: DomainEvent): event is SubscriptionNotificationEvent {
  return 'proofId' in event && 'businessId' in event;
}

function isAuthEmailEvent(event: DomainEvent): event is AuthEmailEvent {
  return 'userId' in event && 'email' in event;
}

function isPrismaP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}