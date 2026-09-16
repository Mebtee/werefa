import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
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

  async getVersion(businessId: string, versionId: string) {
    return this.scheduleRepo.getById(businessId, versionId);
  }

  /**
   * Keep-an-existing-booking exception (Prompt 41 §12, REQ-160/161). Only
   * recorded where a REAL schedule conflict exists against the given (new)
   * version; otherwise it is rejected — exceptions must never be a release
   * valve that makes an unavailable slot bookable.
   */
  async recordScheduleException(
    ctx: ActorContext,
    businessId: string,
    bookingId: number,
    versionId: string,
  ): Promise<import('@prisma/client').ScheduleException> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const version = await this.scheduleRepo.getById(businessId, versionId);
    if (!version) throw domainErrors.businessNotFound('Schedule version not found.');
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, businessId } });
    if (!booking) throw domainErrors.businessNotFound('Booking not found.');

    const conflicts = this.scheduleConflictsWithBooking(version, booking.startAt, booking.endAt, this.clock);
    if (!conflicts) {
      throw domainErrors.invalidSchedule({ bookingId: 'There is no real schedule conflict for this booking.' });
    }

    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const existing = await tx.scheduleException.findUnique({
        where: { bookingId_scheduleVersionId: { bookingId, scheduleVersionId: versionId } },
      });
      if (existing) return existing;
      return this.scheduleRepo.createException(tx, {
        businessId,
        versionId,
        bookingId,
        createdBy: ctx.actorUserId ?? null,
      });
    });
  }

  private scheduleConflictsWithBooking(
    version: import('../repositories/schedule.repository.port').ScheduleWithDetails,
    startAt: Date,
    endAt: Date,
    clock: GlobalClock,
  ): boolean {
    const dateKey = clock.dateKey(startAt);
    const isoWeekday = clock.isoWeekday(startAt);
    const startMin = minuteOfDay(startAt, clock);
    const endMin = minuteOfDay(endAt, clock);

    const special = version.specialDates.find((s) => clock.dateKey(s.date) === dateKey);
    if (special?.kind === 'CLOSED') return true;

    let validWindow = false;
    if (special?.kind === 'CUSTOM') {
      const s = special.startMinutes ?? 0;
      const e = special.endMinutes ?? 0;
      validWindow = startMin >= s && endMin <= e;
    } else {
      const matching = version.workingPeriods.filter((w) => w.weekday === isoWeekday);
      validWindow = matching.some((w) => startMin >= w.startMinutes && endMin <= w.endMinutes);
    }

    // Blocked period subtraction
    const blocks = version.blockedPeriods.filter(
      (b) => b.dayOfWeek == null || b.dayOfWeek === isoWeekday,
    );
    const overlapsBlock = blocks.some((b) => {
      const bs = b.startMinutes ?? 0;
      const be = b.endMinutes ?? 1440;
      return startMin < be && endMin > bs;
    });
    return !validWindow || overlapsBlock;
  }
}

function minuteOfDay(date: Date, clock: GlobalClock): number {
  const parts = clock.partsInTz(date);
  return parts.hour * 60 + parts.minute;
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
  for (const s of template.specialDates) {
    const safe = dateKeyOf(s.date);
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