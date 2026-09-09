import { Injectable } from '@nestjs/common';
import { ErrorCodes } from '@werefa/shared';
import { ConflictException, NotFoundException } from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import type { TenantTransaction } from '../database/tenant-executor';
import type { ActorContext } from '../common/context/actor-context';
import { SecurityEventService } from '../iam/security-events.service';
import { withOwnerBookingLock } from './booking-lock';
import { withOwnerBusinessContext } from '../database/tenant-executor';
import {
  assertBookingTransition,
  assertPaymentTransition,
  assertSlotLockTransition,
} from './booking-transitions';
import { BookingAvailabilityService } from './booking-availability';
import { ScheduleAvailabilityService } from '../schedule/schedule-availability.service';
import { BookingNotificationService, BOOKING_NOTIFICATION_TYPE } from './booking-notifications';
import { loadBookingAggregate } from './booking-aggregate';
import { BookingSerializer, type BookingAggregate } from './booking.serializer';
import type { BookingStatus } from '@prisma/client';

export interface ListBookingsParams {
  status?: BookingStatus;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
  sort?: 'RECENT' | 'UPCOMING';
}

/**
 * Owner booking management (Prompt 11, Domain 5 / doc 04 §9, master spec
 * Section 26). Every mutation runs under `withOwnerBookingLock`: owner scope +
 * per-business advisory lock so the guarded state updates are serialized and
 * the slot overlap re-check is authoritative inside the transaction.
 *
 * Owner consent/undo semantics (doc 08 §7.1): cancellation of PAYMENT_PENDING
 * keeps the slot LOCKED (SM-08); cancellation of CONFIRMED / REJECTED releases
 * the slot (SM-06/07, SM-09 option A). Rejection keeps the slot LOCKED so the
 * customer can resubmit while verification is otherwise protected (T10).
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serializer: BookingSerializer,
    private readonly availability: BookingAvailabilityService,
    private readonly scheduleWindow: ScheduleAvailabilityService,
    private readonly notifications: BookingNotificationService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  async list(actor: ActorContext, businessId: string, params: ListBookingsParams) {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, async (tx) => {
      const where = {
        businessId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.from || params.to
          ? {
              startAt: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.booking.findMany({
          where,
          include: { serviceItems: { orderBy: { createdAt: 'asc' } }, payment: true },
          orderBy: { startAt: params.sort === 'RECENT' ? 'desc' : 'asc' },
          skip: params.skip ?? 0,
          take: Math.min(params.take ?? 50, 100),
        }),
        tx.booking.count({ where }),
      ]);
      return {
        bookings: rows.map((row) =>
          this.serializer.ownerList({
            booking: row,
            payment: row.payment
              ? ({
                  ...row.payment,
                  proofs: [],
                  rejectionEvents: [],
                } as unknown as NonNullable<BookingAggregate['payment']>)
              : null,
            statusHistory: [],
            paymentStatusHistory: [],
            slotLock: null,
            scheduleExceptions: [],
          }),
        ),
        total,
      };
    });
  }

  async detail(actor: ActorContext, businessId: string, bookingId: string) {
    const row = await withOwnerBusinessContext(this.prisma, actor.userId, businessId, (tx) =>
      loadBookingAggregate(tx, businessId, bookingId),
    );
    if (!row) throw new NotFoundException('Booking not found.');
    await this.securityEvents.record({
      type: 'BOOKING_STATUS_VIEW',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return this.serializer.ownerDetail(row);
  }

  /** Accept a booking + its payment proof (T2): PENDING proof accepted, slot ALLOCATED. */
  async accept(actor: ActorContext, businessId: string, bookingId: string) {
    const row = await withOwnerBookingLock(this.prisma, actor.userId, businessId, (tx) =>
      this.confirmChain(tx, businessId, bookingId, actor.userId),
    );
    await this.securityEvents.record({
      type: 'BOOKING_ACCEPT',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return this.serializer.ownerDetail(row);
  }

  /** Reject the payment proof + booking (T3): mandatory reason (REQ-068/124), slot stays LOCKED. */
  async reject(actor: ActorContext, businessId: string, bookingId: string, reason: string) {
    const row = await withOwnerBookingLock(this.prisma, actor.userId, businessId, (tx) =>
      this.rejectChain(tx, businessId, bookingId, actor.userId, reason),
    );
    await this.securityEvents.record({
      type: 'BOOKING_REJECT',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return this.serializer.ownerDetail(row);
  }

  /**
   * Cancel a booking (SM-06/07/08/09). PAYMENT_PENDING keeps the slot LOCKED
   * (no release — SM-08); CONFIRMED/REJECTED release it (SM-07, SM-09-A).
   */
  async cancel(actor: ActorContext, businessId: string, bookingId: string) {
    const row = await withOwnerBookingLock(this.prisma, actor.userId, businessId, (tx) =>
      this.cancelChain(tx, businessId, bookingId, actor.userId),
    );
    await this.securityEvents.record({
      type: 'BOOKING_CANCEL',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return this.serializer.ownerDetail(row);
  }

  /** Reschedule a confirmed booking (T7): CONFIRMED→CONFIRMED, duration preserved. */
  async reschedule(actor: ActorContext, businessId: string, bookingId: string, newStartAt: Date) {
    const row = await withOwnerBookingLock(this.prisma, actor.userId, businessId, (tx) =>
      this.rescheduleChain(tx, businessId, bookingId, actor.userId, newStartAt),
    );
    await this.securityEvents.record({
      type: 'BOOKING_RESCHEDULE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return this.serializer.ownerDetail(row);
  }

  /** Mark a confirmed booking as a no-show (T5): slot released, notification queued. */
  async noShow(actor: ActorContext, businessId: string, bookingId: string) {
    const row = await withOwnerBookingLock(this.prisma, actor.userId, businessId, (tx) =>
      this.noShowChain(tx, businessId, bookingId, actor.userId),
    );
    await this.securityEvents.record({
      type: 'BOOKING_NO_SHOW',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return this.serializer.ownerDetail(row);
  }

  /**
   * Explicit slot release (doc 08 §7.5): valid ONLY for non-active bookings
   * (CANCELLED/REJECTED, and defensively COMPLETED/NO_SHOW) that still carry an
   * active slot lock. Releasing a PAYMENT_PENDING/CONFIRMED lock is forbidden —
   * use cancel instead.
   */
  async releaseSlot(actor: ActorContext, businessId: string, bookingId: string) {
    await withOwnerBookingLock(this.prisma, actor.userId, businessId, async (tx) => {
      const agg = await loadBookingAggregate(tx, businessId, bookingId);
      if (!agg) throw new NotFoundException('Booking not found.');
      const { booking, slotLock } = agg;
      if (!slotLock || slotLock.status === 'RELEASED') {
        throw new ConflictException(
          'This booking has no active slot lock to release.',
          ErrorCodes.INVALID_TRANSITION,
        );
      }
      if (booking.status === 'PAYMENT_PENDING' || booking.status === 'CONFIRMED') {
        throw new ConflictException(
          'An active booking cannot have its slot released. Cancel the booking instead.',
          ErrorCodes.INVALID_TRANSITION,
        );
      }
      if (slotLock.status === 'LOCKED') assertSlotLockTransition('LOCKED', 'RELEASED');
      else assertSlotLockTransition('ALLOCATED', 'RELEASED');
      await tx.slotLock.update({
        where: { id: slotLock.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releasedBy: 'USER',
          releasedByUserId: actor.userId,
        },
      });
    });
    await this.securityEvents.record({
      type: 'BOOKING_RELEASE_SLOT',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return { ok: true as const };
  }

  private async confirmChain(
    tx: TenantTransaction,
    businessId: string,
    bookingId: string,
    userId: string,
  ) {
    const agg = await loadBookingAggregate(tx, businessId, bookingId);
    if (!agg) throw new NotFoundException('Booking not found.');
    const { booking, payment, slotLock } = agg;
    if (!payment || !slotLock) {
      throw new ConflictException(
        'Booking payment or slot record is missing.',
        ErrorCodes.INVALID_TRANSITION,
      );
    }
    assertBookingTransition(booking.status, 'CONFIRMED');
    assertPaymentTransition(payment.status, 'ACCEPTED');
    assertSlotLockTransition(slotLock.status, 'ALLOCATED');

    const now = new Date();
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'ACCEPTED' } });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        businessId,
        fromStatus: 'PENDING',
        toStatus: 'ACCEPTED',
        actorType: 'OWNER',
        actorUserId: userId,
        occurredAt: now,
      },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: 'PAYMENT_PENDING',
        toStatus: 'CONFIRMED',
        actorType: 'OWNER',
        actorUserId: userId,
        reason: null,
        occurredAt: now,
      },
    });
    await tx.slotLock.update({ where: { id: slotLock.id }, data: { status: 'ALLOCATED' } });
    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.confirmed,
      payload: {},
    });
    const result = await loadBookingAggregate(tx, businessId, bookingId);
    if (!result)
      throw new ConflictException('Booking disappeared during confirmation.', ErrorCodes.CONFLICT);
    return result;
  }

  private async rejectChain(
    tx: TenantTransaction,
    businessId: string,
    bookingId: string,
    userId: string,
    reason: string,
  ) {
    const agg = await loadBookingAggregate(tx, businessId, bookingId);
    if (!agg) throw new NotFoundException('Booking not found.');
    const { booking, payment, slotLock } = agg;
    if (!payment || !slotLock) {
      throw new ConflictException(
        'Booking payment or slot record is missing.',
        ErrorCodes.INVALID_TRANSITION,
      );
    }
    assertBookingTransition(booking.status, 'REJECTED');
    assertPaymentTransition(payment.status, 'REJECTED');

    const now = new Date();
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'REJECTED' } });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        businessId,
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
        actorType: 'OWNER',
        actorUserId: userId,
        occurredAt: now,
      },
    });
    await tx.paymentRejectionEvent.create({
      data: { paymentId: payment.id, businessId, reason, createdByUserId: userId },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'REJECTED' } });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: 'PAYMENT_PENDING',
        toStatus: 'REJECTED',
        actorType: 'OWNER',
        actorUserId: userId,
        reason,
        occurredAt: now,
      },
    });
    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.rejected,
      payload: { reason },
    });
    const result = await loadBookingAggregate(tx, businessId, bookingId);
    if (!result)
      throw new ConflictException('Booking disappeared during rejection.', ErrorCodes.CONFLICT);
    return result;
  }

  private async cancelChain(
    tx: TenantTransaction,
    businessId: string,
    bookingId: string,
    userId: string,
  ) {
    const agg = await loadBookingAggregate(tx, businessId, bookingId);
    if (!agg) throw new NotFoundException('Booking not found.');
    const { booking, slotLock } = agg;
    assertBookingTransition(booking.status, 'CANCELLED');

    const now = new Date();
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: booking.status,
        toStatus: 'CANCELLED',
        actorType: 'OWNER',
        actorUserId: userId,
        reason: 'cancelled by owner',
        occurredAt: now,
      },
    });

    const releasesSlot = booking.status === 'CONFIRMED' || booking.status === 'REJECTED';
    if (releasesSlot && slotLock && slotLock.status !== 'RELEASED') {
      assertSlotLockTransition(slotLock.status, 'RELEASED');
      await tx.slotLock.update({
        where: { id: slotLock.id },
        data: { status: 'RELEASED', releasedAt: now, releasedBy: 'USER', releasedByUserId: userId },
      });
    }

    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.cancelled,
      payload: {},
    });
    const result = await loadBookingAggregate(tx, businessId, bookingId);
    if (!result)
      throw new ConflictException('Booking disappeared during cancellation.', ErrorCodes.CONFLICT);
    return result;
  }

  private async rescheduleChain(
    tx: TenantTransaction,
    businessId: string,
    bookingId: string,
    userId: string,
    newStartAt: Date,
  ) {
    const agg = await loadBookingAggregate(tx, businessId, bookingId);
    if (!agg) throw new NotFoundException('Booking not found.');
    const { booking, slotLock } = agg;
    assertBookingTransition(booking.status, 'CONFIRMED');
    if (!slotLock) {
      throw new ConflictException('Booking slot record is missing.', ErrorCodes.INVALID_TRANSITION);
    }

    const durationMinutes = booking.serviceItems.reduce(
      (sum, item) => sum + item.durationMinutes,
      0,
    );
    const newEndAt = new Date(newStartAt.getTime() + durationMinutes * 60_000);
    const newSlotDate = BookingAvailabilityService.slotDateOf(newStartAt);

    await this.scheduleWindow.assertWindowOk(tx, businessId, newStartAt, newEndAt);

    await this.availability.requireSlotAvailable(tx, {
      businessId,
      startAt: newStartAt,
      endAt: newEndAt,
      excludeBookingId: booking.id,
    });

    const now = new Date();
    await tx.booking.update({
      where: { id: booking.id },
      data: { startAt: newStartAt, endAt: newEndAt, slotDate: newSlotDate },
    });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: 'CONFIRMED',
        toStatus: 'CONFIRMED',
        actorType: 'OWNER',
        actorUserId: userId,
        reason: 'rescheduled',
        occurredAt: now,
      },
    });

    if (slotLock.status !== 'RELEASED') {
      assertSlotLockTransition(slotLock.status, 'RELEASED');
      await tx.slotLock.update({
        where: { id: slotLock.id },
        data: { status: 'RELEASED', releasedAt: now, releasedBy: 'USER', releasedByUserId: userId },
      });
    }
    await tx.slotLock.create({
      data: {
        businessId,
        bookingId: booking.id,
        slotDate: newSlotDate,
        startAt: newStartAt,
        endAt: newEndAt,
        status: 'ALLOCATED',
      },
    });

    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.rescheduled,
      payload: { newStartAt: newStartAt.toISOString() },
    });
    const result = await loadBookingAggregate(tx, businessId, bookingId);
    if (!result)
      throw new ConflictException('Booking disappeared during rescheduling.', ErrorCodes.CONFLICT);
    return result;
  }

  private async noShowChain(
    tx: TenantTransaction,
    businessId: string,
    bookingId: string,
    userId: string,
  ) {
    const agg = await loadBookingAggregate(tx, businessId, bookingId);
    if (!agg) throw new NotFoundException('Booking not found.');
    const { booking, slotLock } = agg;
    assertBookingTransition(booking.status, 'NO_SHOW');

    const now = new Date();
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'NO_SHOW' } });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: 'CONFIRMED',
        toStatus: 'NO_SHOW',
        actorType: 'OWNER',
        actorUserId: userId,
        reason: 'no-show',
        occurredAt: now,
      },
    });
    if (slotLock && slotLock.status !== 'RELEASED') {
      assertSlotLockTransition(slotLock.status, 'RELEASED');
      await tx.slotLock.update({
        where: { id: slotLock.id },
        data: { status: 'RELEASED', releasedAt: now, releasedBy: 'USER', releasedByUserId: userId },
      });
    }
    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.noShow,
      payload: {},
    });
    const result = await loadBookingAggregate(tx, businessId, bookingId);
    if (!result)
      throw new ConflictException('Booking disappeared during no-show.', ErrorCodes.CONFLICT);
    return result;
  }
}
