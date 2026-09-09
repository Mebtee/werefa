import { Injectable } from '@nestjs/common';
import type { BookingStatus } from '@prisma/client';
import { ConflictException, NotFoundException } from '../common/http/app-error';
import { SecurityEventService } from '../iam/security-events.service';
import { assertBookingTransition } from './booking-transitions';
import { SuperAdminPrismaService } from './super-admin.prisma.service';
import { BookingSerializer, type BookingAggregate } from './booking.serializer';

export interface AdminListParams {
  businessId?: string;
  status?: BookingStatus;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

/**
 * Cross-business booking overview for Admin / Super Admin (REQ-176/177/227–230).
 *
 * - Admin (`@RolesExact(Role.Admin)` at the controller): current status only —
 *   NO status/payment history tables are queried (REQ-176: "view current
 *   booking status only (no full history)").
 * - Super Admin (`@RolesExact(Role.SuperAdmin)`): full history + notifications
 *   via `superAdminDetail`.
 *
 * Both roles read through the elevated `app_superadmin` connection, so no new
 * RLS policies are needed. Every call records a security event.
 */
@Injectable()
export class BookingAdminService {
  constructor(
    private readonly elevated: SuperAdminPrismaService,
    private readonly serializer: BookingSerializer,
    private readonly securityEvents: SecurityEventService,
  ) {}

  async listStatus(actorId: string, params: AdminListParams) {
    const where = {
      ...(params.businessId ? { businessId: params.businessId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.from || params.to
        ? {
            startAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.elevated.booking.findMany({
        where,
        include: {
          serviceItems: { orderBy: { createdAt: 'asc' } },
          payment: {
            include: { rejectionEvents: { orderBy: { createdAt: 'desc' } } },
          },
        },
        orderBy: { startAt: 'desc' },
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 100),
      }),
      this.elevated.booking.count({ where }),
    ]);
    await this.securityEvents.record({
      type: 'BOOKING_STATUS_VIEW',
      userId: actorId,
      result: 'SUCCESS',
    });
    return {
      bookings: rows.map((row) => this.serializer.adminStatus(currentAggregate(row))),
      total,
    };
  }

  /** Admin detail: current status + payment state + last rejection reason only. */
  async statusDetail(actorId: string, bookingId: string) {
    const row = await this.elevated.booking.findUnique({
      where: { id: bookingId },
      include: {
        serviceItems: { orderBy: { createdAt: 'asc' } },
        payment: { include: { rejectionEvents: { orderBy: { createdAt: 'desc' } } } },
      },
    });
    if (!row) throw new NotFoundException('Booking not found.');
    await this.securityEvents.record({
      type: 'BOOKING_STATUS_VIEW',
      userId: actorId,
      result: 'SUCCESS',
    });
    return this.serializer.adminStatus(currentAggregate(row));
  }

  /** Super Admin detail: full aggregate + notification history (REQ-177). */
  async superAdminDetail(actorId: string, bookingId: string) {
    const row = await this.elevated.booking.findUnique({
      where: { id: bookingId },
      include: {
        serviceItems: { orderBy: { createdAt: 'asc' } },
        payment: {
          include: {
            proofs: { orderBy: { submittedAt: 'desc' } },
            rejectionEvents: { orderBy: { createdAt: 'desc' } },
            statusHistory: { orderBy: { occurredAt: 'desc' } },
          },
        },
        statusHistory: { orderBy: { occurredAt: 'desc' } },
        slotLocks: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Booking not found.');
    const notifications = await this.elevated.notification.findMany({
      where: { bookingId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    await this.securityEvents.record({
      type: 'BOOKING_AUDIT_VIEW',
      userId: actorId,
      result: 'SUCCESS',
    });
    return this.serializer.superAdmin(fullAggregate(row), notifications);
  }

  /** Manual completion of a visit (REQ-229/230 contract; T4 must be allowed). */
  async confirmCompleted(actorId: string, bookingId: string, role: 'Admin' | 'SuperAdmin') {
    const probe = await this.elevated.booking.findUnique({
      where: { id: bookingId },
      select: { businessId: true },
    });
    if (!probe) throw new NotFoundException('Booking not found.');

    // Run the completion under the per-business advisory lock (same lock every
    // other slot-mutating path takes), then guard the status flip so a racing
    // cancel/reject cannot be overwritten.
    const now = new Date();
    await this.elevated.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${probe.businessId}::text))`;
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { slotLocks: { orderBy: { createdAt: 'desc' } } },
      });
      if (!booking) throw new NotFoundException('Booking not found.');
      assertBookingTransition(booking.status, 'COMPLETED');

      const updated = await tx.booking.updateMany({
        where: { id: bookingId, status: 'CONFIRMED' },
        data: { status: 'COMPLETED', updatedAt: now },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Booking could not be completed because its status changed concurrently.',
        );
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          businessId: probe.businessId,
          fromStatus: 'CONFIRMED',
          toStatus: 'COMPLETED',
          actorType: role === 'SuperAdmin' ? 'SUPER_ADMIN' : 'ADMIN',
          actorUserId: actorId,
          reason: 'visit completed',
          occurredAt: now,
        },
      });
      const activeLock = booking.slotLocks.find((lock) => lock.status !== 'RELEASED');
      if (activeLock) {
        await tx.slotLock.update({
          where: { id: activeLock.id },
          data: {
            status: 'RELEASED',
            releasedAt: now,
            releasedBy: 'ADMIN',
            releasedByUserId: actorId,
          },
        });
      }
    });
    await this.securityEvents.record({
      type: 'BOOKING_COMPLETE',
      userId: actorId,
      businessId: probe.businessId,
      result: 'SUCCESS',
    });
    return this.statusDetail(actorId, bookingId);
  }
}

/** Adapt current-status rows (serviceItems + payment w/ rejection events) to the serializer aggregate. */
function currentAggregate(row: {
  id: string;
  serviceItems: {
    id: string;
    serviceId: string | null;
    nameSnapshot: string;
    unitPriceMinor: bigint;
    durationMinutes: number;
    createdAt: Date;
    bookingId: string;
    businessId: string;
    [key: string]: unknown;
  }[];
  payment: {
    id: string;
    status: string;
    method: string;
    prepaidMinor: bigint;
    rejectionEvents: { reason: string; createdAt: Date }[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}): BookingAggregate {
  return {
    booking: {
      ...(row as unknown as BookingAggregate['booking']),
      serviceItems: row.serviceItems as unknown as BookingAggregate['booking']['serviceItems'],
    },
    payment: row.payment
      ? ({
          ...(row.payment as unknown as Omit<
            NonNullable<BookingAggregate['payment']>,
            'proofs' | 'statusHistory'
          >),
          proofs: [],
          statusHistory: [],
          rejectionEvents: row.payment.rejectionEvents,
        } as unknown as NonNullable<BookingAggregate['payment']>)
      : null,
    statusHistory: [],
    paymentStatusHistory: [],
    slotLock: null,
    scheduleExceptions: [],
  };
}

function fullAggregate(row: unknown): BookingAggregate {
  const r = row as BookingAggregate['booking'] & {
    payment:
      | (NonNullable<BookingAggregate['payment']> & {
          statusHistory: BookingAggregate['paymentStatusHistory'];
        })
      | null;
    statusHistory: BookingAggregate['statusHistory'];
    slotLocks: NonNullable<BookingAggregate['slotLock']>[];
  };
  return {
    booking: r,
    payment: r.payment,
    statusHistory: r.statusHistory,
    paymentStatusHistory: r.payment?.statusHistory ?? [],
    slotLock: r.slotLocks.find((lock) => lock.status !== 'RELEASED') ?? r.slotLocks[0] ?? null,
    scheduleExceptions:
      (r as unknown as { scheduleExceptions?: BookingAggregate['scheduleExceptions'] })
        .scheduleExceptions ?? [],
  };
}
