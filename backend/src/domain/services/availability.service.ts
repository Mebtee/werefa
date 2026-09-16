import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { ScheduleRepository } from '../repositories/schedule.repository.port';
import { SCHEDULE_REPOSITORY } from '../repositories/tokens';
import { computeAvailableSlotStarts, SlotStart } from './availability';

/**
 * Availability service (doc 10; Prompt 41 §8).
 *
 * Gates: paused business → none (R147); expired subscription → none (R133).
 * Active schedule version only (R150). Overlap: active bookings
 * (PAYMENT_PENDING/CONFIRMED) and active slot locks (LOCKED/ALLOCATED). All
 * date math is in the global timezone (R222–226). Pure computation lives in
 * availability.ts; this service resolves data + gates.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SCHEDULE_REPOSITORY) private readonly scheduleRepo: ScheduleRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
  ) {}

  /** Slot starts for a single calendar day (global-tz 'YYYY-MM-DD'). */
  async getSlotsForDay(
    businessId: string,
    args: { dateKey: string; durationMinutes: number; fromMinutes?: number; untilMinutes?: number },
  ): Promise<SlotStart[]> {
    const biz = await this.prisma.business.findUnique({ where: { id: businessId }, select: { deactivatedAt: true } });
    if (!biz || biz.deactivatedAt) return [];

    const settings = await this.prisma.businessSettings.findUnique({ where: { businessId } });
    if (!settings || settings.isPaused) return [];

    const sub = await this.prisma.subscription.findUnique({ where: { businessId }, select: { status: true } });
    if (!sub || !['TRIAL', 'TRIAL_GRACE', 'ACTIVE', 'PAID_GRACE'].includes(sub.status)) return [];

    const version = await this.scheduleRepo.getActiveVersion(businessId);
    if (!version) return [];

    const [y, m, d] = args.dateKey.split('-').map(Number);
    const dayStart = new Date(Date.UTC(y, m - 1, d));
    const nextDayStart = new Date(Date.UTC(y, m - 1, d + 1));
    const isoWeekday = this.clock.isoWeekday(dayStart);

    const bookings = await this.prisma.booking.findMany({
      where: {
        businessId,
        status: { in: ['PAYMENT_PENDING', 'CONFIRMED'] },
        startAt: { lt: nextDayStart },
        endAt: { gt: dayStart },
      },
      select: { startAt: true, endAt: true },
    });
    const locks = await this.prisma.slotLock.findMany({
      where: { businessId, state: { in: ['LOCKED', 'ALLOCATED'] }, slotDate: dayStart },
      select: { startAt: true, endAt: true },
    });

    const dayMs = dayStart.getTime();
    const nextMs = nextDayStart.getTime();
    const minuteSpans = [...bookings, ...locks].map((s) => ({
      startMinute: Math.max(0, Math.floor((Math.max(s.startAt.getTime(), dayMs) - dayMs) / 60_000)),
      endMinute: Math.min(1440, Math.ceil((Math.min(s.endAt.getTime(), nextMs) - dayMs) / 60_000)),
    }));

    const result = computeAvailableSlotStarts(
      {
        intervalMinutes: settings.bookingIntervalMins,
        durationMinutes: args.durationMinutes,
        isoWeekday,
        dateKey: args.dateKey,
        workingPeriods: version.workingPeriods.map((w) => ({ weekday: w.weekday, startMinutes: w.startMinutes, endMinutes: w.endMinutes })),
        blockedPeriods: version.blockedPeriods.map((b) => ({ dayOfWeek: b.dayOfWeek, startMinutes: b.startMinutes, endMinutes: b.endMinutes })),
        specialDates: version.specialDates.map((s) => ({
          dateKey: this.clock.dateKey(s.date),
          kind: s.kind as 'CLOSED' | 'CUSTOM',
          startMinutes: s.startMinutes,
          endMinutes: s.endMinutes,
        })),
        occupiedSpans: [],
        fromMinutes: args.fromMinutes,
        untilMinutes: args.untilMinutes,
      },
      minuteSpans,
    );

    return result.map((r) => ({
      startAt: this.clock.atTimeOn(dayStart, Math.floor(r.startMinute / 60), r.startMinute % 60),
      endAt: this.clock.atTimeOn(dayStart, Math.floor(r.endMinute / 60), r.endMinute % 60),
      dayStart,
      startMinutes: r.startMinute,
      endMinutes: r.endMinute,
    }));
  }
}