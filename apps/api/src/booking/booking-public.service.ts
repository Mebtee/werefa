import { Injectable } from '@nestjs/common';
import { ErrorCodes } from '@werefa/shared';
import { ConflictException, NotFoundException } from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext, type TenantTransaction } from '../database/tenant-executor';
import { StorageService } from '../storage/storage.service';
import { BusinessService } from '../business/business.service';
import { SubscriptionAvailabilityService } from '../subscription/subscription-availability.service';
import { SecurityEventService } from '../iam/security-events.service';
import { runBookingTransaction, isUniqueViolation } from './booking-lock';
import { BookingAvailabilityService } from './booking-availability';
import { ScheduleAvailabilityService } from '../schedule/schedule-availability.service';
import { BookingPricingService } from './booking-pricing';
import { BookingNotificationService, BOOKING_NOTIFICATION_TYPE } from './booking-notifications';
import { loadBookingAggregate } from './booking-aggregate';
import { BookingSerializer } from './booking.serializer';
import { validateProofFile } from './booking-proof';
import type { AvailabilityInput, CreateBookingInput } from './booking-input';

export type MultiPartProof = { buffer: Buffer; mimetype: string; size: number };

/**
 * Public booking flow (Prompt 11, Domain 5 / REQ-070… class of requirements):
 * availability pre-check + booking creation with an authoritative in-lock
 * re-check (doc 08 §3). Submission is idempotent via `submissionKey`
 * (REQ-095/096) and serialized by the per-business advisory lock.
 *
 * The whole mutation runs with `app.scope='PUBLIC'`, `app.booking_public='1'`
 * and `app.business_id=<business>` so RLS admits ONLY booking-domain inserts for
 * THAT business — an anonymous caller cannot point writes at another tenant.
 */
@Injectable()
export class BookingPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serializer: BookingSerializer,
    private readonly availabilityService: BookingAvailabilityService,
    private readonly pricing: BookingPricingService,
    private readonly notifications: BookingNotificationService,
    private readonly securityEvents: SecurityEventService,
    private readonly storage: StorageService,
    private readonly businesses: BusinessService,
    private readonly subscriptions: SubscriptionAvailabilityService,
    private readonly scheduleWindow: ScheduleAvailabilityService,
  ) {}

  /** Live availability for a start time + service combination (no reservation). */
  async checkAvailability(slug: string, input: AvailabilityInput) {
    const business = await this.businesses.findBySlug(slug);
    this.assertCanBook(business);
    const decision = await this.availabilityFor(business.id, input.startAt, input.services);
    return this.serializer.availability(decision);
  }

  /**
   * Create a booking from the public form (T1). Replays return the already
   * created booking (HTTP 200, `created:false`).
   */
  async create(slug: string, input: CreateBookingInput, raw: MultiPartProof | undefined) {
    const business = await this.businesses.findBySlug(slug);
    this.assertCanBook(business);
    const proof = validateProofFile(raw);
    const staged = await this.storage.put(
      business.id,
      'CUSTOMER_PROOF',
      proof.buffer,
      proof.mimetype,
    );

    const ctx = { scope: 'PUBLIC' as const, businessId: business.id, bookingPublic: true };
    try {
      const outcome = await runBookingTransaction(this.prisma, ctx, business.id, (tx) =>
        this.createChain(tx, business.id, input, proof.mimetype, proof.size, staged.key),
      );
      await this.securityEvents.record({
        type: 'BOOKING_CREATE',
        businessId: business.id,
        result: 'SUCCESS',
      });
      return {
        created: outcome.created,
        booking: this.serializer.publicCreated(outcome.aggregate),
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const replayed = await this.replayByIdempotencyKey(business.id, input.submissionKey);
        if (replayed) {
          return {
            created: false,
            booking: this.serializer.publicCreated(replayed),
          };
        }
      }
      await this.storage.delete(staged.key).catch(() => undefined);
      throw err;
    }
  }

  private async availabilityFor(
    businessId: string,
    startAt: Date,
    services: AvailabilityInput['services'],
  ) {
    return withTenantContext(
      this.prisma,
      { scope: 'PUBLIC', businessId, bookingPublic: true },
      async (tx) => {
        const combo = await this.pricing.resolveCombination(tx, businessId, services);
        const endAt = new Date(startAt.getTime() + combo.totalDurationMinutes * 60_000);
        const [slotFree, window] = await Promise.all([
          this.availabilityService.isSlotAvailable(tx, { businessId, startAt, endAt }),
          this.scheduleWindow.windowOk(tx, businessId, startAt, endAt),
        ]);
        return { available: slotFree && window.ok, startAt, endAt, ...combo };
      },
    );
  }

  private async createChain(
    tx: TenantTransaction,
    businessId: string,
    input: CreateBookingInput,
    mime: string,
    sizeBytes: number,
    storageKey: string,
  ): Promise<{
    created: boolean;
    aggregate: NonNullable<Awaited<ReturnType<typeof loadBookingAggregate>>>;
  }> {
    const existing = await tx.paymentProof.findUnique({
      where: { submissionKey: input.submissionKey },
    });
    if (existing) {
      const payment = await tx.payment.findUnique({ where: { id: existing.paymentId } });
      const aggregate = payment
        ? await loadBookingAggregate(tx, payment.businessId, payment.bookingId)
        : null;
      if (aggregate) return { created: false, aggregate };
    }

    const combo = await this.pricing.resolveCombination(tx, businessId, input.services);
    const startAt = input.startAt;
    const endAt = new Date(startAt.getTime() + combo.totalDurationMinutes * 60_000);
    await this.scheduleWindow.assertWindowOk(tx, businessId, startAt, endAt);
    await this.availabilityService.requireSlotAvailable(tx, { businessId, startAt, endAt });

    const now = new Date();
    const booking = await tx.booking.create({
      data: {
        businessId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        note: input.note,
        startAt,
        endAt,
        slotDate: BookingAvailabilityService.slotDateOf(startAt),
        status: 'PAYMENT_PENDING',
        createdAt: now,
        updatedAt: now,
      },
    });
    const payment = await tx.payment.create({
      data: {
        businessId,
        bookingId: booking.id,
        status: 'PENDING',
        method: input.paymentMethod,
        prepaidMinor: 0n,
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.slotLock.create({
      data: {
        businessId,
        bookingId: booking.id,
        slotDate: BookingAvailabilityService.slotDateOf(startAt),
        startAt,
        endAt,
        status: 'LOCKED',
      },
    });
    const proof = await tx.paymentProof.create({
      data: {
        paymentId: payment.id,
        businessId,
        storageKey,
        mime,
        sizeBytes,
        submissionKey: input.submissionKey,
      },
    });
    for (const line of combo.lines) {
      await tx.bookingServiceItem.create({
        data: {
          bookingId: booking.id,
          businessId,
          serviceId: line.serviceId,
          nameSnapshot: line.nameSnapshot,
          unitPriceMinor: line.unitPriceMinor,
          durationMinutes: line.durationMinutes,
        },
      });
    }
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: 'PAYMENT_PENDING',
        toStatus: 'PAYMENT_PENDING',
        actorType: 'SYSTEM',
        actorUserId: null,
        reason: 'Booking created',
        occurredAt: now,
      },
    });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        businessId,
        fromStatus: 'PENDING',
        toStatus: 'PENDING',
        actorType: 'SYSTEM',
        actorUserId: null,
        occurredAt: now,
      },
    });
    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.proofReceived,
      payload: {},
    });
    await this.notifications.enqueue(tx, {
      businessId,
      bookingId: booking.id,
      type: BOOKING_NOTIFICATION_TYPE.newProofOwner,
      payload: { proofId: proof.id },
    });

    const aggregate = await loadBookingAggregate(tx, businessId, booking.id);
    if (!aggregate)
      throw new ConflictException(
        'Booking could not be loaded after creation.',
        ErrorCodes.CONFLICT,
      );
    return { created: true, aggregate };
  }

  private async replayByIdempotencyKey(businessId: string, submissionKey: string) {
    return withTenantContext(
      this.prisma,
      { scope: 'PUBLIC', businessId, bookingPublic: true },
      async (tx) => {
        const row = await tx.paymentProof.findUnique({
          where: { submissionKey },
          select: { paymentId: true },
        });
        if (!row) return null;
        const payment = await tx.payment.findUnique({
          where: { id: row.paymentId },
          select: { businessId: true, bookingId: true },
        });
        if (!payment || payment.businessId !== businessId) return null;
        return loadBookingAggregate(tx, businessId, payment.bookingId);
      },
    );
  }

  private assertCanBook(business: import('@prisma/client').Business): void {
    if (business.deactivatedAt !== null) {
      throw new NotFoundException('This business page no longer exists.');
    }
    if (business.isPaused) {
      throw new ConflictException(
        business.pausedUntil
          ? `This business is paused until ${business.pausedUntil.toISOString()}.`
          : 'This business is currently paused.',
        ErrorCodes.BUSINESS_PAUSED,
      );
    }
  }
}
