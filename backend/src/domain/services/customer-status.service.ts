import { Inject, Injectable } from '@nestjs/common';
import { BookingState, PrismaClient } from '@prisma/client';
import { domainErrors } from '../errors/domain-errors';
import { BusinessRepository } from '../repositories/business.repository.port';
import { BookingRepository } from '../repositories/booking.repository.port';
import { BUSINESS_REPOSITORY } from '../repositories/tokens';
import { BOOKING_REPOSITORY } from '../repositories/tokens';
import { PRISMA_CLIENT } from '../../config/config.constants';

/**
 * Customer status lookup (Prompt 41 §14; REQ-053/058).
 *
 * Identified by business public slug + normalized phone (REQ-047/REQ-054),
 * newest first. The projection is deliberately safe: it carries appointment
 * times and a public-friendly status only — never an internal booking id, never
 * owner/admin metadata, never full history. Customers cannot cancel or modify
 * their bookings (REQ-058); this endpoint is read-only.
 *
 * `telegramConnected` is the connection state of the whole business + phone
 * (REQ-056: the connection is per business and per phone, not per booking).
 */
const PUBLIC_STATUS: Record<BookingState, string> = {
  PAYMENT_PENDING: 'awaiting-verification',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no-show',
};

export interface CustomerStatusEntry {
  startAt: Date;
  endAt: Date;
  status: string;
}

export interface CustomerStatusResult {
  entries: CustomerStatusEntry[];
  telegramConnected: boolean;
}

@Injectable()
export class CustomerStatusService {
  constructor(
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepo: BusinessRepository,
    @Inject(BOOKING_REPOSITORY) private readonly bookingRepo: BookingRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async getStatus(input: { businessSlug: string; phone: string }): Promise<CustomerStatusResult> {
    const biz = await this.businessRepo.findBySlug(input.businessSlug);
    if (!biz) throw domainErrors.businessNotFound();
    const bookings = await this.bookingRepo.findByPhone(biz.id, input.phone, { limit: 20 });
    const connection = await this.prisma.telegramConnection.findFirst({
      where: { businessId: biz.id, kind: 'CUSTOMER', customerPhone: input.phone, state: 'CONNECTED' },
      orderBy: { connectedAt: 'desc' },
      select: { id: true },
    });
    return {
      entries: bookings.map((b) => ({
        startAt: b.startAt,
        endAt: b.endAt,
        status: PUBLIC_STATUS[b.status],
      })),
      telegramConnected: connection !== null,
    };
  }
}