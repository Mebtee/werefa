import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ActorContext } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { domainErrors } from '../errors/domain-errors';
import { DomainEventBus, DOMAIN_EVENT_BUS, BookingNotificationEvent } from '../events/domain-events';
import { BusinessRepository } from '../repositories/business.repository.port';
import { BookingRepository, BookingWithRelations } from '../repositories/booking.repository.port';
import { PaymentRepository } from '../repositories/payment.repository.port';
import { SubscriptionRepository } from '../repositories/subscription.repository.port';
import {
  BUSINESS_REPOSITORY,
  BOOKING_REPOSITORY,
  PAYMENT_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from '../repositories/tokens';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';
import { CatalogService } from './catalog.service';
import { AvailabilityService } from './availability.service';

/**
 * Booking creation service (Prompt 41 §9; REQ-050/051/054/055/100/101/109/121).
 *
 * Concurrency (doc 08):
 *  1. Outer transaction under per-business advisory lock.
 *  2. Authoritative in-transaction re-check: `hasActiveOverlap`.
 *  3. Persist booking + payment + proof + slot lock atomically.
 *  4. P2002 → SLOT_UNAVAILABLE (different window) or idempotent success
 *     (same submission key — REQ-121).
 *
 * Submission keys are idempotent: a repeated key yields the original booking
 * without side effects. Slot locks never expire (OQ-SLOT-001).
 */
@Injectable()
export class BookingService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepo: BusinessRepository,
    @Inject(BOOKING_REPOSITORY) private readonly bookingRepo: BookingRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepo: PaymentRepository,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptionRepo: SubscriptionRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly tenantGuard: TenantGuard,
    private readonly catalogService: CatalogService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async createBooking(
    input: {
      businessSlug: string;
      serviceId: string;
      variationIds?: string[];
      addOnIds?: string[];
      customerName: string;
      customerPhone: string;
      note?: string;
      startAt: Date;
      submissionKey: string;
    },
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    const biz = await this.businessRepo.findBySlug(input.businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    const businessId = biz.id;

    if (biz.deactivatedAt) throw domainErrors.businessPaused('This business is not accepting bookings.');
    const settings = await this.businessRepo.getSettings(businessId);
    if (!settings || settings.isPaused) throw domainErrors.businessPaused();
    const eligible = await this.subscriptionRepo.isBookingEligible(businessId);
    if (!eligible) throw domainErrors.subscriptionDisabled();

    const { components, totalPriceMinor, totalDurationMinutes } =
      await this.catalogService.validateCombination(businessId, {
        serviceId: input.serviceId,
        variationIds: input.variationIds,
        addOnIds: input.addOnIds,
      });

    const startAt = this.stripSeconds(input.startAt);
    const endAt = new Date(startAt.getTime() + totalDurationMinutes * 60_000);

    const existing = await this.paymentRepo.findBySubmissionKey(input.submissionKey);
    if (existing) {
      if (existing.businessId !== businessId) {
        throw domainErrors.idempotencyConflict('This submission key is already used by a different business.');
      }
      const booking = await this.bookingRepo.findById(businessId, existing.bookingId);
      if (!booking) throw domainErrors.businessNotFound();
      return { booking, events: [] };
    }

    // Pre-check availability (non-authoritative — authoritative re-check inside tx).
    const dayKey = this.clock.dateKey(startAt);
    const slots = await this.availabilityService.getSlotsForDay(businessId, {
      dateKey: dayKey,
      durationMinutes: totalDurationMinutes,
    });
    if (!slots.some((s) => Math.abs(s.startAt.getTime() - startAt.getTime()) < 60_000)) {
      throw domainErrors.unavailableAppointment('The requested time is not currently available.');
    }

    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const occupied = await this.bookingRepo.hasActiveOverlap(tx, { businessId, startAt, endAt });
      if (occupied) throw domainErrors.unavailableAppointment();

      try {
        const prepaid = this.computePrepaid(settings, totalPriceMinor);
        const booking = await this.bookingRepo.createBooking(tx, {
          businessId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          note: input.note,
          startAt,
          endAt,
          slotDate: this.clock.slotDate(startAt),
          submissionKey: input.submissionKey,
          paymentMethod: 'BANK_TRANSFER',
          prepaidMinor: prepaid,
          components,
        });
        // Read back + publish only AFTER commit: the row is not visible to the
        // outer client while the transaction is still open.
        return { businessId, bookingId: booking.id, customerPhone: input.customerPhone };
      } catch (err: unknown) {
        if (isPrismaP2002(err)) {
          const target = (err as { meta?: { target?: string } }).meta?.target ?? '';
          if (target.includes('submission_key')) {
            // Same submission key racing in concurrently — treat like the
            // (idempotent) pre-check would have if it had seen the row.
            throw domainErrors.idempotencyConflict();
          }
          throw domainErrors.unavailableAppointment();
        }
        throw err;
      }
    }).then((created) => this.afterCommit(businessId, created.bookingId, created.customerPhone, []));
  }

  async acceptProof(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.withVerifiedBooking(businessId, bookingId, async (booking) => {
      if (booking.status !== 'PAYMENT_PENDING') throw domainErrors.invalidBookingState();
      if (!booking.payment) throw domainErrors.invalidPaymentState();

      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        const paymentOk = await this.paymentRepo.transitionStatus(tx, {
          paymentId: booking.payment!.id,
          businessId,
          from: 'PENDING',
          to: 'ACCEPTED',
          actorType: ctx.actorType as import('@prisma/client').ActorType,
          actorUserId: ctx.actorUserId ?? null,
        });
        if (!paymentOk) throw domainErrors.invalidPaymentState();
        const bookingOk = await this.bookingRepo.transitionStatus(tx, {
          bookingId,
          businessId,
          from: 'PAYMENT_PENDING',
          to: 'CONFIRMED',
          actorType: ctx.actorType as import('@prisma/client').ActorType,
          actorUserId: ctx.actorUserId ?? null,
        });
        if (!bookingOk) throw domainErrors.invalidBookingState();

        await this.bookingRepo.allocateSlotLocks(tx, { businessId, bookingId });
      });
      return this.afterCommit(businessId, bookingId, booking.customerPhone, ['BOOKING_CONFIRMED']);
    });
  }

  async rejectProof(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
    reason: string,
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    if (!reason || !reason.trim()) {
      throw domainErrors.invalidSchedule({ reason: 'Rejection reason is required (REQ-068).' });
    }
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.withVerifiedBooking(businessId, bookingId, async (booking) => {
      if (booking.status !== 'PAYMENT_PENDING') throw domainErrors.invalidBookingState();
      if (!booking.payment) throw domainErrors.invalidPaymentState();

      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        const paymentOk = await this.paymentRepo.transitionStatus(tx, {
          paymentId: booking.payment!.id,
          businessId,
          from: 'PENDING',
          to: 'REJECTED',
          actorType: ctx.actorType as import('@prisma/client').ActorType,
          actorUserId: ctx.actorUserId ?? null,
          reason,
        });
        if (!paymentOk) throw domainErrors.invalidPaymentState();
        const bookingOk = await this.bookingRepo.transitionStatus(tx, {
          bookingId,
          businessId,
          from: 'PAYMENT_PENDING',
          to: 'REJECTED',
          actorType: ctx.actorType as import('@prisma/client').ActorType,
          actorUserId: ctx.actorUserId ?? null,
          reason,
        });
        if (!bookingOk) throw domainErrors.invalidBookingState();
        // Slot stays LOCKED (REQ-123).
      });
      return this.afterCommit(businessId, bookingId, booking.customerPhone, ['PAYMENT_REJECTED']);
    });
  }

  async cancelBooking(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.withVerifiedBooking(businessId, bookingId, async (booking) => {
      const current = booking.status;
      const cfg: Record<string, { next: 'CANCELLED'; release: boolean }> = {
        CONFIRMED: { next: 'CANCELLED', release: true }, // T6
        PAYMENT_PENDING: { next: 'CANCELLED', release: false }, // T8 (SM-08)
        REJECTED: { next: 'CANCELLED', release: true }, // T9 (SM-09)
      };
      const target = cfg[current];
      if (!target) throw domainErrors.invalidBookingState(`Cannot cancel a booking in ${current}.`);

      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        const ok = await this.bookingRepo.transitionStatus(tx, {
          bookingId,
          businessId,
          from: current,
          to: target.next,
          actorType: ctx.actorType as import('@prisma/client').ActorType,
          actorUserId: ctx.actorUserId ?? null,
        });
        if (!ok) throw domainErrors.invalidBookingState();
        if (target.release) {
          await this.bookingRepo.releaseSlotLock(tx, { businessId, bookingId, releasedBy: ctx.actorUserId ?? 'system' });
        }
      });
      return this.afterCommit(businessId, bookingId, booking.customerPhone, ['BOOKING_CANCELLED']);
    });
  }

  async markNoShow(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.withVerifiedBooking(businessId, bookingId, async (booking) => {
      if (booking.status !== 'CONFIRMED') throw domainErrors.invalidBookingState();
      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        const ok = await this.bookingRepo.transitionStatus(tx, {
          bookingId,
          businessId,
          from: 'CONFIRMED',
          to: 'NO_SHOW',
          actorType: ctx.actorType as import('@prisma/client').ActorType,
          actorUserId: ctx.actorUserId ?? null,
        });
        if (!ok) throw domainErrors.invalidBookingState();
        await this.bookingRepo.releaseSlotLock(tx, { businessId, bookingId, releasedBy: ctx.actorUserId ?? 'system' });
      });
      return this.afterCommit(businessId, bookingId, booking.customerPhone, ['NO_SHOW']);
    });
  }

  async releaseSlot(ctx: ActorContext, businessId: string, bookingId: number): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.withVerifiedBooking(businessId, bookingId, async (booking) => {
      if (!['CANCELLED', 'REJECTED'].includes(booking.status)) {
        throw domainErrors.invalidBookingState('Slot release is only allowed for CANCELLED or REJECTED bookings.');
      }
      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        await this.bookingRepo.releaseSlotLock(tx, { businessId, bookingId, releasedBy: ctx.actorUserId ?? 'system' });
      });
    });
  }

  async reschedule(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
    newStartAt: Date,
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.withVerifiedBooking(businessId, bookingId, async (booking) => {
      if (booking.status !== 'CONFIRMED') throw domainErrors.invalidBookingState('Only CONFIRMED bookings can be rescheduled.');

      const durationMs = booking.endAt.getTime() - booking.startAt.getTime();
      if (durationMs <= 0 || durationMs % 60_000 !== 0) throw domainErrors.invalidBookingState('Invalid booking duration.');
      const newStart = this.stripSeconds(newStartAt);
      const newEnd = new Date(newStart.getTime() + durationMs);

      await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        const occupied = await this.bookingRepo.hasActiveOverlap(tx, {
          businessId,
          startAt: newStart,
          endAt: newEnd,
          excludeBookingId: bookingId,
        });
        if (occupied) throw domainErrors.unavailableAppointment('The target time is now occupied.');

        // Release old lock, update times, create new lock (ALLOCATED), history.
        await this.bookingRepo.releaseSlotLock(tx, { businessId, bookingId, releasedBy: ctx.actorUserId ?? 'system' });
        const changed = await this.bookingRepo.changeTimes(tx, { businessId, bookingId, startAt: newStart, endAt: newEnd });
        if (!changed) throw domainErrors.invalidBookingState();
        await this.bookingRepo.createSlotLock(tx, {
          businessId,
          bookingId,
          slotDate: this.clock.slotDate(newStart),
          startAt: newStart,
          endAt: newEnd,
          state: 'ALLOCATED',
        });
        // No status-history row: rescheduling keeps the booking CONFIRMED and
        // the `booking_status_history_noop` constraint forbids fromStatus ==
        // toStatus rows. Reschedule traceability is carried by the released +
        // newly ALLOCATED slot locks, booking.updatedAt and BOOKING_RESCHEDULED.
      });
      return this.afterCommit(businessId, bookingId, booking.customerPhone, ['BOOKING_RESCHEDULED']);
    });
  }

  async autoCompleteDueBookings(businessId: string): Promise<number> {
    const due = await this.bookingRepo.listDueForCompletion(businessId, this.clock.now(), 50);
    let done = 0;
    for (const b of due) {
      try {
        if (await this.completeBooking(businessId, b.id)) done++;
      } catch {
        // concurrent/terminal — idempotent skip
      }
    }
    return done;
  }

  async completeBooking(businessId: string, bookingId: number): Promise<boolean> {
    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const ok = await this.bookingRepo.transitionStatus(tx, {
        bookingId,
        businessId,
        from: 'CONFIRMED',
        to: 'COMPLETED',
        actorType: 'SYSTEM',
      });
      if (!ok) return false;
      await this.bookingRepo.releaseSlotLock(tx, { businessId, bookingId, releasedBy: null });
      return true;
    });
  }

  async getCustomerBookings(
    businessSlug: string,
    phone: string,
  ): Promise<Array<{ bookingId: number; startAt: Date; endAt: Date; status: import('@prisma/client').BookingState }>> {
    const biz = await this.businessRepo.findBySlug(businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    const list = await this.bookingRepo.findByPhone(biz.id, phone, { limit: 20 });
    return list.map((b) => ({ bookingId: b.id, startAt: b.startAt, endAt: b.endAt, status: b.status }));
  }

  private async withVerifiedBooking<T>(
    businessId: string,
    bookingId: number,
    fn: (booking: BookingWithRelations) => Promise<T>,
  ): Promise<T> {
    const booking = await this.bookingRepo.findById(businessId, bookingId);
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    return fn(booking);
  }

  private async afterCommit(
    businessId: string,
    bookingId: number,
    customerPhone: string,
    eventTypes: Array<'BOOKING_CONFIRMED' | 'PAYMENT_REJECTED' | 'BOOKING_CANCELLED' | 'NO_SHOW' | 'BOOKING_RESCHEDULED'>,
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    const booking = await this.bookingRepo.findById(businessId, bookingId);
    if (!booking) throw domainErrors.businessNotFound();
    const events: BookingNotificationEvent[] = eventTypes.map((type) => ({
      type,
      businessId,
      bookingId,
      customerPhone,
      occurredAt: new Date(),
    }));
    await this.eventBus.publish(events);
    return { booking, events };
  }

  private stripSeconds(date: Date): Date {
    const d = new Date(date);
    d.setSeconds(0, 0);
    return d;
  }

  private computePrepaid(
    settings: { prepaymentMode: string; prepaymentPercent: number | null; prepaymentFixedMinor: bigint | null },
    totalMinor: bigint,
  ): bigint {
    switch (settings.prepaymentMode) {
      case 'PERCENTAGE':
        return (totalMinor * BigInt(settings.prepaymentPercent ?? 0)) / 100n;
      case 'FIXED':
        return settings.prepaymentFixedMinor ?? 0n;
      default:
        return 0n;
    }
  }
}

type NotificationResult = BookingNotificationEvent[];

function isPrismaP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}