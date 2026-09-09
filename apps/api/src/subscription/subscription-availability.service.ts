import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

export type SubscriptionStateStatus = 'ACTIVE' | 'TRIAL' | 'GRACE' | 'EXPIRED' | 'NONE';

export type QueryRunner =
  Pick<PrismaClient, 'business'> | Pick<Prisma.TransactionClient, 'business'>;

export interface SubscriptionAvailability {
  canAcceptBookings: boolean;
  state: {
    status: SubscriptionStateStatus;
    /** When the current period/grace ends; null when none applies. */
    periodEndsAt: Date | null;
  };
  reason?: string;
}

const TRIAL_DAYS = 30; // REQ-006 / REQ-128

/**
 * Subscription availability boundary (REQ-125..141) — Prompt 09 seam.
 *
 * The full subscription module (one monthly price, manual bank transfer,
 * proof upload, Admin/Super Admin review/approval, grace periods REQ-129/131,
 * reminders REQ-139/140) is deliberately NOT implemented yet. Anything that
 * must gate on subscription state goes THROUGH this service so Prompt 10+ can
 * swap in the real implementation without touching callers.
 *
 * Placeholder behaviour (documented in docs/03-business-tenant-management.md):
 *  - Every business can accept bookings; no fabricated subscription records.
 *  - TRIAL state is surfaced from the real 30-day `business.trialEndsAt`
 *    column (REQ-006/128) so dashboards can render a trial countdown today.
 *
 * Replace `computeAvailability` with the real subscription store later; the
 * public surface (`canAcceptBookings`, `currentState`) is the contract.
 */
@Injectable()
export class SubscriptionAvailabilityService {
  /** Commit-point assertion used by resume / reactivate (REQ-153/157/216). */
  async canAcceptBookings(businessId: string, db: QueryRunner): Promise<SubscriptionAvailability> {
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { trialEndsAt: true },
    });
    return this.computeAvailability(business?.trialEndsAt ?? null);
  }

  /** Snapshot for dashboard badges / warnings (REQ-141 analog). */
  async currentState(
    state: SubscriptionAvailability | { trialEndsAt: Date | null },
  ): Promise<SubscriptionAvailability['state']> {
    if ('state' in state) return state.state;
    return this.computeAvailability(state.trialEndsAt).state;
  }

  /**
   * Placeholder rule set. Do not add pause/deactivated logic here — business
   * lifecycle (pause/deactivate) is evaluated by the business service and is
   * orthogonal to subscription availability.
   */
  computeAvailability(trialEndsAt: Date | null): SubscriptionAvailability {
    const now = Date.now();
    if (trialEndsAt === null) {
      return { canAcceptBookings: true, state: { status: 'ACTIVE', periodEndsAt: null } };
    }
    if (trialEndsAt.getTime() > now) {
      return {
        canAcceptBookings: true,
        state: { status: 'TRIAL', periodEndsAt: trialEndsAt },
      };
    }
    // Trial period completed. With no real subscription store yet there is no
    // continuation; keep bookings enabled (placeholder) but surface EXPIRED so
    // the dashboard can warn (REQ-141) about the trial having ended.
    return {
      canAcceptBookings: true,
      state: { status: 'EXPIRED', periodEndsAt: trialEndsAt },
      reason: 'trial-period-ended-placeholder',
    };
  }

  /** Trial length in days (single source of truth for creation). */
  static readonly TRIAL_DAYS = TRIAL_DAYS;
}
