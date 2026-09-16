import { Inject, Injectable } from '@nestjs/common';
import { Booking, BookingState, Prisma, PrismaClient, SlotLockState } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import {
  BookingRepository,
  BookingStatusHistoryInput,
  BookingWithRelations,
  CreateBookingArgs,
  OverlapCheck,
} from './booking.repository.port';

/**
 * Prisma-backed booking repository. `createBooking` persists the whole booking
 * aggregate atomically — the exact-identity slot claim becomes unique because of
 * the partial unique index on active slot locks (doc 07 §3; REQ-121). Callers
 * drive the enclosing transaction (`tx`), so the slot lock, snapshot writes and
 * history rows commit (or roll back) together.
 *
 * `hasActiveOverlap` is the in-transaction authoritative re-check (doc 08 §4):
 * a window is occupied if any active booking row (PAYMENT_PENDING/CONFIRMED) or
 * any active slot lock (LOCKED/ALLOCATED) overlaps it.
 */
@Injectable()
export class PrismaBookingRepository implements BookingRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async createBooking(tx: Prisma.TransactionClient, args: CreateBookingArgs): Promise<Booking> {
    const booking = await tx.booking.create({
      data: {
        businessId: args.businessId,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        note: args.note ?? null,
        startAt: args.startAt,
        endAt: args.endAt,
        createdByUserId: args.createdByUserId ?? null,
        components: {
          create: args.components.map((c) => ({
            businessId: args.businessId,
            serviceId: c.serviceId,
            componentType: c.componentType,
            nameSnapshot: c.nameSnapshot,
            unitPriceMinor: c.unitPriceMinor,
            durationMinutes: c.durationMinutes,
          })),
        },
        statusHistory: {
          create: {
            businessId: args.businessId,
            fromStatus: null,
            toStatus: 'PAYMENT_PENDING',
            actorType: 'CUSTOMER',
          },
        },
        payment: {
          create: {
            businessId: args.businessId,
            status: 'PENDING',
            method: args.paymentMethod,
            prepaidMinor: args.prepaidMinor,
            proofs: {
              create: {
                businessId: args.businessId,
                submissionKey: args.submissionKey,
              },
            },
            history: {
              create: {
                businessId: args.businessId,
                fromStatus: null,
                toStatus: 'PENDING',
                actorType: 'CUSTOMER',
              },
            },
          },
        },
        slotLocks: {
          create: {
            businessId: args.businessId,
            slotDate: args.slotDate ?? this.dateOnly(args.startAt),
            startAt: args.startAt,
            endAt: args.endAt,
            state: 'LOCKED',
          },
        },
      },
    });
    return booking;
  }

  async findById(businessId: string, id: number): Promise<BookingWithRelations | null> {
    return this.prisma.booking.findFirst({
      where: { id, businessId },
      include: {
        components: true,
        payment: { select: { id: true, status: true, method: true, prepaidMinor: true } },
      },
    });
  }

  async findByPhone(
    businessId: string,
    phone: string,
    opts: { statusIn?: BookingState[]; limit?: number } = {},
  ): Promise<BookingWithRelations[]> {
    return this.prisma.booking.findMany({
      where: {
        businessId,
        customerPhone: phone,
        status: opts.statusIn ? { in: opts.statusIn } : undefined,
      },
      include: {
        components: true,
        payment: { select: { id: true, status: true, method: true, prepaidMinor: true } },
      },
      orderBy: { id: 'desc' },
      take: opts.limit,
    });
  }

  async listByBusiness(
    businessId: string,
    opts: { statusIn?: BookingState[]; after?: Date; before?: Date; limit?: number } = {},
  ): Promise<BookingWithRelations[]> {
    return this.prisma.booking.findMany({
      where: {
        businessId,
        status: opts.statusIn ? { in: opts.statusIn } : undefined,
        startAt: opts.after ? { gte: opts.after } : undefined,
        endAt: opts.before ? { lte: opts.before } : undefined,
      },
      include: {
        components: true,
        payment: { select: { id: true, status: true, method: true, prepaidMinor: true } },
      },
      orderBy: { id: 'asc' },
      take: opts.limit,
    });
  }

  async listDueForCompletion(businessId: string, upTo: Date, limit = 100): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: { businessId, status: 'CONFIRMED', endAt: { lte: upTo } },
      orderBy: { endAt: 'asc' },
      take: limit,
    });
  }

  async hasServiceFutureBookings(businessId: string, serviceId: string): Promise<boolean> {
    const count = await this.prisma.bookingComponent.count({
      where: {
        businessId,
        serviceId,
        booking: { status: { in: ['PAYMENT_PENDING', 'CONFIRMED'] } },
      },
    });
    return count > 0;
  }

  async hasActiveOverlap(tx: Prisma.TransactionClient, check: OverlapCheck): Promise<boolean> {
    const bookingHit = await tx.booking.count({
      where: {
        businessId: check.businessId,
        startAt: { lt: check.endAt },
        endAt: { gt: check.startAt },
        status: { in: ['PAYMENT_PENDING', 'CONFIRMED'] },
        id: check.excludeBookingId ? { not: check.excludeBookingId } : undefined,
      },
    });
    if (bookingHit > 0) return true;
    const lockHit = await tx.slotLock.count({
      where: {
        businessId: check.businessId,
        startAt: { lt: check.endAt },
        endAt: { gt: check.startAt },
        state: { in: ['LOCKED', 'ALLOCATED'] },
      },
    });
    return lockHit > 0;
  }

  async transitionStatus(
    tx: Prisma.TransactionClient,
    args: import('./booking.repository.port').StatusTransitionInput,
  ): Promise<boolean> {
    const updated = await tx.booking.updateMany({
      where: { id: args.bookingId, businessId: args.businessId, status: args.from },
      data: { status: args.to },
    });
    if (updated.count !== 1) return false;
    await this.appendStatusHistory(tx, {
      bookingId: args.bookingId,
      businessId: args.businessId,
      fromStatus: args.from,
      toStatus: args.to,
      actorType: args.actorType,
      actorUserId: args.actorUserId ?? null,
      reason: args.reason ?? null,
    });
    return true;
  }

  async changeTimes(
    tx: Prisma.TransactionClient,
    args: { businessId: string; bookingId: number; startAt: Date; endAt: Date },
  ): Promise<boolean> {
    const updated = await tx.booking.updateMany({
      where: { id: args.bookingId, businessId: args.businessId },
      data: { startAt: args.startAt, endAt: args.endAt },
    });
    return updated.count === 1;
  }

  async createSlotLock(
    tx: Prisma.TransactionClient,
    args: { businessId: string; bookingId: number; slotDate: Date; startAt: Date; endAt: Date; state: SlotLockState },
  ): Promise<import('@prisma/client').SlotLock> {
    return tx.slotLock.create({
      data: {
        businessId: args.businessId,
        bookingId: args.bookingId,
        slotDate: args.slotDate,
        startAt: args.startAt,
        endAt: args.endAt,
        state: args.state,
      },
    });
  }

  async releaseSlotLock(
    tx: Prisma.TransactionClient,
    args: { businessId: string; bookingId: number; releasedBy: string | null },
  ): Promise<boolean> {
    const updated = await tx.slotLock.updateMany({
      where: {
        businessId: args.businessId,
        bookingId: args.bookingId,
        state: { in: ['LOCKED', 'ALLOCATED'] },
      },
      data: { state: 'RELEASED', releasedAt: new Date(), releasedBy: args.releasedBy },
    });
    return updated.count > 0;
  }

  async allocateSlotLocks(tx: Prisma.TransactionClient, args: { businessId: string; bookingId: number }): Promise<number> {
    const updated = await tx.slotLock.updateMany({
      where: { businessId: args.businessId, bookingId: args.bookingId, state: 'LOCKED' },
      data: { state: 'ALLOCATED' },
    });
    return updated.count;
  }

  async appendStatusHistory(tx: Prisma.TransactionClient, args: BookingStatusHistoryInput): Promise<void> {
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: args.bookingId,
        businessId: args.businessId,
        fromStatus: args.fromStatus,
        toStatus: args.toStatus,
        actorType: args.actorType,
        actorUserId: args.actorUserId ?? null,
        reason: args.reason ?? null,
      },
    });
  }

  private dateOnly(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}