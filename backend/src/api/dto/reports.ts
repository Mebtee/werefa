import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BOOKING_HISTORY_SORT_KEYS, BookingHistoryRow, SortDirection } from '../../domain/reports/booking-history.report';

/** BookingState values (mirrors the Prisma enum; avoids importing the client here). */
const REPORT_STATUSES = ['PAYMENT_PENDING', 'CONFIRMED', 'REJECTED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;
/** ActorType values (REQ-184 actor filter). */
const REPORT_ACTOR_TYPES = ['SYSTEM', 'CUSTOMER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'] as const;
const SORT_DIRECTIONS = ['asc', 'desc'] as const;

const commaList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;

/**
 * Booking-history report query (REQ-177/184…190).
 *
 * `status`/`actorType` are comma-separated lists (OR within a category); the
 * categories combine with AND (REQ-185). `businessId` is a single optional
 * business (all businesses when absent; no multi-select, REQ-180/181). Omitting
 * the date range uses the server-side 30-day default window (REQ-186).
 */
export class BookingHistoryReportQuery {
  @ApiPropertyOptional({ example: 'CONFIRMED,COMPLETED', description: 'Comma-separated; OR within the category.' })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @IsIn(REPORT_STATUSES, { each: true })
  status?: string[];

  @ApiPropertyOptional({ example: 'OWNER,SYSTEM', description: 'Comma-separated; OR within the category.' })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @IsIn(REPORT_ACTOR_TYPES, { each: true })
  actorType?: string[];

  @ApiPropertyOptional({ example: '11111111-1111-4111-8111-111111111111' })
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @ApiPropertyOptional({ example: '11111111-1111-4111-8111-111111111111', description: 'One business or omitted for all.' })
  @IsOptional()
  @IsUUID('4')
  businessId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'ISO date or date-time; inclusive lower bound.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'ISO date or date-time; inclusive upper bound.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: BOOKING_HISTORY_SORT_KEYS, default: 'date' })
  @IsOptional()
  @IsIn(BOOKING_HISTORY_SORT_KEYS)
  sortBy?: string;

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  sortDirection?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ example: 50, default: 50, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Schedule-history export range (REQ-171): both bounds optional (defaults to 30 days). */
export class ScheduleHistoryQuery {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'ISO date or date-time; inclusive lower bound.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'ISO date or date-time; inclusive upper bound.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** One canonical history row (REQ-182 fields; reasons/notes excluded, REQ-183). */
export class BookingHistoryRowView {
  @ApiProperty({ example: '2026-09-14T10:00:00.000Z' }) occurredAt: string;
  @ApiProperty({ example: 42 }) bookingId: number;
  @ApiProperty({ example: 'Liya Tesfaye' }) customerName: string;
  @ApiProperty({ example: 'Happy Salons 1' }) businessName: string;
  @ApiProperty({ example: 'PAYMENT_PENDING', nullable: true }) fromStatus: string | null;
  @ApiProperty({ example: 'CONFIRMED' }) toStatus: string;
  @ApiProperty({ example: 'OWNER' }) actorType: string;
}

export class BookingHistoryReportView {
  @ApiProperty({ type: [BookingHistoryRowView] }) rows: BookingHistoryRowView[];
  @ApiProperty({ example: 128 }) total: number;
  @ApiProperty({ example: '2026-08-26T00:00:00.000Z' }) from: string;
  @ApiProperty({ example: '2026-09-25T00:00:00.000Z' }) to: string;
  @ApiProperty({ example: 'date' }) sortBy: string;
  @ApiProperty({ example: 'desc' }) sortDirection: string;
}

export function bookingHistoryRowProjection(row: BookingHistoryRow): BookingHistoryRowView {
  return {
    occurredAt: row.occurredAt.toISOString(),
    bookingId: row.bookingId,
    customerName: row.customerName,
    businessName: row.businessName,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorType: row.actorType,
  };
}

/** Dated, non-secret export filenames (no tokens/ids beyond the report date). */
export function bookingHistoryFileName(clockDateKey: string): string {
  return `booking-history-${clockDateKey}.pdf`;
}

export function scheduleHistoryFileName(clockDateKey: string): string {
  return `schedule-history-${clockDateKey}.pdf`;
}

export function sortDirectionOf(value: string | undefined): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}
