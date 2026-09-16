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
  ): Promise<{ bookingId: number; businessId: string; bookingStatus: string; paymentId: string } | null> {
    const proof = await this.prisma.paymentProof.findUnique({
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
    args: { paymentId: string; businessId: string; submissionKey: string },
  ): Promise<PaymentProof> {
    return tx.paymentProof.create({
      data: {
        paymentId: args.paymentId,
        businessId: args.businessId,
        submissionKey: args.submissionKey,
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