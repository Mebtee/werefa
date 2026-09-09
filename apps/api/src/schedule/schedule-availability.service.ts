import { Injectable } from '@nestjs/common';
import { ErrorCodes } from '@werefa/shared';
import { ConflictException } from '../common/http/app-error';
import type { TenantTransaction } from '../database/tenant-executor';
import {
  evaluateFit,
  type ScheduleSnapshot,
  type ScheduleViolation,
} from './schedule-availability';
import type { Prisma } from '@prisma/client';

/** Full version row with all content children, as Prisma returns it. */
export type ScheduleVersionRow = Prisma.ScheduleVersionGetPayload<{
  include: {
    workingPeriods: true;
    specialDates: { include: { periods: true } };
    blockedPeriods: true;
  };
}>;

/** Map a DB version row (with children) to the pure engine's snapshot. */
export function normalizeVersionRow(row: ScheduleVersionRow): ScheduleSnapshot {
  return {
    versionId: row.id,
    businessId: row.businessId,
    status: row.status,
    bookingIntervalMinutes: row.bookingIntervalMinutes,
    workingPeriods: row.workingPeriods.map((p) => ({
      dayOfWeek: p.dayOfWeek,
      startMinutes: p.startMinutes,
      endMinutes: p.endMinutes,
    })),
    specialDates: row.specialDates.map((s) => ({
      calendarDate: s.calendarDate,
      isClosed: s.isClosed,
      periods: s.periods.map((p) => ({
        dayOfWeek: 0,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
      })),
    })),
    blockedPeriods: row.blockedPeriods.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
  };
}

export const SCHEDULE_VERSION_INCLUDE = {
  workingPeriods: true,
  specialDates: { include: { periods: true } },
  blockedPeriods: true,
} satisfies Prisma.ScheduleVersionInclude;

/**
 * Schedule window gate (docs 10 §2/§8). Reads the ACTIVE schedule version
 * inside the caller's tenant transaction (RLS reads under whatever scope the
 * booking/public flow established) and evaluates slot fits with the pure
 * engine. No ACTIVE version ⇒ no schedule constraint (legacy all-day).
 */
@Injectable()
export class ScheduleAvailabilityService {
  /** Load the ACTIVE version snapshot, or null when there is none. */
  async activeSnapshot(
    tx: TenantTransaction,
    businessId: string,
  ): Promise<ScheduleSnapshot | null> {
    const row = await tx.scheduleVersion.findFirst({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: SCHEDULE_VERSION_INCLUDE,
    });
    return row ? normalizeVersionRow(row) : null;
  }

  /**
   * Does `[startAt, endAt)` fit the business's CURRENT schedule? Returns ok
   * when there is no ACTIVE schedule. Never throws — the caller decides whether
   * a miss is a hard failure (creation/reschedule) or a soft advisory
   * (availability pre-check).
   */
  async windowOk(
    tx: TenantTransaction,
    businessId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<{ ok: boolean; reason?: ScheduleViolation }> {
    const snapshot = await this.activeSnapshot(tx, businessId);
    return evaluateFit(snapshot, startAt, endAt);
  }

  /** Assert the window fits the active schedule, else throw SLOT_UNAVAILABLE. */
  async assertWindowOk(
    tx: TenantTransaction,
    businessId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    const { ok } = await this.windowOk(tx, businessId, startAt, endAt);
    if (!ok) {
      throw new ConflictException(
        'This time slot is outside the scheduled business hours.',
        ErrorCodes.SLOT_UNAVAILABLE,
      );
    }
  }
}
