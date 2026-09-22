import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ActorContext } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { domainErrors } from '../errors/domain-errors';
import { DomainEventBus, DOMAIN_EVENT_BUS, BookingNotificationEvent } from '../events/domain-events';
import { BusinessRepository } from '../repositories/business.repository.port';
import { BookingRepository, BookingWithHistory, BookingWithRelations } from '../repositories/booking.repository.port';
import { PaymentRepository } from '../repositories/payment.repository.port';
import { SubscriptionRepository } from '../repositories/subscription.repository.port';
import { FileRepository } from '../repositories/file.repository.port';
import { PaymentProofStorage } from '../repositories/proof-storage.port';
import { isAllowedProofMimeType, PROOF_MAX_BYTES, sniffProof } from '../lib/proof-file';
import {
  BUSINESS_REPOSITORY,
  BOOKING_REPOSITORY,
  PAYMENT_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
  FILE_REPOSITORY,
  PROOF_STORAGE,
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
    @Inject(FILE_REPOSITORY) private readonly fileRepo: FileRepository,
    @Inject(PROOF_STORAGE) private readonly proofStorage: PaymentProofStorage,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly tenantGuard: TenantGuard,
    private readonly catalogService: CatalogService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async createBooking(
    input: {
      businessSlug: string;
      selections: { serviceId: string; variationIds?: string[]; addOnIds?: string[] }[];
      customerName: string;
      customerPhone: string;
      note?: string;
      startAt: Date;
      submissionKey: string;
      paymentMethod?: 'BANK_TRANSFER' | 'TELEBIRR_MOBILE_MONEY';
      /** Uploaded proof file (raw bytes + browser-declared MIME), validated authoritatively here. */
      proof?: { bytes: Buffer; mimeType: string } | null;
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

    // The backend — never the client — resolves every selected service against
    // the business catalog and snapshots price/duration/name (REQ-074/076).
    const { components, totalPriceMinor, totalDurationMinutes } =
      await this.catalogService.validateCombinations(businessId, input.selections);

    const startAt = this.stripSeconds(input.startAt);
    const endAt = new Date(startAt.getTime() + totalDurationMinutes * 60_000);
    const prepaid = this.computePrepaid(settings, totalPriceMinor);

    // Idempotent fast path (REQ-121): a repeated submission key returns the
    // original booking — but ONLY when the repeated request is materially the
    // same appointment (same start, same resolved component set). Reusing the
    // key for a different business or a different request is a conflict.
    const existing = await this.paymentRepo.findBySubmissionKey(input.submissionKey);
    if (existing) return this.resolveIdempotent(existing, businessId, startAt, components);

    // Proof validation happens BEFORE any availability claim is processed: a
    // missing (deposit) or invalid proof must not lock the slot (spec §31).
    if (prepaid > 0n && !input.proof) throw domainErrors.proofRequired();
    let staged: StagedProof | null = null;
    if (input.proof) {
      if (input.proof.bytes.length > PROOF_MAX_BYTES) throw domainErrors.proofFileTooLarge();
      const sniffed = sniffProof(input.proof.bytes);
      if (!sniffed || !isAllowedProofMimeType(sniffed.mimeType)) throw domainErrors.proofFileTypeInvalid();
      const stored = await this.proofStorage.store({
        businessId,
        bytes: input.proof.bytes,
        mimeType: sniffed.mimeType,
        extension: sniffed.extension,
      });
      staged = { ...stored, mimeType: sniffed.mimeType };
    }

    // Pre-check availability (non-authoritative — authoritative re-check inside tx).
    const dayKey = this.clock.dateKey(startAt);
    const slots = await this.availabilityService.getSlotsForDay(businessId, {
      dateKey: dayKey,
      durationMinutes: totalDurationMinutes,
    });
    if (!slots.some((s) => Math.abs(s.startAt.getTime() - startAt.getTime()) < 60_000)) {
      await this.discardStaged(staged);
      throw domainErrors.unavailableAppointment('The requested time is not currently available.');
    }

    let consumed = false;
    try {
      return await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
        // Re-check the key INSIDE the lock: a concurrently committed request with
        // the same key is the same appointment, so it is an idempotent success
        // here — not a slot conflict.
        const raced = await this.paymentRepo.findBySubmissionKey(input.submissionKey, tx);
        if (raced) return this.idempotentRef(raced, businessId, startAt, components);

        const occupied = await this.bookingRepo.hasActiveOverlap(tx, { businessId, startAt, endAt });
        if (occupied) throw domainErrors.unavailableAppointment();

        try {
          const fileObject = staged
            ? await this.fileRepo.create(tx, {
                businessId,
                category: 'CUSTOMER_PROOF',
                storageKey: staged.storageKey,
                mimeType: staged.mimeType,
                sizeBytes: BigInt(staged.sizeBytes),
                checksumSha256: staged.checksumSha256,
              })
            : null;
          const booking = await this.bookingRepo.createBooking(tx, {
            businessId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            note: input.note,
            startAt,
            endAt,
            slotDate: this.clock.slotDate(startAt),
            submissionKey: input.submissionKey,
            paymentMethod: input.paymentMethod ?? 'BANK_TRANSFER',
            prepaidMinor: prepaid,
            proofFileObjectId: fileObject?.id ?? null,
            components,
          });
          consumed = true;
          // Read back + publish only AFTER commit: the row is not visible to the
          // outer client while the transaction is still open.
          return { businessId, bookingId: booking.id, customerPhone: input.customerPhone };
        } catch (err: unknown) {
          if (isPrismaP2002(err)) {
            const target = (err as { meta?: { target?: string } }).meta?.target ?? '';
            if (target.includes('submission_key')) {
              // Same key committed between our in-tx read and the insert — read
              // the winner and verify idempotency before answering.
              const winner = await this.paymentRepo.findBySubmissionKey(input.submissionKey, tx);
              if (winner && winner.businessId === businessId) {
                return this.idempotentRef(winner, businessId, startAt, components);
              }
              throw domainErrors.idempotencyConflict();
            }
            throw domainErrors.unavailableAppointment();
          }
          throw err;
        }
      }).then((created) => this.afterCommit(businessId, created.bookingId, created.customerPhone, []));
    } finally {
      // If the staged proof was never linked to a committed PaymentProof row
      // (idempotent replay or any aborted claim), remove the orphaned object.
      if (staged && !consumed) {
        await this.proofStorage.delete(staged.storageKey).catch(() => undefined);
      }
    }
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

  async listForOwner(
    ctx: ActorContext,
    businessId: string,
    opts: { statusIn?: import('@prisma/client').BookingState[]; after?: Date; before?: Date; search?: string; limit?: number } = {},
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.bookingRepo.listByBusiness(businessId, { ...opts, order: 'desc' });
  }

  async getForOwner(ctx: ActorContext, businessId: string, bookingId: number): Promise<BookingWithHistory> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const booking = await this.bookingRepo.findByIdWithHistory(businessId, bookingId);
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    return booking;
  }

  /**
   * Owner proof review/download (Prompt 50, REQ-114/115/118). Tenant + booking
   * scoped, never any other-business proof. Only binary bytes + metadata are
   * returned; the storage key stays internal.
   */
  async getOwnerProofDownload(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
    proofId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; sizeBytes: bigint; proofId: string }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const booking = await this.bookingRepo.findById(businessId, bookingId);
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    const proof = await this.paymentRepo.findProofForBooking(businessId, bookingId, proofId);
    if (!proof?.file) throw domainErrors.businessNotFound('Proof not found.');
    const content = await this.proofStorage.read(proof.file.storageKey);
    if (!content) throw domainErrors.businessNotFound('Proof file is unavailable.');
    return {
      bytes: content.bytes,
      mimeType: proof.file.mimeType,
      sizeBytes: proof.file.sizeBytes,
      proofId: proof.id,
    };
  }

  /**
   * Free + fitting slots for rescheduling one booking on a date (REQ-106/089).
   * Duration comes from the booking's own snapshot and business gates are
   * skipped (same rule as the reschedule mutation), so the picker never offers
   * a slot the mutation would refuse. Slot occupancy uses the same window as
   * the mutation's in-transaction overlap re-check.
   */
  async getRescheduleAvailability(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
    dateKey: string,
  ): Promise<{ date: string; durationMinutes: number; slots: Array<{ startAt: Date; endAt: Date }> }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const booking = await this.bookingRepo.findById(businessId, bookingId);
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    const durationMs = booking.endAt.getTime() - booking.startAt.getTime();
    if (durationMs <= 0 || durationMs % 60_000 !== 0) {
      throw domainErrors.invalidBookingState('Invalid booking duration.');
    }
    const durationMinutes = Math.round(durationMs / 60_000);
    const slots = await this.availabilityService.getSlotsForDay(businessId, {
      dateKey,
      durationMinutes,
      includeBusinessGates: false,
    });
    return {
      date: dateKey,
      durationMinutes,
      slots: slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt })),
    };
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

      // Pre-check schedule fit (REQ-106/089): the target slot must actually
      // exist on the business's active schedule and fit the full duration.
      // Business gates (pause/subscription/deactivation) are intentionally
      // ignored — REQ-147 forbids only NEW bookings while paused; rescheduling
      // an existing CONFIRMED booking (REQ-105) stays permitted. The booking's
      // own current slot counts as occupied, so moving to the identical slot is
      // refused (matches the picker offering only free slots).
      const dayKey = this.clock.dateKey(newStart);
      const slots = await this.availabilityService.getSlotsForDay(businessId, {
        dateKey: dayKey,
        durationMinutes: Math.round(durationMs / 60_000),
        includeBusinessGates: false,
      });
      if (!slots.some((s) => Math.abs(s.startAt.getTime() - newStart.getTime()) < 60_000)) {
        throw domainErrors.unavailableAppointment('The requested time does not fit the current schedule.');
      }

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

  /**
   * REQ-121 (idempotency, outside the booking transaction): a found submission
   * key maps to the original booking. Cross-business reuse or a materially
   * different request is a canonical CONFLICT, never an idempotent success.
   */
  private async resolveIdempotent(
    row: { bookingId: number; businessId: string },
    businessId: string,
    startAt: Date,
    components: ComponentSnapshot[],
  ): Promise<{ booking: BookingWithRelations; events: NotificationResult }> {
    const ref = await this.idempotentRef(row, businessId, startAt, components);
    const booking = await this.bookingRepo.findById(businessId, ref.bookingId);
    if (!booking) throw domainErrors.businessNotFound();
    return { booking, events: [] };
  }

  /**
   * Verifies an already-created submission key matches the current request and
   * returns the commit-time reference (businessId/bookingId/customerPhone) so
   * the caller can reuse the original booking for the response.
   */
  private async idempotentRef(
    row: { bookingId: number; businessId: string },
    businessId: string,
    startAt: Date,
    components: ComponentSnapshot[],
  ): Promise<{ businessId: string; bookingId: number; customerPhone: string }> {
    if (row.businessId !== businessId) {
      throw domainErrors.idempotencyConflict('This submission key is already used by a different business.');
    }
    const booking = await this.bookingRepo.findById(businessId, row.bookingId);
    if (!booking) throw domainErrors.businessNotFound();
    if (this.bookingDiffers(booking, startAt, components)) {
      throw domainErrors.idempotencyConflict('This submission key was already used for a different booking request.');
    }
    return { businessId, bookingId: booking.id, customerPhone: booking.customerPhone };
  }

  /**
   * "Materially the same request" = the same appointment start AND the same
   * resolved component set in the same order (service/variation/add-on
   * snapshots, REQ-076). Names and prices are part of the snapshot, so a
   * renamed/repriced catalog entry resolves to a different signature.
   */
  private bookingDiffers(booking: BookingWithRelations, startAt: Date, components: ComponentSnapshot[]): boolean {
    if (booking.startAt.getTime() !== startAt.getTime()) return true;
    return this.componentSignature(booking.components) !== this.componentSignature(components);
  }

  private componentSignature(components: ComponentSnapshot[]): string {
    return components
      .map((c) =>
        [c.componentType, c.serviceId ?? '', c.nameSnapshot, String(c.unitPriceMinor), String(c.durationMinutes)].join('|'),
      )
      .join('\n');
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

  private async discardStaged(staged: StagedProof | null): Promise<void> {
    if (staged) {
      await this.proofStorage.delete(staged.storageKey).catch(() => undefined);
    }
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

/** Subset of a booking component (catalog snapshot or persisted row) used for idempotency comparison. */
type ComponentSnapshot = {
  serviceId: string | null;
  componentType: string;
  nameSnapshot: string;
  unitPriceMinor: bigint;
  durationMinutes: number;
};

/** Staged proof object before it is linked to a committed PaymentProof row. */
type StagedProof = { storageKey: string; checksumSha256: string; sizeBytes: number; mimeType: string };

function isPrismaP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}