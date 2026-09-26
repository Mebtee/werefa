import { Inject, Injectable, Optional, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Logger } from 'pino';
import { CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { LOGGER } from '../../common/logging/logging.module';
import { BusinessRepository } from '../repositories/business.repository.port';
import { BookingRepository } from '../repositories/booking.repository.port';
import { BOOKING_REPOSITORY, BUSINESS_REPOSITORY } from '../repositories/tokens';
import { GlobalClock, GLOBAL_CLOCK } from '../time/global-clock';
import { BookingService } from './booking.service';
import { SubscriptionService } from './subscription.service';

/**
 * Business lifecycle background worker (Prompt 52; REQ-153/154/155/231; extended
 * in Prompt 60 with the REQ-102 completion sweep).
 *
 * Always-on in-process sweep (independent of the Telegram channel) that runs two
 * best-effort duties on the same unref'd timer:
 *
 * 1. Booking completion (REQ-102 / Section 15.3 T4): every CONFIRMED booking
 *    whose scheduled end time has passed transitions to Completed. The
 *    authoritative state machine lives in BookingService/BookingRepository, so
 *    this worker only discovers candidate businesses and fans out; the guarded
 *    transition stays idempotent and advisory-locked (concurrent sweeps are safe).
 * 2. Scheduled auto-resume (REQ-153/154/155/231): businesses whose scheduled
 *    pause has ended attempt an automatic resume. The subscription service
 *    enforces the canonical rules: auto-resume only when the subscription is
 *    eligible (REQ-153); an expired subscription keeps bookings closed and
 *    records the refused attempt (REQ-154/REQ-231); renewal after the pause
 *    window has ended is handled by the approval path (REQ-155); indefinite
 *    pauses are never swept (REQ-156).
 *
 * The timer is unref'd so it never keeps the process alive, and each duty is
 * best-effort in isolation: a failure in one never takes the API down nor skips
 * the other. Sweep logic is exposed as methods so it can be exercised
 * deterministically without the timer.
 */
@Injectable()
export class BusinessLifecycleWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepo: BusinessRepository,
    @Inject(BOOKING_REPOSITORY) private readonly bookingRepo: BookingRepository,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
    private readonly subscriptionService: SubscriptionService,
    private readonly bookingService: BookingService,
    // Optional so unit tests can construct the worker without a logger; the real
    // application always injects the shared pino logger.
    @Optional() @Inject(LOGGER) private readonly logger?: Logger,
  ) {}

  onApplicationBootstrap(): void {
    // The test harness boots the whole app; the timer would only add noise there.
    if (this.config.nodeEnv === 'test') return;
    const interval = this.config.businessLifecycleIntervalMs;
    this.timer = setInterval(() => {
      // Isolated duties: a completion failure must not suppress auto-resume and
      // vice versa.
      void this.safeRun('completion sweep', () => this.sweepCompletions());
      void this.safeRun('auto-resume sweep', () => this.sweep());
    }, interval);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One completion cycle over every business that owns a due CONFIRMED booking
   * (REQ-102). Each business is completed with the existing guarded transition,
   * so replays and concurrent sweeps are idempotent.
   */
  async sweepCompletions(now: Date = this.clock.now()): Promise<{ businesses: number; completed: number }> {
    const businessIds = await this.bookingRepo.listBusinessIdsDueForCompletion(now);
    let completed = 0;
    for (const businessId of businessIds) {
      completed += await this.bookingService.autoCompleteDueBookings(businessId);
    }
    return { businesses: businessIds.length, completed };
  }

  /** One sweep cycle over businesses due for scheduled resume. */
  async sweep(now: Date = this.clock.now()): Promise<{ attempted: number; resumed: number; refused: number }> {
    const due = await this.businessRepo.listDueForResume(now);
    let resumed = 0;
    for (const businessId of due) {
      const outcome = await this.subscriptionService.attemptAutoResume(businessId);
      if (outcome.resumed) resumed++;
    }
    return { attempted: due.length, resumed, refused: due.length - resumed };
  }

  private async safeRun(label: string, task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (err) {
      // best-effort by design: a background failure must never take the API down.
      // It must, however, remain observable — log the message only (never values
      // that could carry secrets).
      this.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        `business lifecycle ${label} failed`,
      );
    }
  }
}
