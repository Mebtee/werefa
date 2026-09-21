import { Inject, Injectable } from '@nestjs/common';
import { PaymentProof, Prisma, PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import {
  PaymentRepository,
  PaymentStatusHistoryInput,
  PaymentWithProofs,
} from './payment.repository.port';

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findBySubmissionKey(
    submissionKey: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ bookingId: number; businessId: string; bookingStatus: string; paymentId: string } | null> {
    const client = tx ?? this.prisma;
    const proof = await client.paymentProof.findUnique({
      where: { submissionKey },
      select: {
        paymentId: true,
        businessId: true,
        payment: { select: { bookingId: true, booking: { select: { status: true } } } },
      },
    });
    if (!proof) return null;
    return {
      paymentId: proof.paymentId,
      businessId: proof.businessId,
      bookingId: proof.payment.bookingId,
      bookingStatus: proof.payment.booking.status,
    };
  }

  async getByBooking(businessId: string, bookingId: number): Promise<PaymentWithProofs | null> {
    return this.prisma.payment.findFirst({
      where: { businessId, bookingId },
      include: { proofs: { orderBy: { submittedAt: 'desc' } } },
    }) as Promise<PaymentWithProofs | null>;
  }

  async transitionStatus(
    tx: Prisma.TransactionClient,
    args: {
      paymentId: string;
      businessId: string;
      from: import('@prisma/client').PaymentState;
      to: import('@prisma/client').PaymentState;
      actorType: import('@prisma/client').ActorType;
      actorUserId?: string | null;
      reason?: string | null;
    },
  ): Promise<boolean> {
    const updated = await tx.payment.updateMany({
      where: { id: args.paymentId, businessId: args.businessId, status: args.from },
      data: { status: args.to },
    });
    if (updated.count !== 1) return false;
    await this.appendStatusHistory(tx, {
      paymentId: args.paymentId,
      businessId: args.businessId,
      fromStatus: args.from,
      toStatus: args.to,
      actorType: args.actorType,
      actorUserId: args.actorUserId ?? null,
      reason: args.reason ?? null,
    });
    return true;
  }

  async addProof(
    tx: Prisma.TransactionClient,
    args: { paymentId: string; businessId: string; submissionKey: string; fileObjectId?: string | null },
  ): Promise<PaymentProof> {
    return tx.paymentProof.create({
      data: {
        paymentId: args.paymentId,
        businessId: args.businessId,
        submissionKey: args.submissionKey,
        fileObjectId: args.fileObjectId ?? null,
      },
    });
  }

  async markProofReplaced(
    tx: Prisma.TransactionClient,
    args: { proofId: string; replacedByProofId: string },
  ): Promise<void> {
    await tx.paymentProof.update({
      where: { id: args.proofId },
      data: { replacedByProofId: args.replacedByProofId },
    });
  }

  async findProofForBooking(
    businessId: string,
    bookingId: number,
    proofId: string,
  ): Promise<{
    id: string;
    submittedAt: Date;
    replacedByProofId: string | null;
    file: { mimeType: string; sizeBytes: bigint; storageKey: string } | null;
  } | null> {
    const proof = await this.prisma.paymentProof.findFirst({
      where: { id: proofId, businessId, payment: { bookingId } },
    });
    if (!proof) return null;
    let file: { mimeType: string; sizeBytes: bigint; storageKey: string } | null = null;
    if (proof.fileObjectId) {
      const fileObject = await this.prisma.fileObject.findUnique({
        where: { id: proof.fileObjectId },
        select: { mimeType: true, sizeBytes: true, storageKey: true },
      });
      if (fileObject) {
        file = {
          mimeType: fileObject.mimeType,
          sizeBytes: fileObject.sizeBytes,
          storageKey: fileObject.storageKey,
        };
      }
    }
    return {
      id: proof.id,
      submittedAt: proof.submittedAt,
      replacedByProofId: proof.replacedByProofId,
      file,
    };
  }

  async appendStatusHistory(tx: Prisma.TransactionClient, args: PaymentStatusHistoryInput): Promise<void> {
    await tx.paymentStatusHistory.create({
      data: {
        paymentId: args.paymentId,
        businessId: args.businessId,
        fromStatus: args.fromStatus,
        toStatus: args.toStatus,
        actorType: args.actorType,
        actorUserId: args.actorUserId ?? null,
        reason: args.reason ?? null,
      },
    });
  }
}