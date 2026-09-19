import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ActorContext, isOwner } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { domainErrors } from '../errors/domain-errors';
import { BusinessRepository, BusinessWithOwner } from '../repositories/business.repository.port';
import { SubscriptionRepository } from '../repositories/subscription.repository.port';
import { BUSINESS_REPOSITORY, SUBSCRIPTION_REPOSITORY } from '../repositories/tokens';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';
import { ScheduleRepository } from '../repositories/schedule.repository.port';
import { SCHEDULE_REPOSITORY } from '../repositories/tokens';

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'www', 'public', 'telegram', 'auth', 'health', 'ready', 'meta', 'null', 'undefined',
  'system', 'superadmin', 'dashboard', 'login', 'register', 'signup', 'signin', 'settings', 'support',
  'help', 'docs', 'doc', 'assets', 'static', 'files', 'images', 'img', 'uploads', 'webhook', 'callback',
  'status', 'ping', 'version', 'booking', 'bookings', 'service', 'services',
]);

/**
 * Business lifecycle service (REQ-047 slug, REQ-006 trial, REQ-110/111
 * prepayment, REQ-147/148/149 pause, REQ-216 deactivation, Prompt 41 §5).
 *
 * Creating a business starts its subscription TRIAL state (doc 15 §1).  Any
 * business mutation that can race an availability/booking decision goes through
 * the per-business advisory lock.
 */
@Injectable()
export class BusinessService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepo: BusinessRepository,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptionRepo: SubscriptionRepository,
    @Inject(SCHEDULE_REPOSITORY) private readonly scheduleRepo: ScheduleRepository,
    private readonly tenantGuard: TenantGuard,
  ) {}

  async createBusiness(
    ctx: ActorContext,
    input: {
      slug: string;
      categoryCode: string;
      name: string;
      description?: string;
      address?: string;
      phonePublic?: string;
      bookingIntervalMinutes?: number;
    },
  ): Promise<BusinessWithOwner> {
    if (!isOwner(ctx) || !ctx.actorUserId) {
      throw domainErrors.unauthorizedTenantAccess('Only owners can create a business.');
    }
    const slug = validateSlug(input.slug);
    const interval = input.bookingIntervalMinutes ?? 60;
    if (interval <= 0 || interval % 5 !== 0) {
      throw domainErrors.invalidSchedule({ bookingIntervalMinutes: 'Interval must be a positive multiple of 5.' });
    }

    // Business creation itself does not need the advisory lock (no bookings yet);
    // slug uniqueness is enforced by the DB unique index (P2002 → CONFLICT).
    // Reads of the new row happen AFTER commit: rows written inside the
    // interactive transaction are not visible through the outer client.
    try {
      const businessId = await this.prisma.$transaction(async (tx) => {
        const business = await this.businessRepo.createForOwner(tx, {
          publicSlug: slug,
          categoryCode: input.categoryCode,
          name: input.name,
          description: input.description,
          address: input.address,
          phonePublic: input.phonePublic,
          ownerId: ctx.actorUserId!,
          bookingIntervalMinutes: interval,
        });
        await this.subscriptionRepo.ensureTrialAtCreation(tx, { businessId: business.id, now: new Date() });
        return business.id;
      });
      const full = await this.businessRepo.findById(businessId);
      if (!full) throw domainErrors.businessNotFound();
      return full;
    } catch (err) {
      if (isP2002(err)) throw domainErrors.slugConflict();
      throw err;
    }
  }

  async updateProfile(
    ctx: ActorContext,
    businessId: string,
    input: {
      name?: string;
      description?: string;
      address?: string;
      phonePublic?: string;
      categoryCode?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    if (input.latitude !== undefined) {
      if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
        throw domainErrors.invalidSchedule({ latitude: 'Latitude must be between -90 and 90.' });
      }
    }
    if (input.longitude !== undefined) {
      if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
        throw domainErrors.invalidSchedule({ longitude: 'Longitude must be between -180 and 180.' });
      }
    }
    return this.prisma.$transaction((tx) =>
      this.businessRepo.updateProfile(tx, { businessId, ...input }),
    );
  }

  async changeSlug(ctx: ActorContext, businessId: string, newSlug: string) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const slug = validateSlug(newSlug);
    try {
      return await withBusinessAdvisoryLock(this.prisma, businessId, (tx) =>
        this.businessRepo.changeSlug(tx, { businessId, publicSlug: slug }),
      );
    } catch (err) {
      if (isP2002(err)) throw domainErrors.slugConflict();
      throw err;
    }
  }

  async updateSettings(
    ctx: ActorContext,
    businessId: string,
    input: {
      bookingIntervalMinutes?: number;
      prepaymentMode?: 'NONE' | 'PERCENTAGE' | 'FIXED';
      prepaymentPercent?: number | null;
      prepaymentFixedMinor?: bigint | null;
    },
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    if (input.bookingIntervalMinutes !== undefined) {
      if (input.bookingIntervalMinutes <= 0 || input.bookingIntervalMinutes % 5 !== 0) {
        throw domainErrors.invalidSchedule({ bookingIntervalMinutes: 'Interval must be a positive multiple of 5.' });
      }
    }
    if (input.prepaymentMode === 'PERCENTAGE' && (input.prepaymentPercent == null || input.prepaymentPercent < 1 || input.prepaymentPercent > 100)) {
      throw domainErrors.invalidSchedule({ prepaymentPercent: 'Percentage must be 1–100.' });
    }
    if (input.prepaymentMode === 'FIXED' && (input.prepaymentFixedMinor == null || input.prepaymentFixedMinor < 0n)) {
      throw domainErrors.invalidSchedule({ prepaymentFixedMinor: 'Fixed prepayment must be non-negative.' });
    }
    return withBusinessAdvisoryLock(this.prisma, businessId, (tx) =>
      this.businessRepo.updateSettings(tx, { businessId, ...input }),
    );
  }

  async pause(ctx: ActorContext, businessId: string, input: { pauseMessage?: string | null; reopenAt?: Date | null }) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return withBusinessAdvisoryLock(this.prisma, businessId, (tx) =>
      this.businessRepo.setPaused(tx, { businessId, isPaused: true, pauseMessage: input.pauseMessage, reopenAt: input.reopenAt }),
    );
  }

  async resumeManual(ctx: ActorContext, businessId: string): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const sub = await this.subscriptionRepo.getByBusiness(businessId);
    if (!sub || sub.status === 'EXPIRED') {
      throw domainErrors.subscriptionDisabled('Cannot resume: the subscription is expired.');
    }
    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      await this.businessRepo.setPaused(tx, { businessId, isPaused: false, pauseMessage: null, reopenAt: null });
      await this.promoteLatestPending(tx as never as import('@prisma/client').Prisma.TransactionClient, businessId, ctx.actorUserId ?? 'system', 'Resumed by owner');
    });
  }

  async deactivate(ctx: ActorContext, businessId: string) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return withBusinessAdvisoryLock(this.prisma, businessId, (tx) =>
      this.businessRepo.setDeactivated(tx, { businessId, deactivatedAt: new Date() }),
    );
  }

  async reactivate(ctx: ActorContext, businessId: string) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return withBusinessAdvisoryLock(this.prisma, businessId, (tx) =>
      this.businessRepo.setDeactivated(tx, { businessId, deactivatedAt: null }),
    );
  }

  getBySlug(slug: string) {
    return this.businessRepo.findBySlug(slug);
  }

  getById(businessId: string) {
    return this.businessRepo.findById(businessId);
  }

  async listByOwner(ctx: ActorContext) {
    if (!isOwner(ctx) || !ctx.actorUserId) throw domainErrors.unauthorizedTenantAccess();
    return this.businessRepo.listByOwner(ctx.actorUserId);
  }

  /** Public profile composition (business + settings) for the public page. */
  async getPublicProfile(slug: string) {
    const business = await this.businessRepo.findBySlug(slug);
    if (!business) return null;
    const settings = await this.businessRepo.getSettings(business.id);
    return { business, settings };
  }

  /** Owner profile composition (business + settings) for owner management. */
  async getOwnedProfile(ctx: ActorContext, businessId: string) {
    const business = await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const settings = await this.businessRepo.getSettings(businessId);
    return { business, settings };
  }

  /** Owner businesses + settings for the owner dashboard list. */
  async listOwnedWithSettings(ctx: ActorContext): Promise<Array<{ business: BusinessWithOwner; settings: import('@prisma/client').BusinessSettings | null }>> {
    const businesses = await this.listByOwner(ctx);
    const withSettings = await Promise.all(
      businesses.map(async (business) => ({
        business,
        settings: await this.businessRepo.getSettings(business.id),
      })),
    );
    return withSettings;
  }

  private async promoteLatestPending(
    tx: import('@prisma/client').Prisma.TransactionClient,
    businessId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const pending = await this.scheduleRepo.listPendingVersions(businessId);
    if (pending.length === 0) return;
    const latest = pending[pending.length - 1];
    await this.scheduleRepo.demoteActiveVersions(tx, { businessId, replacedAt: new Date() });
    await this.scheduleRepo.promotePendingVersion(tx, {
      versionId: latest.id,
      businessId,
      appliedBy: actorId,
      reason,
    });
    await this.scheduleRepo.setBusinessActiveVersion(tx, { businessId, versionId: latest.id });
  }
}

function isP2002(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

export function validateSlug(slug: string): string {
  const s = slug.toLowerCase().trim();
  if (s.length < 2 || s.length > 64) {
    throw domainErrors.invalidSchedule({ publicSlug: 'Slug must be 2–64 characters.' });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
    throw domainErrors.invalidSchedule({ publicSlug: 'Slug may only contain lowercase letters, digits and hyphens.' });
  }
  if (RESERVED_SLUGS.has(s)) {
    throw domainErrors.invalidSchedule({ publicSlug: 'This slug is reserved.' });
  }
  return s;
}