import { ActorType, PaymentProof, PaymentState, Prisma } from '@prisma/client';

export interface PaymentWithProofs {
  id: string;
  bookingId: number;
  businessId: string;
  status: PaymentState;
  proofs: PaymentProof[];
}

export interface PaymentStatusHistoryInput {
  paymentId: string;
  businessId: string;
  fromStatus: PaymentState | null;
  toStatus: PaymentState;
  actorType: ActorType;
  actorUserId?: string | null;
  reason?: string | null;
}

export interface PaymentRepository {
  /**
   * Idempotent lookup. Returns the booking id + business id + booking status
   * + payment id for the proof, so the caller can map to an idempotent success
   * response. Pass `tx` to read inside the booking transaction (the concurrent
   * same-key race is then resolved against the already-committed row instead of
   * surfacing as a slot conflict).
   */
  findBySubmissionKey(
    submissionKey: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ bookingId: number; businessId: string; bookingStatus: string; paymentId: string } | null>;
  getByBooking(businessId: string, bookingId: number): Promise<PaymentWithProofs | null>;
  transitionStatus(
    tx: Prisma.TransactionClient,
    args: {
      paymentId: string;
      businessId: string;
      from: PaymentState;
      to: PaymentState;
      actorType: ActorType;
      actorUserId?: string | null;
      reason?: string | null;
    },
  ): Promise<boolean>;
  addProof(
    tx: Prisma.TransactionClient,
    args: { paymentId: string; businessId: string; submissionKey: string; fileObjectId?: string | null },
  ): Promise<PaymentProof>;
  markProofReplaced(
    tx: Prisma.TransactionClient,
    args: { proofId: string; replacedByProofId: string },
  ): Promise<void>;
  /** Tenant + booking-scoped proof lookup with its file metadata (owner proof review). */
  findProofForBooking(
    businessId: string,
    bookingId: number,
    proofId: string,
  ): Promise<{
    id: string;
    submittedAt: Date;
    replacedByProofId: string | null;
    file: { mimeType: string; sizeBytes: bigint; storageKey: string } | null;
  } | null>;
  appendStatusHistory(tx: Prisma.TransactionClient, args: PaymentStatusHistoryInput): Promise<void>;
}