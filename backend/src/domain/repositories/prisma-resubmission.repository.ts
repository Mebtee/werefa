import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, ResubmissionVerification } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ResubmissionVerificationRepository } from './resubmission.repository.port';

@Injectable()
export class PrismaResubmissionVerificationRepository implements ResubmissionVerificationRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(
    tx: Prisma.TransactionClient,
    args: {
      bookingId: number;
      businessId: string;
      phone: string;
      codeHash: string;
      purpose: string;
      expiresAt: Date;
    },
  ): Promise<ResubmissionVerification> {
    return tx.resubmissionVerification.create({
      data: {
        bookingId: args.bookingId,
        businessId: args.businessId,
        phone: args.phone,
        codeHash: args.codeHash,
        purpose: args.purpose,
        expiresAt: args.expiresAt,
        attempts: 0,
      },
    });
  }

  async findActiveByBookingAndPhone(
    businessId: string,
    bookingId: number,
    phone: string,
    purpose: string,
  ): Promise<ResubmissionVerification | null> {
    return this.prisma.resubmissionVerification.findFirst({
      where: { businessId, bookingId, phone, purpose, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async registerAttempt(id: string): Promise<void> {
    await this.prisma.resubmissionVerification.updateMany({
      where: { id, usedAt: null },
      data: { attempts: { increment: 1 } },
    });
  }

  async markUsed(tx: Prisma.TransactionClient, args: { id: string; businessId: string }): Promise<boolean> {
    const updated = await tx.resubmissionVerification.updateMany({
      where: { id: args.id, businessId: args.businessId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return updated.count === 1;
  }
}