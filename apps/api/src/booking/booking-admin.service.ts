import { Injectable } from '@nestjs/common';
import type { ActorType, BookingStatus, Prisma } from '@prisma/client';
import { ConflictException, NotFoundException } from '../common/http/app-error';
import { SecurityEventService } from '../iam/security-events.service';
import { assertBookingTransition } from './booking-transitions';
import { SuperAdminPrismaService } from './super-admin.prisma.service';
import { BookingSerializer, type BookingAggregate } from './booking.serializer';
import { bookingHistoryPdf, type BookingHistoryRow } from './booking-history-pdf';

export type BookingReportSortBy =
  'date' | 'bookingId' | 'customer' | 'business' | 'status' | 'actor';

export interface AdminListParams {
  businessId?: string;
  /** Multiple statuses OR within the category (REQ-185). */
  statuses?: BookingStatus[];
  /** Exact actor user id (REQ-184). */
  actorUserId?: string;
  /** Multiple actor types OR within the category (REQ-184/185). */
  actorTypes?: ActorType[];
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
  sortBy?: BookingReportSortBy;
  sortDirection?: 'asc' | 'desc';
}

/** Default 30-day reporting window (REQ-186) when no from/to is given. */
const REPORT_DEFAULT_WINDOW_DAYS = 30;

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
    const where: Prisma.BookingWhereInput = {
      ...(params.businessId ? { businessId: params.businessId } : {}),
      ...(params.statuses && params.statuses.length > 0 ? { status: { in: params.statuses } } : {}),
      ...bookingStartAtRange(params),
    };
    const [rows, total] = await Promise.all([
      this.elevated.booking.findMany({
        where,
        include: {
          serviceItems: { orderBy: { createdAt: 'asc' } },
          payment: {
            include: { rejectionEvents: { orderBy: { createdAt: 'desc' } } },
          },
          business: { select: { name: true } },
        },
        orderBy: bookingSort(params.sortBy ?? 'date', params.sortDirection ?? 'desc'),
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

  /**
   * Super Admin booking status-history report (REQ-177, REQ-175,
   * REQ-184..190). Cross-business via the elevated connection; read-only.
   * Ordered per the CONF-001 rules: the chosen column primary, Booking ID
   * secondary, date/time final where the spec requires.
   */
  async listHistory(actorId: string, params: AdminListParams) {
    const where: Prisma.BookingStatusHistoryWhereInput = {
      ...(params.businessId ? { businessId: params.businessId } : {}),
      ...(params.statuses && params.statuses.length > 0
        ? {
            OR: [{ fromStatus: { in: params.statuses } }, { toStatus: { in: params.statuses } }],
          }
        : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.actorTypes && params.actorTypes.length > 0
        ? { actorType: { in: params.actorTypes } }
        : {}),
      ...bookingStatusRange(params),
    };
    const [rows, total] = await Promise.all([
      this.elevated.bookingStatusHistory.findMany({
        where,
        include: {
          booking: { include: { business: { select: { name: true } } } },
        },
        orderBy: historySort(params.sortBy ?? 'date', params.sortDirection ?? 'desc'),
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 100),
      }),
      this.elevated.bookingStatusHistory.count({ where }),
    ]);
    await this.securityEvents.record({
      type: 'BOOKING_HISTORY_VIEW',
      userId: actorId,
      result: 'SUCCESS',
    });
    return {
      history: rows.map(historyRowDto),
      total,
    };
  }

  /**
   * Super Admin booking status-history PDF export (REQ-178..183).
   * Scope = all businesses or exactly one selected business (REQ-180/181),
   * custom date range (REQ-179). The generated PDF contains only the six
   * approved columns (REQ-182) and no reasons/notes (REQ-183).
   */
  async exportHistoryPdf(actorId: string, params: AdminListParams) {
    const where: Prisma.BookingStatusHistoryWhereInput = {
      ...(params.businessId ? { businessId: params.businessId } : {}),
      ...(params.statuses && params.statuses.length > 0
        ? {
            OR: [{ fromStatus: { in: params.statuses } }, { toStatus: { in: params.statuses } }],
          }
        : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.actorTypes && params.actorTypes.length > 0
        ? { actorType: { in: params.actorTypes } }
        : {}),
      ...bookingStatusRange(params),
    };
    const rows = await this.elevated.bookingStatusHistory.findMany({
      where,
      include: {
        booking: { include: { business: { select: { name: true } } } },
      },
      orderBy: historySort('date', 'asc'),
    });
    await this.securityEvents.record({
      type: 'BOOKING_HISTORY_EXPORT',
      userId: actorId,
      businessId: params.businessId,
      result: 'SUCCESS',
    });
    const pdf = bookingHistoryPdf({
      range: dateRangeFromParams(params),
      rows: rows.map(pdfRow),
    });
    return pdf;
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

/**
 * Default 30-day reporting window when no explicit from/to is given (REQ-186).
 * The window is anchored to "now" when the report opens; filters are stateless
 * (never remembered between sessions).
 */
function bookingStatusRange(params: AdminListParams): Prisma.BookingStatusHistoryWhereInput {
  if (params.from || params.to) return { occurredAt: boundedDate(params) };
  const from = new Date(Date.now() - REPORT_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { occurredAt: { gte: from } };
}

/** Booking surface for the current-status report (REQ-175). */
function bookingStartAtRange(params: AdminListParams): Prisma.BookingWhereInput {
  if (params.from || params.to) return { startAt: boundedDate(params) };
  const from = new Date(Date.now() - REPORT_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { startAt: { gte: from } };
}

function boundedDate(params: AdminListParams): { gte?: Date; lte?: Date } {
  return {
    ...(params.from ? { gte: params.from } : {}),
    ...(params.to ? { lte: params.to } : {}),
  };
}

function dateRangeFromParams(params: AdminListParams): { from?: Date; to?: Date } {
  const range: { from?: Date; to?: Date } = {};
  if (params.from) range.from = params.from;
  if (params.to) range.to = params.to;
  return range;
}

/**
 * CONF-001 report ordering (REQ-188/189/190): the chosen column primary,
 * Booking ID (chronological) secondary, date/time final where required.
 * Booking-ID sorting is numeric/chronological; actor A-Z is the final
 * tie-breaker for identical Booking ID + timestamp.
 */
function bookingSort(
  sortBy: BookingReportSortBy,
  direction: 'asc' | 'desc',
): Prisma.BookingOrderByWithRelationInput[] {
  const d = direction;
  switch (sortBy) {
    case 'bookingId':
      return [{ createdAt: d }, { startAt: 'asc' }];
    case 'customer':
      return [{ customerName: d }, { createdAt: 'asc' }, { startAt: 'asc' }];
    case 'business':
      return [{ business: { name: d } }, { createdAt: 'asc' }, { startAt: 'asc' }];
    case 'status':
      return [{ status: d }, { createdAt: 'asc' }, { startAt: 'asc' }];
    case 'date':
    default:
      return [{ startAt: d }, { createdAt: 'asc' }];
  }
}

function historySort(
  sortBy: BookingReportSortBy,
  direction: 'asc' | 'desc',
): Prisma.BookingStatusHistoryOrderByWithRelationInput[] {
  const d = direction;
  switch (sortBy) {
    case 'bookingId':
      // booking.created-at proxies the booking-id order (chronological)
      return [{ booking: { createdAt: d } }, { occurredAt: 'asc' }, { actorType: 'asc' }];
    case 'customer':
      return [
        { booking: { customerName: d } },
        { booking: { createdAt: 'asc' } },
        { occurredAt: 'asc' },
      ];
    case 'business':
      return [
        { booking: { business: { name: d } } },
        { booking: { createdAt: 'asc' } },
        { occurredAt: 'asc' },
      ];
    case 'status':
      return [{ toStatus: d }, { booking: { createdAt: 'asc' } }, { occurredAt: 'asc' }];
    case 'actor':
      return [
        { actorType: d },
        { actorUserId: 'asc' },
        { booking: { createdAt: 'asc' } },
        { occurredAt: 'asc' },
      ];
    case 'date':
    default:
      return [{ occurredAt: d }, { booking: { createdAt: 'asc' } }];
  }
}

/** History-row DTO for the JSON report (six approved columns, REQ-182). */
function historyRowDto(row: {
  id: string;
  bookingId: string;
  occurredAt: Date;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  actorUserId: string | null;
  booking: { customerName: string; business: { name: string } };
}): {
  id: string;
  bookingId: string;
  customerName: string;
  businessName: string;
  occurredAt: Date;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  actorUserId: string | null;
} {
  return {
    id: row.id,
    bookingId: row.bookingId,
    customerName: row.booking.customerName,
    businessName: row.booking.business.name,
    occurredAt: row.occurredAt,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
  };
}

/** History-row shape for the PDF (REQ-182/183: no reason/note anywhere). */
function pdfRow(row: {
  id: string;
  bookingId: string;
  occurredAt: Date;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  actorUserId: string | null;
  booking: { customerName: string; business: { name: string } };
}): BookingHistoryRow {
  return {
    occurredAt: row.occurredAt,
    bookingId: row.bookingId,
    customerName: row.booking.customerName,
    businessName: row.booking.business.name,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
  };
}
