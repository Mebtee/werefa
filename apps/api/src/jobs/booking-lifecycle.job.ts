import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { withTenantContext } from '../database/tenant-executor';
import { withBookingLock } from '../booking/booking-lock';
import {
  BookingNotificationService,
  BOOKING_NOTIFICATION_TYPE,
} from '../booking/booking-notifications';
import { JobQueueService, type JobDefinition, type JobPayload } from './job-queue.service';
import { SYSTEM_ACTOR_ID } from '../business/business.service';

export const BOOKING_AUTO_COMPLETE = 'booking-auto-complete';
export const BOOKING_REMINDERS = 'booking-reminders';
const EVERY_MINUTE = '* * * * *';

const REMINDER_DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Background lifecycle for bookings (Prompt 11, Domain 10; master spec Section
 * 26). Both sweep jobs run every minute in the queue worker:
 *
 *  - Auto-complete (T4): a CONFIRMED booking whose `end_at` has passed becomes
 *    COMPLETED with the SYSTEM actor and its slot released — no owner action.
 *  - Reminders: BOOKING_REMINDER_24H / BOOKING_REMINDER_1H notification rows
 *    are queued for CONFIRMED bookings as their start approaches (deduplicated
 *    per booking so repeated sweeps never double-send).
 *
 * In the `test` environment the worker does not start; integration tests call
 * the sweep methods directly to exercise the transitions deterministically.
 */
@Injectable()
export class BookingLifecycleJob implements OnModuleInit {
  private readonly logger = new Logger(BookingLifecycleJob.name);

  constructor(
    private readonly jobs: JobQueueService,
    private readonly prisma: PrismaService,
    private readonly notifications: BookingNotificationService,
  ) {}

  onModuleInit(): void {
    const complete: JobDefinition<JobPayload> = {
      name: BOOKING_AUTO_COMPLETE,
      maxAttempts: 3,
      backoffMs: 30_000,
      repeatCron: EVERY_MINUTE,
      handler: async () => {
        const completed = await this.autoCompleteDue();
        if (completed > 0)
          this.logger.log(`Auto-complete sweep: ${completed} booking(s) completed`);
      },
    };
    const reminders: JobDefinition<JobPayload> = {
      name: BOOKING_REMINDERS,
      maxAttempts: 3,
      backoffMs: 30_000,
      repeatCron: EVERY_MINUTE,
      handler: async () => {
        const queued = await this.queueDueReminders();
        if (queued > 0) this.logger.log(`Reminder sweep: ${queued} reminder(s) queued`);
      },
    };
    this.jobs.register(complete);
    this.jobs.register(reminders);
  }

  /** Exposed for tests: complete all CONFIRMED bookings whose window already ended. */
  async autoCompleteDue(): Promise<number> {
    const now = new Date();
    const due = await withTenantContext(
      this.prisma,
      { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
      (tx) =>
        tx.booking.findMany({
          where: { status: 'CONFIRMED', endAt: { lte: now } },
          select: { id: true, businessId: true },
          take: 500,
        }),
    );

    const byBusiness = new Map<string, string[]>();
    for (const row of due) {
      const list = byBusiness.get(row.businessId) ?? [];
      list.push(row.id);
      byBusiness.set(row.businessId, list);
    }

    let completed = 0;
    for (const [businessId, bookingIds] of byBusiness) {
      completed += await withBookingLock(
        this.prisma,
        { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
        businessId,
        async (tx) => {
          const rows = await tx.booking.findMany({
            where: { id: { in: bookingIds }, status: 'CONFIRMED', endAt: { lte: now } },
            include: { slotLocks: { orderBy: { createdAt: 'desc' } } },
          });
          for (const booking of rows) {
            await tx.booking.update({
              where: { id: booking.id },
              data: { status: 'COMPLETED', updatedAt: now },
            });
            await tx.bookingStatusHistory.create({
              data: {
                bookingId: booking.id,
                businessId,
                fromStatus: 'CONFIRMED',
                toStatus: 'COMPLETED',
                actorType: 'SYSTEM',
                actorUserId: SYSTEM_ACTOR_ID,
                reason: 'end_at reached',
                occurredAt: now,
              },
            });
            const activeLock = booking.slotLocks.find((lock) => lock.status !== 'RELEASED');
            if (activeLock) {
              await tx.slotLock.update({
                where: { id: activeLock.id },
                data: { status: 'RELEASED', releasedAt: now, releasedBy: 'SYSTEM' },
              });
            }
          }
          return rows.length;
        },
      );
    }
    return completed;
  }

  /** Exposed for tests: queue due 24h / 1h reminders, deduplicating per booking. */
  async queueDueReminders(): Promise<number> {
    const HOUR = 60 * 60_000;
    let queued = 0;
    queued += await this.queueReminderWindow(
      23.5 * HOUR,
      24.5 * HOUR,
      BOOKING_NOTIFICATION_TYPE.reminder24h,
    );
    queued += await this.queueReminderWindow(
      0.5 * HOUR,
      1.5 * HOUR,
      BOOKING_NOTIFICATION_TYPE.reminder1h,
    );
    return queued;
  }

  /**
   * Queue `type` reminders for CONFIRMED bookings starting within
   * `[now+minOffsetMs, now+maxOffsetMs)`, skipping bookings that already have an
   * identical reminder queued in the dedup window.
   */
  private async queueReminderWindow(
    minOffsetMs: number,
    maxOffsetMs: number,
    type: string,
  ): Promise<number> {
    const now = new Date();
    const windowStart = new Date(now.getTime() + minOffsetMs);
    const windowEnd = new Date(now.getTime() + maxOffsetMs);
    const dedupBefore = new Date(now.getTime() - REMINDER_DEDUP_WINDOW_MS);

    const rows = await withTenantContext(
      this.prisma,
      { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
      (tx) =>
        tx.booking.findMany({
          where: {
            status: 'CONFIRMED',
            startAt: { gte: windowStart, lt: windowEnd },
            notifications: { none: { type, createdAt: { gte: dedupBefore } } },
          },
          select: { id: true, businessId: true, startAt: true },
          take: 500,
        }),
    );

    let queued = 0;
    for (const row of rows) {
      await withTenantContext(
        this.prisma,
        { userId: SYSTEM_ACTOR_ID, scope: 'SUPER_ADMIN' },
        async (tx) => {
          await this.notifications.enqueue(tx, {
            businessId: row.businessId,
            bookingId: row.id,
            type,
            payload: { startAt: row.startAt.toISOString() },
          });
        },
      );
      queued += 1;
    }
    return queued;
  }
}
