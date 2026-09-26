import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/app-config';
import type { BusinessRepository } from '../repositories/business.repository.port';
import type { BookingRepository } from '../repositories/booking.repository.port';
import type { GlobalClock } from '../time/global-clock';
import { BusinessLifecycleWorker } from './business-lifecycle.worker';
import type { BookingService } from './booking.service';
import type { SubscriptionService } from './subscription.service';

const NOW = new Date('2026-09-14T18:00:00.000Z');

interface WorkerOptions {
  due?: string[];
  resume?: (id: string) => boolean;
  businessesDueForCompletion?: string[];
  completedByBusiness?: (id: string) => number;
}

function makeWorker(opts: WorkerOptions): BusinessLifecycleWorker {
  const config = {
    nodeEnv: 'production',
    businessLifecycleIntervalMs: 60_000,
  } as unknown as AppConfig;
  const repo = {
    listDueForResume: async () => opts.due ?? [],
  } as unknown as BusinessRepository;
  const bookingRepo = {
    listBusinessIdsDueForCompletion: async () => opts.businessesDueForCompletion ?? [],
  } as unknown as BookingRepository;
  const clock = { now: () => NOW } as unknown as GlobalClock;
  const subscription = {
    attemptAutoResume: async (id: string) => ({ resumed: (opts.resume ?? (() => true))(id) }),
  } as unknown as SubscriptionService;
  const booking = {
    autoCompleteDueBookings: async (id: string) => (opts.completedByBusiness ?? (() => 1))(id),
  } as unknown as BookingService;
  return new BusinessLifecycleWorker(config, repo, bookingRepo, clock, subscription, booking);
}

/**
 * Scheduled auto-resume sweep (Prompt 52; REQ-153/154/155/231). The worker only
 * fans out to the authoritative SubscriptionService; the eligibility rules live
 * there (and are covered against the real database in domain-services.db.spec).
 */
describe('BusinessLifecycleWorker.sweep', () => {
  it('attempts every due business and counts resumed vs refused', async () => {
    const worker = makeWorker({ due: ['a', 'b', 'c'], resume: (id) => id !== 'b' });
    await expect(worker.sweep(NOW)).resolves.toEqual({ attempted: 3, resumed: 2, refused: 1 });
  });

  it('is a no-op when no scheduled pause is due', async () => {
    const worker = makeWorker({ due: [] });
    await expect(worker.sweep(NOW)).resolves.toEqual({ attempted: 0, resumed: 0, refused: 0 });
  });
});

/**
 * Completion sweep (Prompt 60; REQ-102 / Section 15.3 T4): the worker discovers
 * businesses with due CONFIRMED bookings and delegates each to the authoritative
 * BookingService, summing the completions. The state-machine rules and slot
 * release are covered against the real database in domain-services.db.spec.
 */
describe('BusinessLifecycleWorker.sweepCompletions', () => {
  it('completes due bookings for every candidate business and sums the results', async () => {
    const worker = makeWorker({
      businessesDueForCompletion: ['a', 'b'],
      completedByBusiness: (id) => (id === 'a' ? 2 : 1),
    });
    await expect(worker.sweepCompletions(NOW)).resolves.toEqual({ businesses: 2, completed: 3 });
  });

  it('is a no-op when no confirmed booking is past its end time', async () => {
    const worker = makeWorker({ businessesDueForCompletion: [] });
    await expect(worker.sweepCompletions(NOW)).resolves.toEqual({ businesses: 0, completed: 0 });
  });
});

/**
 * Background failures must never crash the process, but they must stay
 * observable (Phase 25). A failing duty is caught and logged, never rethrown.
 */
describe('BusinessLifecycleWorker.safeRun', () => {
  it('swallows the error and logs it without throwing', async () => {
    const warn = vi.fn();
    const worker = makeWorker({});
    (worker as unknown as { logger?: Logger }).logger = { warn } as unknown as Logger;

    const run = (worker as unknown as { safeRun(label: string, task: () => Promise<unknown>): Promise<void> }).safeRun.bind(worker);
    await expect(run('completion sweep', async () => Promise.reject(new Error('boom')))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ err: 'boom' });
  });
});
