import { Inject, Injectable } from '@nestjs/common';
import { ActorType, BookingState, PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ActorContext } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { domainErrors } from '../errors/domain-errors';
import { ScheduleRepository, ScheduleTemplate } from '../repositories/schedule.repository.port';
import { SCHEDULE_REPOSITORY } from '../repositories/tokens';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';

/**
 * Versioned schedule management (REQ-082 … REQ-099, REQ-150/151/152; Prompt 41
 * §7). Every save creates a NEW immutable version row with its children
 * (REQ-162/163); the running business promotes it to ACTIVE at once, a paused
 * business keeps it PENDING (promoted on resume). The partial unique index
 * `uq_active_schedule_version` guarantees at most one ACTIVE version — the
 * service demotes the previous ACTIVE inside the same transaction.
 */
@Injectable()
export class ScheduleService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SCHEDULE_REPOSITORY) private readonly scheduleRepo: ScheduleRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    private readonly tenantGuard: TenantGuard,
  ) {}

  async saveTemplate(
    ctx: ActorContext,
    businessId: string,
    input: { template: ScheduleTemplate; name?: string },
  ): Promise<{ versionId: string; activated: boolean }> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    validateTemplate(input.template);

    const settings = await this.prisma.businessSettings.findUnique({ where: { businessId } });
    const isPaused = settings?.isPaused ?? false;

    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const versionNo = await this.scheduleRepo.nextVersionNo(businessId);
      const version = await this.scheduleRepo.createPendingVersion(tx, {
        businessId,
        versionNo,
        name: input.name,
        template: input.template,
      });

      if (!isPaused) {
        const now = this.clock.now();
        await this.scheduleRepo.demoteActiveVersions(tx, { businessId, replacedAt: now });
        const promoted = await this.scheduleRepo.promotePendingVersion(tx, {
          versionId: version.id,
          businessId,
          appliedBy: ctx.actorUserId ?? 'system',
          reason: input.name ?? 'Schedule saved',
        });
        if (!promoted) throw domainErrors.invalidLifecycleTransition('Schedule version could not be promoted.');
        await this.scheduleRepo.setBusinessActiveVersion(tx, { businessId, versionId: version.id });
        return { versionId: version.id, activated: true };
      }
      return { versionId: version.id, activated: false };
    });
  }

  async getActiveVersion(businessId: string) {
    return this.scheduleRepo.getActiveVersion(businessId);
  }

  async listVersions(businessId: string) {
    return this.scheduleRepo.listVersions(businessId);
  }

  async listVersionsWithDetails(businessId: string) {
    return this.prisma.scheduleVersion.findMany({
      where: { businessId },
      orderBy: { versionNo: 'asc' },
      include: { workingPeriods: true, blockedPeriods: true, specialDates: true },
    });
  }

  async getVersion(businessId: string, versionId: string) {
    return this.scheduleRepo.getById(businessId, versionId);
  }

  /**
   * Keep-an-existing-booking exception (Prompt 41 §12, REQ-160/161). Only
   * recorded where a REAL schedule conflict exists against the given (new)
   * version; otherwise it is rejected — exceptions must never be a release
   * valve that makes an unavailable slot bookable. The exception (with the
   * owner's optional reason) is written atomically with a booking status
   * history audit row (`from_status` NULL so the no-op CHECK passes; REQ-173).
   */
  async recordScheduleException(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
    versionId: string,
    reason?: string | null,
  ): Promise<import('@prisma/client').ScheduleException> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const version = await this.scheduleRepo.getById(businessId, versionId);
    if (!version) throw domainErrors.businessNotFound('Schedule version not found.');
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, businessId } });
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');

    const trimmed = reason?.trim();
    if (trimmed && trimmed.length > 500) {
      throw domainErrors.invalidSchedule({ reason: 'Keep-booking reason must be at most 500 characters.' });
    }

    const conflicts = this.scheduleConflictsWithBooking(version, booking.startAt, booking.endAt, this.clock);
    if (!conflicts) {
      throw domainErrors.invalidSchedule({ bookingId: 'There is no real schedule conflict for this booking.' });
    }

    const auditReason = trimmed
      ? `Schedule exception: ${trimmed}`
      : 'Schedule exception: booking kept despite schedule conflict.';

    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const existing = await tx.scheduleException.findUnique({
        where: { bookingId_scheduleVersionId: { bookingId, scheduleVersionId: versionId } },
      });
      if (existing) return existing;
      const exception = await this.scheduleRepo.createException(tx, {
        businessId,
        versionId,
        bookingId,
        createdBy: ctx.actorUserId ?? null,
        reason: trimmed || null,
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          businessId,
          fromStatus: null,
          toStatus: booking.status,
          actorType: (ctx.actorType as ActorType) ?? 'OWNER',
          actorUserId: ctx.actorUserId ?? null,
          reason: auditReason,
        },
      });
      return exception;
    });
  }

  /**
   * Open schedule conflicts against the CURRENT ACTIVE version (REQ-092/093).
   * A live booking (PAYMENT_PENDING/CONFIRMED) conflicts when it is impossible
   * under the active version and nobody has recorded a Keep-Booking exception
   * for it. Pure derivation from the active version + booked rows — nothing is
   * persisted. The returned view embeds the booking details needed by the
   * affected-booking UI (REQ-097) and a human conflict reason (REQ-093).
   */
  async listOpenConflicts(
    businessId: string,
  ): Promise<
    {
      bookingId: number;
      status: BookingState;
      startAt: Date;
      endAt: Date;
      createdAt: Date;
      customerName: string;
      customerPhone: string;
      note: string | null;
      reason: 'CLOSED' | 'OUTSIDE_HOURS' | 'BLOCKED';
      reasonDetail: string;
      services: { name: string; durationMinutes: number; unitPriceMinor: string }[];
    }[]
  > {
    const version = await this.scheduleRepo.getActiveVersion(businessId);
    if (!version) return [];

    const bookings = await this.prisma.booking.findMany({
      where: { businessId, status: { in: ['PAYMENT_PENDING', 'CONFIRMED'] } },
      include: { components: true },
    });
    if (bookings.length === 0) return [];

    const exceptionRows = await this.prisma.scheduleException.findMany({
      where: {
        scheduleVersionId: version.id,
        bookingId: { in: bookings.map((b) => b.id) },
      },
    });
    const excused = new Set(exceptionRows.map((e) => e.bookingId));

    const conflicts = [];
    for (const booking of bookings) {
      if (excused.has(booking.id)) continue;
      const reason = this.scheduleConflictReason(version, booking.startAt, booking.endAt, this.clock);
      if (!reason) continue;
      conflicts.push({
        bookingId: booking.id,
        status: booking.status,
        startAt: booking.startAt,
        endAt: booking.endAt,
        createdAt: booking.createdAt,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        note: booking.note,
        reason: reason.kind,
        reasonDetail: reason.detail,
        services: booking.components.map((c) => ({
          name: c.nameSnapshot,
          durationMinutes: c.durationMinutes,
          unitPriceMinor: c.unitPriceMinor.toString(),
        })),
      });
    }
    return conflicts;
  }

  private scheduleConflictsWithBooking(
    version: import('../repositories/schedule.repository.port').ScheduleWithDetails,
    startAt: Date,
    endAt: Date,
    clock: GlobalClock,
  ): boolean {
    return this.scheduleConflictReason(version, startAt, endAt, clock) != null;
  }

  private scheduleConflictReason(
    version: import('../repositories/schedule.repository.port').ScheduleWithDetails,
    startAt: Date,
    endAt: Date,
    clock: GlobalClock,
  ): { kind: 'CLOSED' | 'OUTSIDE_HOURS' | 'BLOCKED'; detail: string } | null {
    const dateKey = clock.dateKey(startAt);
    const isoWeekday = clock.isoWeekday(startAt);
    const startMin = minuteOfDay(startAt, clock);
    const endMin = minuteOfDay(endAt, clock);

    const special = version.specialDates.find((s) => clock.dateKey(s.date) === dateKey);
    if (special?.kind === 'CLOSED') {
      return { kind: 'CLOSED', detail: `Closed on ${dateKey}.` };
    }

    let validWindow = false;
    if (special?.kind === 'CUSTOM') {
      const s = special.startMinutes ?? 0;
      const e = special.endMinutes ?? 0;
      validWindow = startMin >= s && endMin <= e;
    } else {
      const matching = version.workingPeriods.filter((w) => w.weekday === isoWeekday);
      validWindow = matching.some((w) => startMin >= w.startMinutes && endMin <= w.endMinutes);
    }
    if (!validWindow) {
      return { kind: 'OUTSIDE_HOURS', detail: `Outside working hours on ${dateKey}.` };
    }

    const blocks = version.blockedPeriods.filter(
      (b) => b.dayOfWeek == null || b.dayOfWeek === isoWeekday,
    );
    const block = blocks.find((b) => {
      const bs = b.startMinutes ?? 0;
      const be = b.endMinutes ?? 1440;
      return startMin < be && endMin > bs;
    });
    if (block) {
      const label = block.dayOfWeek == null ? 'every day' : WEEKDAY_NAMES[block.dayOfWeek];
      return { kind: 'BLOCKED', detail: `Blocked period (${formatWindow(block.startMinutes, block.endMinutes)}) on ${label}.` };
    }
    return null;
  }
}

function minuteOfDay(date: Date, clock: GlobalClock): number {
  const parts = clock.partsInTz(date);
  return parts.hour * 60 + parts.minute;
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

function formatWindow(startMinutes: number | null, endMinutes: number | null): string {
  if (startMinutes == null && endMinutes == null) return 'all day';
  const start = toHHMM(startMinutes ?? 0);
  const end = toHHMM(endMinutes ?? 1440);
  return `${start}–${end}`;
}

function toHHMM(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export function validateTemplate(template: ScheduleTemplate): void {
  const fields: Record<string, string> = {};
  for (const w of template.workingPeriods) {
    if (w.weekday < 1 || w.weekday > 7) fields[`workingPeriods`] = 'Weekday must be 1 (Monday) to 7 (Sunday).';
    if (w.startMinutes < 0 || w.startMinutes >= 1440 || w.endMinutes <= 0 || w.endMinutes > 1440) {
      fields['workingPeriods'] = 'Start/end must be within [0, 1440].';
    }
    if (w.startMinutes >= w.endMinutes) fields['workingPeriods'] = 'Start must be before end.';
    if (w.startMinutes % 1 !== 0 || w.endMinutes % 1 !== 0) fields['workingPeriods'] = 'Minutes must be whole numbers.';
  }
  if (template.workingPeriods.length === 0 && template.specialDates.length === 0) {
    fields['workingPeriods'] = 'At least one working period is required.';
  }
  for (const b of template.blockedPeriods) {
    if (b.dayOfWeek != null && (b.dayOfWeek < 1 || b.dayOfWeek > 7)) fields['blockedPeriods'] = 'dayOfWeek must be 1–7 or null.';
    if (b.startMinutes != null && b.endMinutes != null && b.startMinutes >= b.endMinutes) fields['blockedPeriods'] = 'Start must be before end.';
  }
  const seenDates = new Set<string>();
  for (const s of template.specialDates) {
    const safe = dateKeyOf(s.date);
    if (seenDates.has(safe)) fields[`specialDates.${safe}`] = 'Duplicate special date.';
    seenDates.add(safe);
    if (s.kind === 'CUSTOM' && (s.startMinutes == null || s.endMinutes == null)) fields[`specialDates.${safe}`] = 'Custom special dates need start/end.';
    if (s.kind === 'CUSTOM' && s.startMinutes != null && s.endMinutes != null && s.startMinutes >= s.endMinutes) fields[`specialDates.${safe}`] = 'Start must be before end.';
  }
  if (Object.keys(fields).length > 0) throw domainErrors.invalidSchedule(fields);
}

function dateKeyOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}