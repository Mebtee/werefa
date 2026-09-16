import { Prisma, ResubmissionVerification } from '@prisma/client';

export interface ResubmissionVerificationRepository {
  create(
    tx: Prisma.TransactionClient,
    args: {
      bookingId: number;
      businessId: string;
      phone: string;
      codeHash: string;
      purpose: string;
      expiresAt: Date;
    },
  ): Promise<ResubmissionVerification>;
  findActiveByBookingAndPhone(
    businessId: string,
    bookingId: number,
    phone: string,
    purpose: string,
  ): Promise<ResubmissionVerification | null>;
  /** Atomically increment attempts (outside advisory-lock tx; counter-only, idempotent). */
  registerAttempt(id: string): Promise<void>;
  /** Set usedAt (guarded: only when not yet used). */
  markUsed(tx: Prisma.TransactionClient, args: { id: string; businessId: string }): Promise<boolean>;
}