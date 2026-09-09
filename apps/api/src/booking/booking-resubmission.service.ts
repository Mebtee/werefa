import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { ErrorCodes } from '@werefa/shared';
import {
  ConflictException,
  NotFoundException,
  TooManyRequestsException,
  ValidationException,
} from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext, type TenantTransaction } from '../database/tenant-executor';
import { StorageService } from '../storage/storage.service';
import { BusinessService } from '../business/business.service';
import { SecurityEventService } from '../iam/security-events.service';
import { RateLimitService } from '../iam/rate-limit.service';
import { runBookingTransaction } from './booking-lock';
import { BookingNotificationService, BOOKING_NOTIFICATION_TYPE } from './booking-notifications';
import { loadBookingAggregate } from './booking-aggregate';
import { BookingSerializer } from './booking.serializer';
import { validateProofFile } from './booking-proof';
import { InMemoryVerificationCodeChannel } from './verification-code.channel';
import type { RequestCodeInput, ResubmitInput } from './booking-input';

const CODE_TTL_MS = 15 * 60 * 1000; // REQ-109: codes expire shortly after issue
const MAX_ATTEMPTS = 5; // attempts before lockout (doc 08 §9.2)
const PURPOSE = 'BOOKING_RESUBMISSION';

export interface RequestCodeResult {
  /** Generic, enumeration-safe message: identical whether or not a code exists. */
  message: string;
  /** Exposed only when a code was actually issued; otherwise null. */
  expiresAt: Date | null;
}

/**
 * Rejected-booking resubmission security flow (T10, Domain 11 / doc 08 §9):
 *
 *  1. `requestCode(phone)` — if the phone has the most recent REJECTED booking
 *     for this business, a one-time 6-digit code is issued with a sha256 hash
 *     persisted on `resubmission_verification`. The plaintext rides the
 *     delivery channel seam (in-memory in this prompt; documented no real
 *     SMS/Telegram path yet). Response is generic so callers cannot probe
 *     whether a booking exists (REQ-109: no customer-addressable reference).
 *  2. `resubmit({phone, code, paymentMethod})` — verifies the code (single-use,
 *     expiry, attempt cap + backoff), then inside the bookingPublic +
 *     customerPhone transaction transitions REJECTED→PAYMENT_PENDING and
 *     payment REJECTED→PENDING with a NEW proof that supersedes the old
 *     (`replacedByProofId` lineage). The slot lock stays as-is (T10 keeps it).
 *
 * RLS: the UPDATEs are gated on `app.customer_phone` matching the booking's
 * customer_phone, so even with a leaked app scope a caller can only touch their
 * own phone's bookings.
 */
@Injectable()
export class BookingResubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serializer: BookingSerializer,
    private readonly notifications: BookingNotificationService,
    private readonly securityEvents: SecurityEventService,
    private readonly storage: StorageService,
    private readonly businesses: BusinessService,
    private readonly rateLimit: RateLimitService,
    private readonly channel: InMemoryVerificationCodeChannel,
  ) {}

  async requestCode(
    slug: string,
    input: RequestCodeInput,
    ip?: string,
  ): Promise<RequestCodeResult> {
    const business = await this.businesses.findBySlug(slug);
    const bucketKey = `resub:req:${business.id}:${input.phone}`;
    await this.rateLimit.check(bucketKey, 3, 10 * 60 * 1000);

    let expiresAt: Date | null = null;
    let code = '';
    await withTenantContext(
      this.prisma,
      { scope: 'PUBLIC', businessId: business.id, bookingPublic: true },
      async (tx) => {
        const booking = await tx.booking.findFirst({
          where: { businessId: business.id, customerPhone: input.phone, status: 'REJECTED' },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!booking) return;
        code = randomSixDigits();
        const row = await tx.resubmissionVerification.create({
          data: {
            bookingId: booking.id,
            businessId: business.id,
            phone: input.phone,
            codeHash: hashCode(code),
            purpose: PURPOSE,
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
            attempts: 0,
          },
        });
        expiresAt = row.expiresAt;
      },
    );

    if (code) {
      await this.channel.deliver({
        businessId: business.id,
        phone: input.phone,
        code,
        purpose: PURPOSE,
      });
    }
    await this.securityEvents.record({
      type: 'BOOKING_VERIFICATION_CODE_REQUESTED',
      businessId: business.id,
      ip,
      result: 'SUCCESS',
    });
    return {
      message:
        'If a matching rejected booking exists, a one-time verification code has been sent to that phone.',
      expiresAt,
    };
  }

  /** Verify the code for the phone + business, then perform the resubmission transaction. */
  async resubmit(
    slug: string,
    input: ResubmitInput,
    raw: { buffer: Buffer; mimetype: string; size: number } | undefined,
    ip?: string,
  ) {
    const business = await this.businesses.findBySlug(slug);
    const bucketKey = `resub:sub:${business.id}:${input.phone}`;
    await this.rateLimit.check(bucketKey, 5, 10 * 60 * 1000);

    const proof = validateProofFile(raw);
    const staged = await this.storage.put(
      business.id,
      'CUSTOMER_PROOF',
      proof.buffer,
      proof.mimetype,
    );

    const ctx = {
      scope: 'PUBLIC' as const,
      businessId: business.id,
      bookingPublic: true,
      customerPhone: input.phone,
    };
    try {
      // Phase 1 (own commit): verify + consume the code. A wrong-code result is
      // returned — NOT thrown — so the attempt increment can be committed in its
      // own transaction below (a throw would roll back the whole interactive tx,
      // which is exactly why attempts never persisted before).
      const verdict = await withTenantContext(this.prisma, ctx, (tx) =>
        this.verifyCode(tx, business.id, input),
      );
      if (verdict.status === 'wrong') {
        await withTenantContext(this.prisma, ctx, (tx) =>
          tx.resubmissionVerification.update({
            where: { id: verdict.id },
            data: { attempts: { increment: 1 } },
          }),
        );
        this.recordFailure(verdict.id);
        await this.securityEvents.record({
          type: 'BOOKING_VERIFICATION_CODE_FAILED',
          businessId: business.id,
          ip,
          result: 'FAILURE',
        });
        throw new ValidationException([{ field: 'code', message: 'Invalid or expired code.' }]);
      }
      // Phase 2: the booking transition, serialized by the business lock.
      const result = await runBookingTransaction(this.prisma, ctx, business.id, (tx) =>
        this.resubmitChain(
          tx,
          business.id,
          input,
          verdict.verificationId,
          proof.mimetype,
          proof.size,
          staged.key,
        ),
      );
      this.forgetBackoff(verdict.verificationId);
      await this.securityEvents.record({
        type: 'BOOKING_RESUBMIT',
        businessId: business.id,
        ip,
        result: 'SUCCESS',
      });
      return { booking: this.serializer.publicCreated(result.aggregate) };
    } catch (err) {
      await this.storage.delete(staged.key).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Verify the 6-digit code (single-use, expiry, attempt cap + backoff). Returns
   * a verdict instead of throwing for a code mismatch, so the caller can persist
   * the attempt in a separate committed transaction (lockout is durable). The
   * expiry/lockout validation errors still throw (nothing to persist).
   */
  private async verifyCode(
    tx: TenantTransaction,
    businessId: string,
    input: ResubmitInput,
  ): Promise<{ status: 'ok'; verificationId: string } | { status: 'wrong'; id: string }> {
    const verification = await tx.resubmissionVerification.findFirst({
      where: { businessId, phone: input.phone, purpose: PURPOSE, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification) {
      throw new ValidationException([{ field: 'code', message: 'Invalid or expired code.' }]);
    }

    const now = new Date();
    if (now.getTime() > verification.expiresAt.getTime()) {
      await this.securityEvents.record({
        type: 'BOOKING_VERIFICATION_CODE_FAILED',
        businessId,
        ip: undefined,
        result: 'FAILURE:expired',
      });
      throw new ConflictException(
        'This code has expired. Request a new one.',
        ErrorCodes.TOKEN_EXPIRED,
      );
    }
    if (verification.attempts >= MAX_ATTEMPTS) {
      await this.securityEvents.record({
        type: 'BOOKING_VERIFICATION_LOCKED',
        businessId,
        ip: undefined,
        result: 'FAILURE:locked',
      });
      throw new TooManyRequestsException(
        'Too many verification attempts for this code. Request a new code.',
      );
    }

    this.enforceBackoff(verification.id, verification.attempts);

    const givenHash = hashCode(input.code);
    const stored = Buffer.from(verification.codeHash, 'hex');
    const given = Buffer.from(givenHash, 'hex');
    const matchesCodes =
      verification.codeHash.length === givenHash.length && timingSafeEqual(stored, given);

    if (!matchesCodes) {
      return { status: 'wrong', id: verification.id };
    }

    await tx.resubmissionVerification.update({
      where: { id: verification.id },
      data: { usedAt: now },
    });
    return { status: 'ok', verificationId: verification.id };
  }

  private async resubmitChain(
    tx: TenantTransaction,
    businessId: string,
    input: ResubmitInput,
    verificationId: string,
    mime: string,
    sizeBytes: number,
    storageKey: string,
  ): Promise<{
    aggregate: NonNullable<Awaited<ReturnType<typeof loadBookingAggregate>>>;
    verificationId: string;
  }> {
    const verification = await tx.resubmissionVerification.findUnique({
      where: { id: verificationId },
    });
    if (!verification || verification.usedAt === null) {
      throw new ConflictException(
        'This code has not been verified.',
        ErrorCodes.INVALID_TRANSITION,
      );
    }

    const aggregate = await loadBookingAggregate(tx, businessId, verification.bookingId);
    if (!aggregate) throw new NotFoundException('Booking not found.');
    const { booking, payment, slotLock } = aggregate;
    const now = new Date();

    if (booking.status !== 'REJECTED') {
      throw new ConflictException(
        'This booking is no longer in a resubmittable state.',
        ErrorCodes.INVALID_TRANSITION,
      );
    }
    if (!payment || payment.status !== 'REJECTED') {
      throw new ConflictException(
        'This booking cannot be resubmitted in its current payment state.',
        ErrorCodes.INVALID_TRANSITION,
      );
    }
    if (!slotLock || slotLock.status === 'RELEASED') {
      throw new ConflictException(
        'The slot for this booking has been released and can no longer be resubmitted.',
        ErrorCodes.SLOT_UNAVAILABLE,
      );
    }
    if (
      slotLock.startAt.getTime() !== booking.startAt.getTime() ||
      slotLock.endAt.getTime() !== booking.endAt.getTime()
    ) {
      throw new ConflictException(
        'The slot held no longer matches this booking and cannot be resubmitted.',
        ErrorCodes.SLOT_UNAVAILABLE,
      );
    }

    const previousProofId = payment.proofs[0]?.id ?? null;
    await tx.paymentProof.create({
      data: {
        paymentId: payment.id,
        businessId,
        storageKey,
        mime,
        sizeBytes,
        submissionKey: randomUUID(),
        replacedByProofId: previousProofId,
      },
    });
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'PENDING' } });
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        businessId,
        fromStatus: 'REJECTED',
        toStatus: 'PENDING',
        actorType: 'SYSTEM',
        actorUserId: null,
        occurredAt: now,
      },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'PAYMENT_PENDING' } });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        businessId,
        fromStatus: 'REJECTED',
        toStatus: 'PAYMENT_PENDING',
        actorType: 'SYSTEM',
        actorUserId: null,
        reason: 'resubmission',
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
      payload: { proofId: previousProofId },
    });

    const result = await loadBookingAggregate(tx, businessId, booking.id);
    if (!result)
      throw new ConflictException('Booking disappeared during resubmission.', ErrorCodes.CONFLICT);
    return { aggregate: result, verificationId: verification.id };
  }

  // --- Verification anti-abuse: attempt-based backoff (in-memory per instance) --
  private readonly failures = new Map<string, number>();
  private readonly lastFailure = new Map<string, number>();

  private enforceBackoff(id: string, attempts: number): void {
    const consecutive = this.failures.get(id) ?? 0;
    const last = this.lastFailure.get(id);
    if (consecutive > 0 && last !== undefined) {
      const requiredMs = Math.min(consecutive * 300, 3000);
      if (Date.now() - last < requiredMs) {
        throw new TooManyRequestsException('Too many verification attempts. Try again shortly.');
      }
    }
    void attempts;
  }

  private recordFailure(id: string): void {
    this.failures.set(id, (this.failures.get(id) ?? 0) + 1);
    this.lastFailure.set(id, Date.now());
  }

  private forgetBackoff(bookingId: string): void {
    this.failures.delete(bookingId);
    this.lastFailure.delete(bookingId);
  }
}

/** 6-digit numeric code (REQ-109). */
function randomSixDigits(): string {
  return String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
}

/** sha256-carrying hash stored in `resubmission_verification.code_hash`. */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
