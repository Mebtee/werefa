import { Inject, Injectable } from '@nestjs/common';
import { ActorType, BookingState, PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import {
  BookingHistoryQuery,
  BookingHistoryRow,
  sortBookingHistory,
} from '../reports/booking-history.report';
import { ScheduleHistoryRow } from '../reports/schedule-history.report';

/** REQ-186: default report window = the most recent 30 days. */
const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BookingHistoryResult {
  rows: BookingHistoryRow[];
  total: number;
  from: Date;
  to: Date;
}

export interface ScheduleHistoryResult {
  rows: ScheduleHistoryRow[];
  from: Date;
  to: Date;
}

/**
 * Reporting reads (Prompt 59; REQ-170 … REQ-190).
 *
 * Read-only projections over the existing canonical history tables
 * (`booking_status_history`, `schedule_version`). Authorization/scope is
 * resolved by the caller (Super Admin platform-wide or one business; owner own
 * business) BEFORE this service runs; the service never widens the scope it is
 * given and never mutates history (REQ-166…169, REQ-173).
 *
 * The default range is derived from the injected global clock (REQ-186), never
 * the server's local timezone.
 */
@Injectable()
export class ReportingService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
  ) {}

  private window(from?: Date, to?: Date): { from: Date; to: Date } {
    const end = to ?? this.clock.now();
    const start = from ?? new Date(end.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);
    return { from: start, to: end };
  }

  /**
   * Full booking status history (REQ-177), with canonical filters (REQ-184),
   * AND-across-categories / OR-within-category semantics (REQ-185), the
   * stateless 30-day default window (REQ-186) and deterministic sorting
   * (REQ-187…190). `businessId` absent = all businesses (REQ-180).
   */
  async bookingHistory(query: BookingHistoryQuery): Promise<BookingHistoryResult> {
    const { from, to } = this.window(query.from, query.to);
    const statuses = query.statuses?.length ? query.statuses : undefined;
    const actorTypes = query.actorTypes?.length ? query.actorTypes : undefined;

    const where = {
      occurredAt: { gte: from, lte: to },
      ...(query.businessId ? { businessId: query.businessId } : {}),
      ...(actorTypes ? { actorType: { in: actorTypes as ActorType[] } } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      // Status category: OR within the category (matches either side of the change).
      ...(statuses ? { OR: [{ fromStatus: { in: statuses as BookingState[] } }, { toStatus: { in: statuses as BookingState[] } }] } : {}),
    };

    const records = await this.prisma.bookingStatusHistory.findMany({
      where,
      include: { booking: { select: { customerName: true } }, business: { select: { name: true } } },
    });

    const rows: BookingHistoryRow[] = records.map((record) => ({
      occurredAt: record.occurredAt,
      bookingId: record.bookingId,
      customerName: record.booking.customerName,
      businessName: record.business?.name ?? '',
      fromStatus: record.fromStatus,
      toStatus: record.toStatus,
      actorType: record.actorType,
    }));

    const sorted = sortBookingHistory(rows, query.sortBy ?? 'date', query.sortDirection ?? 'desc');
    const total = sorted.length;
    const offset = Math.max(0, query.offset ?? 0);
    const paged = query.limit === undefined ? sorted.slice(offset) : sorted.slice(offset, offset + query.limit);
    return { rows: paged, total, from, to };
  }

  /**
   * Schedule-history rows for one business (REQ-170/171/172). Versions are
   * returned oldest-first; the caller applies the requested start/end range.
   * No actor/change/reason is selected (REQ-172).
   */
  async scheduleHistory(businessId: string, range: { from?: Date; to?: Date } = {}): Promise<ScheduleHistoryResult> {
    const { from, to } = this.window(range.from, range.to);
    const versions = await this.prisma.scheduleVersion.findMany({
      where: { businessId, createdAt: { gte: from, lte: to } },
      orderBy: { versionNo: 'asc' },
      select: { versionNo: true, createdAt: true, appliedAt: true, replacedAt: true },
    });
    const rows: ScheduleHistoryRow[] = versions.map((v) => ({
      versionNo: v.versionNo,
      createdAt: v.createdAt,
      appliedAt: v.appliedAt,
      replacedAt: v.replacedAt,
    }));
    return { rows, from, to };
  }
}
