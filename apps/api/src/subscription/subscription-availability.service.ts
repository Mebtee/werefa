import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  derivedStatus,
  paidGraceEndsAtOf,
  trialGraceEndsAtOf,
  type SubscriptionDates,
} from './subscription-lifecycle';

export type SubscriptionStateStatus =
  'ACTIVE' | 'TRIAL' | 'TRIAL_GRACE' | 'PAID_GRACE' | 'EXPIRED' | 'NONE';

export type QueryRunner =
  | Pick<PrismaClient, 'subscription' | 'business'>
  | Pick<Prisma.TransactionClient, 'subscription' | 'business'>;

export interface SubscriptionAvailability {
  canAcceptBookings: boolean;
  state: {
    status: SubscriptionStateStatus;
    /** When the current period/grace ends; null when none applies. */
    periodEndsAt: Date | null;
  };
  reason?: string;
}

export type DatesLike = SubscriptionDates | Partial<SubscriptionDates> | Date | null;

/**
 * Subscription availability boundary (REQ-125..141, doc 15) — Prompt 09 seam.
 *
 * The real subscription module is implemented in Prompt 14; this service keeps
 * the exact public surface from the Prompt 09 placeholder
 * (`canAcceptBookings`, `currentState`, `computeAvailability`) and swaps the
 * placeholder rule for the authoritative derivation over the `subscription`
 * table's period dates (doc 15 §1). Business lifecycle (pause/deactivate) is
 * orthogonal to subscription availability and evaluated by the business service.
 *
 * Status is DERIVED at query time from the stored dates — never trusted from
 * the persisted `status` column — so booking gates cannot drift from the real
 * boundaries even if the lifecycle job lags.
 */
@Injectable()
export class SubscriptionAvailabilityService {
  /** Commit-point assertion used by resume / reactivate (REQ-153/157/216). */
  async canAcceptBookings(businessId: string, db: QueryRunner): Promise<SubscriptionAvailability> {
    const subscription = await db.subscription.findUnique({ where: { businessId } });
    if (subscription) return this.computeAvailability(subscription);
    // Legacy tenant (created before the Prompt 14 migration): no subscription
    // row exists yet — fall back to the authoritative-at-the-time
    // business.trialEndsAt boundary until the row materializes.
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { trialEndsAt: true },
    });
    return this.computeAvailability(business?.trialEndsAt ?? null);
  }

  /** Snapshot for dashboard badges / warnings (REQ-141 analog). */
  async currentState(
    state: SubscriptionAvailability | Partial<SubscriptionDates> | null,
  ): Promise<SubscriptionAvailability['state']> {
    if (state !== null && 'state' in state) return state.state;
    const dates = toDates(state ?? null);
    return stateOf(dates, derivedStatus(dates));
  }

  /**
   * Derive the availability snapshot from the authoritative period dates.
   * Accepts either the subscription row shape (with paid boundaries), the
   * legacy `business.trialEndsAt` shape, or a raw Date.
   */
  computeAvailability(dates: DatesLike): SubscriptionAvailability {
    const normalized = toDates(dates);
    const status = derivedStatus(normalized);
    const canAcceptBookings = status !== 'EXPIRED';
    return {
      canAcceptBookings,
      state: stateOf(normalized, status),
      reason: canAcceptBookings ? undefined : 'subscription-expired',
    };
  }

  /** Trial length in days (single source of truth for creation). */
  static readonly TRIAL_DAYS = 30;
}

function toDates(input: DatesLike): SubscriptionDates {
  if (input === null) {
    return {
      trialStartedAt: null,
      trialEndsAt: null,
      paidPeriodStartAt: null,
      paidEndsAt: null,
      paidGraceEndsAt: null,
    };
  }
  if (input instanceof Date) {
    return {
      trialStartedAt: null,
      trialEndsAt: input,
      paidPeriodStartAt: null,
      paidEndsAt: null,
      paidGraceEndsAt: null,
    };
  }
  return {
    trialStartedAt: input.trialStartedAt ?? null,
    trialEndsAt: input.trialEndsAt ?? null,
    paidPeriodStartAt: input.paidPeriodStartAt ?? null,
    paidEndsAt: input.paidEndsAt ?? null,
    paidGraceEndsAt: input.paidGraceEndsAt ?? null,
  };
}

function stateOf(
  dates: SubscriptionDates,
  status: SubscriptionStateStatus,
): SubscriptionAvailability['state'] {
  switch (status) {
    case 'TRIAL':
      return { status, periodEndsAt: dates.trialEndsAt };
    case 'TRIAL_GRACE':
      return {
        status,
        periodEndsAt: dates.trialEndsAt ? trialGraceEndsAtOf(dates.trialEndsAt) : null,
      };
    case 'ACTIVE':
      return { status, periodEndsAt: dates.paidEndsAt };
    case 'PAID_GRACE':
      return {
        status,
        periodEndsAt: dates.paidEndsAt ? paidGraceEndsAtOf(dates.paidEndsAt) : null,
      };
    default:
      return { status, periodEndsAt: null };
  }
}
