import { Injectable } from '@nestjs/common';
import type { BookingStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext } from '../database/tenant-executor';

/** Bookings that still occupy/claim a slot — these block service deletion (REQ-077). */
const BLOCKING_STATUSES: readonly BookingStatus[] = ['PAYMENT_PENDING', 'CONFIRMED', 'REJECTED'];

/**
 * Prompt 10 — REQ-077 deletion boundary (wired to the real booking store now).
 *
 * A service with FUTURE bookings SHALL NOT be hard-deleted (REQ-077 AC1).
 * `booking_service_item` is written as an immutable snapshot inside the booking
 * transaction (REQ-074/075/076/080), so a delete check must count the CURRENT
 * references with a start time in the future and a status that still claims the
 * slot (PAYMENT_PENDING / CONFIRMED, plus REJECTED where resubmission could
 * reactivate it). Past or terminal bookings never block deletion — that is why
 * `booking_service_item.service` is nullable + SET NULL.
 *
 * The count runs under SUPER_ADMIN scope so it stays accurate regardless of the
 * delete path's caller scope (it filters by the globally-unique service id).
 */
@Injectable()
export class FutureBookingsSeam {
  constructor(private readonly prisma: PrismaService) {}

  /** Count of future bookings referencing the service that would block removal. */
  async countFutureBookings(serviceId: string): Promise<number> {
    return withTenantContext(this.prisma, { scope: 'SUPER_ADMIN' }, (tx) =>
      tx.bookingServiceItem.count({
        where: {
          serviceId,
          booking: {
            startAt: { gt: new Date() },
            status: { in: [...BLOCKING_STATUSES] },
          },
        },
      }),
    );
  }
}
