import { Injectable } from '@nestjs/common';
import type { ScheduleVersionRow } from './schedule-availability.service';

export interface WorkingPeriodDto {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

export interface SpecialDatePeriodDto {
  startMinutes: number;
  endMinutes: number;
}

export interface SpecialDateDto {
  id: string;
  calendarDate: string;
  isClosed: boolean;
  periods: SpecialDatePeriodDto[];
}

export interface BlockedPeriodDto {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface ScheduleVersionDto {
  id: string;
  status: string;
  actorType: string;
  actorUserId: string | null;
  reason: string | null;
  bookingIntervalMinutes: number;
  createdAt: string;
  updatedAt: string;
  workingPeriods: WorkingPeriodDto[];
  specialDates: SpecialDateDto[];
  blockedPeriods: BlockedPeriodDto[];
}

export interface ServiceSnapshotDto {
  name: string;
  durationMinutes: number;
}

export interface AffectedBookingDto {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  services: ServiceSnapshotDto[];
  reason: string;
  kept: boolean;
}

export interface ScheduleCurrentDto {
  version: ScheduleVersionDto | null;
  isPaused: boolean;
  warnings: AffectedBookingDto[];
  kept: AffectedBookingDto[];
}

export interface ScheduleHistoryDto {
  total: number;
  versions: ScheduleVersionDto[];
}

export interface KeepExceptionDto {
  id: string;
  scheduleVersionId: string;
  reason: string | null;
  createdAt: string;
}

export interface KeepBookingResultDto {
  ok: true;
  bookingId: string;
  exception: KeepExceptionDto;
}

/** Internal affected-booking entry produced by the engine's conflict sweep. */
export interface AffectedBookingEntry {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  services: ServiceSnapshotDto[];
  reason: string;
  kept: boolean;
}

function iso(value: Date): string {
  return value.toISOString();
}

function dateOnly(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Injectable()
export class ScheduleSerializer {
  version(row: ScheduleVersionRow): ScheduleVersionDto {
    return {
      id: row.id,
      status: row.status,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      reason: row.reason,
      bookingIntervalMinutes: row.bookingIntervalMinutes,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      workingPeriods: row.workingPeriods
        .map((p) => ({
          dayOfWeek: p.dayOfWeek,
          startMinutes: p.startMinutes,
          endMinutes: p.endMinutes,
        }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinutes - b.startMinutes),
      specialDates: row.specialDates
        .map((s) => ({
          id: s.id,
          calendarDate: dateOnly(s.calendarDate),
          isClosed: s.isClosed,
          periods: s.periods
            .map((p) => ({ startMinutes: p.startMinutes, endMinutes: p.endMinutes }))
            .sort((a, b) => a.startMinutes - b.startMinutes),
        }))
        .sort((a, b) => a.calendarDate.localeCompare(b.calendarDate)),
      blockedPeriods: row.blockedPeriods
        .map((b) => ({ id: b.id, startAt: iso(b.startAt), endAt: iso(b.endAt), reason: b.reason }))
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    };
  }

  affected(entry: AffectedBookingEntry): AffectedBookingDto {
    return {
      bookingId: entry.bookingId,
      customerName: entry.customerName,
      customerPhone: entry.customerPhone,
      startAt: iso(entry.startAt),
      endAt: iso(entry.endAt),
      durationMinutes: entry.durationMinutes,
      services: entry.services,
      reason: entry.reason,
      kept: entry.kept,
    };
  }
}
