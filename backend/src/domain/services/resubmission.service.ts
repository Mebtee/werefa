import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { domainErrors } from '../errors/domain-errors';
import { DomainEventBus, DOMAIN_EVENT_BUS, BookingNotificationEvent } from '../events/domain-events';
import { BusinessRepository } from '../repositories/business.repository.port';
import { BookingRepository, BookingWithRelations } from '../repositories/booking.repository.port';
import { PaymentRepository } from '../repositories/payment.repository.port';
import { ResubmissionVerificationRepository } from '../repositories/resubmission.repository.port';
import { FileRepository } from '../repositories/file.repository.port';
import { PaymentProofStorage } from '../repositories/proof-storage.port';
import { isAllowedProofMimeType, PROOF_MAX_BYTES, sniffProof } from '../lib/proof-file';
import {
  BUSINESS_REPOSITORY,
  BOOKING_REPOSITORY,
  PAYMENT_REPOSITORY,
  RESUBMISSION_REPOSITORY,
  FILE_REPOSITORY,
  PROOF_STORAGE,
} from '../repositories/tokens';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';

const PURPOSE = 'RESUBMIT_PROOF';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ACTIVE_CODES = 5;

/**
 * Rejected-booking resubmission workflow (Prompt 41 §10; doc 08 §9, REQ-230;
 * SM-09 option B / T10).
 *
 * A rejected booking can only be resubmitted with a one-time, expiring,
 * phone-scoped verification code. Codes are stored hashed (single-use), never
 * plaintext. Attempts are capped per code; expired/used codes are rejected with
 * the standard taxonomy. Every code request, failure and resubmission is
 * recorded in security_event. The new proof replaces the old (lineage keeps the
 * submission history) while the slot stays LOCKED (REQ-123).
 */
@Injectable()
export class ResubmissionService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepo: BusinessRepository,
    @Inject(BOOKING_REPOSITORY) private readonly bookingRepo: BookingRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepo: PaymentRepository,
    @Inject(RESUBMISSION_REPOSITORY) private readonly verificationRepo: ResubmissionVerificationRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepo: FileRepository,
    @Inject(PROOF_STORAGE) private readonly proofStorage: PaymentProofStorage,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
  ) {}

  async requestCode(
    input: { businessSlug: string; phone: string; bookingId: number },
  ): Promise<{ verificationId: string; expiresAt: Date }> {
    const biz = await this.businessRepo.findBySlug(input.businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    const booking = await this.bookingRepo.findById(biz.id, input.bookingId);
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    if (booking.customerPhone !== input.phone) throw domainErrors.businessNotFound('Booking not found.');
    if (booking.status !== 'REJECTED') {
      throw domainErrors.invalidLifecycleTransition('A verification code can only be requested for a rejected booking.');
    }

    const activeCount = await this.prisma.resubmissionVerification.count({
      where: { businessId: biz.id, bookingId: booking.id, purpose: PURPOSE, usedAt: null, expiresAt: { gt: this.clock.now() } },
    });
    if (activeCount >= MAX_ACTIVE_CODES) {
      throw domainErrors.rateLimited('Too many verification codes requested for this booking.');
    }

    const code = this.generateCode();
    const expiresAt = new Date(this.clock.now().getTime() + CODE_TTL_MS);
    const verification = await this.verificationRepo.create(this.prisma as never as import('@prisma/client').Prisma.TransactionClient, {
      bookingId: booking.id,
      businessId: biz.id,
      phone: input.phone,
      codeHash: hashCode(code),
      purpose: PURPOSE,
      expiresAt,
    });
    await this.securityEvent(biz.id, 'RESUBMISSION_CODE_REQUEST', 'OK');

    // NOTE (Prompt 41 §16): code delivery (Telegram/email) is out of scope.
    // The code itself is never returned or logged; a delivery adapter plugs in here.
    return { verificationId: verification.id, expiresAt };
  }

  /**
   * Customer-scoped code request (Prompt 42 §15, REQ-109 end).
   *
   * Customers carry NO booking reference (REQ-109); the target booking is the
   * most recent booking for the given phone whose disposition is "rejected",
   * so the code is unambiguous without leaking an internal booking id.
   */
  async requestCodeForCustomer(input: { businessSlug: string; phone: string }): Promise<{ verificationId: string; expiresAt: Date }> {
    const biz = await this.businessRepo.findBySlug(input.businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    const booking = await this.latestRejected(biz.id, input.phone);
    return this.requestCode({ businessSlug: input.businessSlug, phone: input.phone, bookingId: booking.id });
  }

  async resubmitForCustomer(
    input: {
      businessSlug: string;
      phone: string;
      code: string;
      submissionKey: string;
      proof?: { bytes: Buffer; mimeType: string } | null;
    },
  ): Promise<{ booking: BookingWithRelations; events: BookingNotificationEvent[] }> {
    const biz = await this.businessRepo.findBySlug(input.businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    return this.resubmit({
      businessSlug: input.businessSlug,
      phone: input.phone,
      bookingId: (await this.latestRejected(biz.id, input.phone)).id,
      code: input.code,
      submissionKey: input.submissionKey,
      proof: input.proof,
    });
  }

  private async latestRejected(businessId: string, phone: string): Promise<BookingWithRelations> {
    const list = await this.bookingRepo.findByPhone(businessId, phone, { statusIn: ['REJECTED'], limit: 1 });
    const booking = list[0];
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    return booking;
  }

  async resubmit(
    input: {
      businessSlug: string;
      phone: string;
      bookingId: number;
      code: string;
      submissionKey: string;
      proof?: { bytes: Buffer; mimeType: string } | null;
    },
  ): Promise<{ booking: BookingWithRelations; events: BookingNotificationEvent[] }> {
    const biz = await this.businessRepo.findBySlug(input.businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    const booking = await this.bookingRepo.findById(biz.id, input.bookingId);
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');
    if (booking.customerPhone !== input.phone) throw domainErrors.businessNotFound('Booking not found.');
    if (booking.status !== 'REJECTED') {
      throw domainErrors.invalidLifecycleTransition('Resubmission is only possible for a rejected booking.');
    }

    // Idempotent submission keys short-circuit before verification.
    const existing = await this.paymentRepo.findBySubmissionKey(input.submissionKey);
    if (existing) {
      if (existing.businessId !== biz.id) throw domainErrors.idempotencyConflict();
      const b = await this.bookingRepo.findById(biz.id, existing.bookingId);
      if (!b) throw domainErrors.businessNotFound();
      return { booking: b, events: [] };
    }

    const verification = await this.verificationRepo.findActiveByBookingAndPhone(
      biz.id,
      booking.id,
      input.phone,
      PURPOSE,
    );
    if (!verification) throw domainErrors.invalidResubmissionCode();

    if (verification.attempts >= MAX_ATTEMPTS) {
      await this.securityEvent(biz.id, 'RESUBMISSION_CODE_CHECK', 'RATE_LIMITED');
      throw domainErrors.rateLimited();
    }
    if (this.clock.now() > verification.expiresAt) {
      await this.securityEvent(biz.id, 'RESUBMISSION_CODE_CHECK', 'EXPIRED');
      throw domainErrors.resubmissionCodeExpired();
    }
    if (hashCode(input.code) !== verification.codeHash) {
      await this.verificationRepo.registerAttempt(verification.id);
      await this.securityEvent(biz.id, 'RESUBMISSION_CODE_CHECK', 'FAILED');
      throw domainErrors.invalidResubmissionCode();
    }

    const payment = await this.paymentRepo.getByBooking(biz.id, booking.id);
    if (!payment) throw domainErrors.invalidPaymentState('No payment record.');
    const latestProof = payment.proofs[0];
    if (!latestProof) throw domainErrors.invalidPaymentState('No payment proof record.');

    // A resubmission must carry a fresh, valid proof (REQ-230). It is validated
    // and staged BEFORE the transition transaction so a bad file never takes
    // the booking out of REJECTED.
    if (!input.proof) throw domainErrors.proofRequired('A new payment proof is required for resubmission.');
    if (input.proof.bytes.length > PROOF_MAX_BYTES) throw domainErrors.proofFileTooLarge();
    const sniffed = sniffProof(input.proof.bytes);
    if (!sniffed || !isAllowedProofMimeType(sniffed.mimeType)) throw domainErrors.proofFileTypeInvalid();
    const staged = {
      ...(await this.proofStorage.store({
        businessId: biz.id,
        bytes: input.proof.bytes,
        mimeType: sniffed.mimeType,
        extension: sniffed.extension,
      })),
      mimeType: sniffed.mimeType,
    };

    let consumed = false;
    try {
      await withBusinessAdvisoryLock(this.prisma, biz.id, async (tx) => {
        // T10: REJECTED → PAYMENT_PENDING / PENDING
        const bookingOk = await this.bookingRepo.transitionStatus(tx, {
          bookingId: booking.id,
          businessId: biz.id,
          from: 'REJECTED',
          to: 'PAYMENT_PENDING',
          actorType: 'CUSTOMER',
          reason: 'Proof resubmitted',
        });
        if (!bookingOk) throw domainErrors.invalidLifecycleTransition('Booking is no longer rejected.');

        const paymentOk = await this.paymentRepo.transitionStatus(tx, {
          paymentId: payment.id,
          businessId: biz.id,
          from: 'REJECTED',
          to: 'PENDING',
          actorType: 'CUSTOMER',
          reason: 'Proof resubmitted',
        });
        if (!paymentOk) throw domainErrors.invalidPaymentState('Payment is no longer rejected.');

        const fileObject = await this.fileRepo.create(tx, {
          businessId: biz.id,
          category: 'CUSTOMER_PROOF',
          storageKey: staged.storageKey,
          mimeType: staged.mimeType,
          sizeBytes: BigInt(staged.sizeBytes),
          checksumSha256: staged.checksumSha256,
        });
        const newProof = await this.paymentRepo.addProof(tx, {
          paymentId: payment.id,
          businessId: biz.id,
          submissionKey: input.submissionKey,
          fileObjectId: fileObject.id,
        });
        await this.paymentRepo.markProofReplaced(tx, {
          proofId: latestProof.id,
          replacedByProofId: newProof.id,
        });
        await this.verificationRepo.markUsed(tx, { id: verification.id, businessId: biz.id });
        await this.securityEvent(biz.id, 'RESUBMISSION_PROOF', 'OK');
        consumed = true;
      });
    } finally {
      if (!consumed) {
        await this.proofStorage.delete(staged.storageKey).catch(() => undefined);
      }
    }

    // Read-back + publish only AFTER the transaction commits (the outer client
    // cannot see uncommitted rows).
    const events: BookingNotificationEvent[] = [
      {
        type: 'PAYMENT_PROOF_RECEIVED',
        businessId: biz.id,
        bookingId: booking.id,
        customerPhone: input.phone,
        occurredAt: new Date(),
      },
    ];
    await this.eventBus.publish(events);

    const updated = await this.bookingRepo.findById(biz.id, booking.id);
    if (!updated) throw domainErrors.businessNotFound();
    return { booking: updated, events };
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private async securityEvent(businessId: string, type: string, result: string): Promise<void> {
    await this.prisma.securityEvent.create({
      data: { businessId, type, result },
    });
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}