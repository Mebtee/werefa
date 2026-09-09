import { Injectable } from '@nestjs/common';
import type { Business, Prisma } from '@prisma/client';
import { ErrorCodes, MAX_UPLOAD_BYTES } from '@werefa/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  withOwnerBusinessContext,
  withPublicContext,
  withTenantContext,
  withSuperAdminContext,
  type TenantTransaction,
} from '../database/tenant-executor';
import {
  AppException,
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../common/http/app-error';
import { SecurityEventService } from '../iam/security-events.service';
import { StorageService } from '../storage/storage.service';
import { SubscriptionAvailabilityService } from '../subscription/subscription-availability.service';
import { BusinessSerializer } from './business.serializer';
import { parseBusinessProfile, parsePauseInput, type BusinessProfileInput } from './business-input';
import { ScheduleService } from '../schedule/schedule.service';
import { withBusinessAdvisoryLock, withOwnerBookingLock } from '../booking/booking-lock';

type MediaKind = 'LOGO' | 'COVER';

const MEDIA_MIME_ALLOWLIST = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SLUG_ATTEMPTS = 12;

/**
 * Business & tenant management service (Prompt 09).
 *
 * Every tenant-scoped read/write runs inside a tenant-context transaction
 * (`withTenantContext` + SET LOCAL) — RLS is defense-in-depth, never bypassed
 * (doc 04 §4/§7). Ownership scoping is applied at two layers: the TenantGuard
 * (URL businessId vs ActorContext.ownedBusinessIds) and the transaction RLS
 * window itself.
 */
@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityEventService,
    private readonly storage: StorageService,
    private readonly subscription: SubscriptionAvailabilityService,
    private readonly serializer: BusinessSerializer,
    private readonly schedule: ScheduleService,
  ) {}

  // -------------------------------------------------------------------------
  // Owner flows
  // -------------------------------------------------------------------------

  async create(actor: { userId: string }, inputRaw: unknown): Promise<{ business: Business }> {
    const input = parseBusinessProfile(inputRaw, { requireName: true });
    const baseSlug = input.publicSlug;

    const created = await this.createWithUniqueSlug(actor, input, baseSlug);
    await this.security.record({
      type: 'BUSINESS_CREATE',
      userId: actor.userId,
      businessId: created.id,
      result: 'SUCCESS',
    });
    return { business: created };
  }

  async listOwned(actor: { userId: string; ownedBusinessIds: string[] }): Promise<Business[]> {
    if (actor.ownedBusinessIds.length === 0) return [];
    return withTenantContext(this.prisma, { userId: actor.userId, scope: 'OWNER' }, (tx) =>
      tx.business.findMany({
        where: { id: { in: actor.ownedBusinessIds } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async getOwned(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await withOwnerBusinessContext(this.prisma, actor.userId, businessId, (tx) =>
      tx.business.findUnique({ where: { id: businessId } }),
    );
    return this.requireFound(business);
  }

  async update(
    actor: { userId: string },
    businessId: string,
    inputRaw: unknown,
  ): Promise<Business> {
    const input = parseBusinessProfile(inputRaw, { requireName: false });
    const business = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );

        const nextSlug =
          input.publicSlug && input.publicSlug !== current.publicSlug
            ? input.publicSlug
            : undefined;
        if (nextSlug) {
          const taken = await tx.business.findUnique({ where: { publicSlug: nextSlug } });
          if (taken && taken.id !== businessId) {
            throw new ConflictException('This public slug is already in use by another business.');
          }
        }

        try {
          const updated = await tx.business.update({
            where: { id: businessId },
            data: distinctData(profileUpdateData(input, current)),
          });
          return updated;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException('This public slug is already in use by another business.');
          }
          throw err;
        }
      },
    );

    await this.security.record({
      type: 'BUSINESS_UPDATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  /** Pause bookings — indefinite or with an automatic resume date (REQ-143/144). */
  async pause(actor: { userId: string }, businessId: string, inputRaw: unknown): Promise<Business> {
    const input = parsePauseInput(inputRaw);
    const business = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        if (current.deactivatedAt) {
          throw new ConflictException('Deactivated businesses cannot be paused; reactivate first.');
        }
        // Resume date = optional `until`; absent → pauses indefinitely (REQ-156).
        return tx.business.update({
          where: { id: businessId },
          data: {
            isPaused: true,
            pausedUntil: input.until ?? null,
            pauseMessage: input.message ?? current.pauseMessage,
          },
        });
      },
    );

    await this.security.record({
      type: 'BUSINESS_PAUSE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  /**
   * Manual resume — immediate open when the subscription is active (REQ-157).
   * Runs under the per-business advisory lock and activates the LATEST pending
   * schedule version (REQ-151): the change made while paused becomes active,
   * affected bookings are surfaced via the grouped SCHEDULE notification, and
   * availability re-computes against the new schedule (REQ-158).
   */
  async resume(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await withOwnerBookingLock(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );

        if (current.deactivatedAt) {
          throw new ConflictException(
            'This business is deactivated; reactivate it to reopen bookings.',
          );
        }
        if (!current.isPaused) {
          throw new ConflictException('This business is not paused.');
        }
        this.assertSubscriptionAllowsBookings(current);
        const updated = await tx.business.update({
          where: { id: businessId },
          data: { isPaused: false, pausedUntil: null, pauseMessage: null },
        });
        await this.schedule.activatePendingSchedule(tx, businessId, {
          actorType: 'OWNER',
          actorUserId: actor.userId,
        });
        return updated;
      },
    );

    await this.security.record({
      type: 'BUSINESS_RESUME',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  /** Deactivate/close (not delete) — owner keeps dashboard access (REQ-216, REQ-023). */
  async deactivate(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        if (current.deactivatedAt) {
          throw new ConflictException('This business is already deactivated.');
        }
        return tx.business.update({
          where: { id: businessId },
          data: { deactivatedAt: new Date(), isPaused: true, pausedUntil: null },
        });
      },
    );

    await this.security.record({
      type: 'BUSINESS_DEACTIVATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  /** Reactivate — bookings reopen immediately if the subscription is active (REQ-216 AC2). A pending schedule version made during deactivation activates here. */
  async reactivate(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await withOwnerBookingLock(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        if (!current.deactivatedAt) {
          throw new ConflictException('This business is not deactivated.');
        }
        this.assertSubscriptionAllowsBookings(current);
        const updated = await tx.business.update({
          where: { id: businessId },
          data: { deactivatedAt: null, isPaused: false, pausedUntil: null, pauseMessage: null },
        });
        await this.schedule.activatePendingSchedule(tx, businessId, {
          actorType: 'OWNER',
          actorUserId: actor.userId,
        });
        return updated;
      },
    );

    await this.security.record({
      type: 'BUSINESS_REACTIVATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  /** Remember the active business on the session (REQ-016/017/019/021). */
  async selectContext(
    actor: { sessionId: string; userId: string },
    businessId: string,
  ): Promise<{ activeBusinessId: string }> {
    await this.prisma.session.update({
      where: { id: actor.sessionId },
      data: { activeBusinessId: businessId },
    });
    await this.security.record({
      type: 'BUSINESS_SELECT',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return { activeBusinessId: businessId };
  }

  /**
   * Upload the single logo or cover photo (REQ-208). Replaces the previous
   * object (best-effort delete of the old key after commit).
   */
  async uploadMedia(
    actor: { userId: string },
    businessId: string,
    kind: MediaKind,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<Business> {
    if (!file) {
      throw new ValidationException([{ field: 'file', message: 'A file is required.' }]);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppException(ErrorCodes.FILE_TOO_LARGE, 413, 'File too large. Max 10 MB.');
    }
    if (!MEDIA_MIME_ALLOWLIST.has(file.mimetype)) {
      throw new AppException(
        ErrorCodes.FILE_TYPE_INVALID,
        400,
        'Unsupported file type. Use PNG, JPEG or WebP.',
      );
    }

    const stored = await this.storage.put(businessId, kind, file.buffer, file.mimetype);
    let oldKey: string | null = null;

    const business = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        oldKey = (kind === 'LOGO' ? current.logoKey : current.coverKey) ?? null;
        return tx.business.update({
          where: { id: businessId },
          data:
            kind === 'LOGO'
              ? { logoKey: stored.key, logoMime: file.mimetype }
              : { coverKey: stored.key, coverMime: file.mimetype },
        });
      },
    );

    if (oldKey) {
      await this.storage.delete(oldKey).catch(() => undefined);
    }
    await this.security.record({
      type: 'BUSINESS_MEDIA_UPLOAD',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  // -------------------------------------------------------------------------
  // Scheduled / automatic resume (REQ-153/154/155/156) — system actor (REQ-044)
  // -------------------------------------------------------------------------

  /**
   * Every-minute sweep: businesses paused with a resume date that has arrived
   * are automatically resumed only when the subscription is active. When the
   * subscription is not active the pause is kept and the denied attempt is
   * recorded (REQ-154 AC2 — the recorded event never implies availability).
   * Indefinite pauses (no resume date) are never auto-resumed (REQ-156).
   */
  async autoResumeDueBusinesses(): Promise<{ resumed: number; denied: number }> {
    const now = new Date();
    const due = await withSuperAdminContext(this.prisma, SYSTEM_ACTOR_ID, (tx) =>
      tx.business.findMany({
        where: { isPaused: true, pausedUntil: { not: null, lte: now }, deactivatedAt: null },
        select: { id: true, trialEndsAt: true },
      }),
    );

    let resumed = 0;
    let denied = 0;
    for (const row of due) {
      const avail = this.subscription.computeAvailability(row.trialEndsAt ?? null);
      if (avail.canAcceptBookings) {
        await withTenantContext(
          this.prisma,
          { scope: 'SUPER_ADMIN', userId: SYSTEM_ACTOR_ID },
          (tx) =>
            withBusinessAdvisoryLock(tx, row.id, async () => {
              await tx.business.updateMany({
                where: { id: row.id, isPaused: true },
                data: { isPaused: false, pausedUntil: null },
              });
              // Latest PENDING schedule (created while paused) becomes ACTIVE
              // and any affected bookings are surfaced (REQ-151/158).
              await this.schedule.activatePendingSchedule(tx, row.id, {
                actorType: 'SYSTEM',
                actorUserId: SYSTEM_ACTOR_ID,
              });
            }),
        );
        resumed += 1;
        await this.security.record({
          type: 'BUSINESS_AUTO_RESUME',
          businessId: row.id,
          result: 'SUCCESS',
        });
      } else {
        denied += 1;
        await this.security.record({
          type: 'BUSINESS_AUTO_RESUME_DENIED',
          businessId: row.id,
          result: 'DENIED',
        });
      }
    }
    return { resumed, denied };
  }

  // -------------------------------------------------------------------------
  // Admin / Super Admin platform access (REQ-041)
  // -------------------------------------------------------------------------

  async adminList(
    actor: { userId: string },
    opts: { search?: string } = {},
  ): Promise<BusinessAdminRow[]> {
    const where: Prisma.BusinessWhereInput = {};
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { publicSlug: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    const rows = await withTenantContext(
      this.prisma,
      { userId: actor.userId, scope: 'SUPER_ADMIN' },
      async (tx) => {
        const businesses = await tx.business.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        const ids = businesses.map((b) => b.id);
        const owners = await tx.businessOwner.findMany({
          where: { businessId: { in: ids } },
        });
        const emails = await tx.user.findMany({
          where: { id: { in: owners.map((o) => o.userId) } },
          select: { id: true, email: true },
        });
        const emailByUserId = new Map(emails.map((u) => [u.id, u.email]));
        return businesses.map((b) => ({
          business: b,
          owner: owners
            .filter((o) => o.businessId === b.id)
            .map((o) => ({ userId: o.userId, email: emailByUserId.get(o.userId) ?? null })),
        }));
      },
    );
    return rows.map((r) => ({
      business: r.business,
      owner: r.owner[0] ?? null,
    }));
  }

  async adminGet(actor: { userId: string }, businessId: string): Promise<BusinessAdminRow> {
    return withTenantContext(
      this.prisma,
      { userId: actor.userId, scope: 'SUPER_ADMIN' },
      async (tx) => {
        const business = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        const owners = await tx.businessOwner.findMany({ where: { businessId } });
        const emailByUserId = new Map<string, string>();
        if (owners.length > 0) {
          const users = await tx.user.findMany({
            where: { id: { in: owners.map((o) => o.userId) } },
            select: { id: true, email: true },
          });
          users.forEach((u) => emailByUserId.set(u.id, u.email));
        }
        return {
          business,
          owner: owners[0]
            ? { userId: owners[0].userId, email: emailByUserId.get(owners[0].userId) ?? null }
            : null,
        };
      },
    );
  }

  async adminUpdate(
    actor: { userId: string },
    businessId: string,
    inputRaw: unknown,
  ): Promise<Business> {
    const input = parseBusinessProfile(inputRaw, { requireName: false });
    const business = await withTenantContext(
      this.prisma,
      { userId: actor.userId, scope: 'SUPER_ADMIN' },
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        try {
          return await tx.business.update({
            where: { id: businessId },
            data: distinctData(profileUpdateData(input, current)),
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException('This public slug is already in use by another business.');
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'BUSINESS_ADMIN_UPDATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  async adminDeactivate(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await this.adminLifecycleUpdate(actor, businessId, (tx, current) => {
      if (current.deactivatedAt) {
        throw new ConflictException('This business is already deactivated.');
      }
      return tx.business.update({
        where: { id: businessId },
        data: { deactivatedAt: new Date(), isPaused: true, pausedUntil: null },
      });
    });
    await this.security.record({
      type: 'BUSINESS_DEACTIVATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  async adminReactivate(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await this.adminLifecycleUpdate(actor, businessId, async (tx, current) => {
      if (!current.deactivatedAt) {
        throw new ConflictException('This business is not deactivated.');
      }
      this.assertSubscriptionAllowsBookings(current);
      return tx.business.update({
        where: { id: businessId },
        data: { deactivatedAt: null, isPaused: false, pausedUntil: null, pauseMessage: null },
      });
    });
    await this.security.record({
      type: 'BUSINESS_REACTIVATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  async adminPause(
    actor: { userId: string },
    businessId: string,
    inputRaw: unknown,
  ): Promise<Business> {
    const input = parsePauseInput(inputRaw);
    const business = await this.adminLifecycleUpdate(actor, businessId, (tx, current) => {
      if (current.deactivatedAt) {
        throw new ConflictException('Deactivated businesses cannot be paused; reactivate first.');
      }
      return tx.business.update({
        where: { id: businessId },
        data: {
          isPaused: true,
          pausedUntil: input.until ?? null,
          pauseMessage: input.message ?? current.pauseMessage,
        },
      });
    });
    await this.security.record({
      type: 'BUSINESS_PAUSE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  async adminResume(actor: { userId: string }, businessId: string): Promise<Business> {
    const business = await this.adminLifecycleUpdate(actor, businessId, async (tx, current) => {
      if (current.deactivatedAt) {
        throw new ConflictException('Deactivated businesses cannot be resumed; reactivate first.');
      }
      if (!current.isPaused) {
        throw new ConflictException('This business is not paused.');
      }
      this.assertSubscriptionAllowsBookings(current);
      return tx.business.update({
        where: { id: businessId },
        data: { isPaused: false, pausedUntil: null, pauseMessage: null },
      });
    });
    await this.security.record({
      type: 'BUSINESS_RESUME',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return business;
  }

  // -------------------------------------------------------------------------
  // Public read paths (also used for media serving)
  // -------------------------------------------------------------------------

  async findBySlug(slug: string): Promise<Business> {
    const business = await withPublicContext(this.prisma, (tx) =>
      tx.business.findUnique({ where: { publicSlug: slug } }),
    );
    return this.requireFound(business);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createWithUniqueSlug(
    actor: { userId: string },
    input: BusinessProfileInput,
    baseSlug: string | undefined,
  ): Promise<Business> {
    const basis = baseSlug ?? slugFromName(input.name);
    const attempt = async (n: number): Promise<Business> => {
      const candidate = n === 1 ? basis : `${basis}-${n}`;
      // The business id is issued by the app so the creation transaction can
      // set app.business_id to the NEW row: INSERT…RETURNING (Prisma) must be
      // able to project the just-created row back, which RLS gates through the
      // SELECT policy (see rls.sql "business_owner_select").
      const pendingId = randomUUID();
      try {
        return await withTenantContext(
          this.prisma,
          { userId: actor.userId, businessId: pendingId, scope: 'OWNER', creating: true },
          async (tx) => {
            const created = await tx.business.create({
              data: {
                id: pendingId,
                name: input.name,
                publicSlug: candidate,
                category: input.category,
                description: input.description,
                phone: input.phone,
                contactEmail: input.contactEmail,
                address: input.address,
                latitude: input.latitude,
                longitude: input.longitude,
                googleMapsLink: input.googleMapsLink,
                openStreetMapLink: input.openStreetMapLink,
                trialEndsAt: new Date(
                  Date.now() + SubscriptionAvailabilityService.TRIAL_DAYS * 86_400_000,
                ),
              },
            });
            await tx.businessOwner.create({
              data: { businessId: created.id, userId: actor.userId },
            });
            return created;
          },
        );
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (baseSlug) {
          throw new ConflictException('This public slug is already in use by another business.');
        }
        if (n >= SLUG_ATTEMPTS) {
          throw new ConflictException('Unable to allocate a unique public slug.');
        }
        return attempt(n + 1);
      }
    };
    return attempt(1);
  }

  private assertSubscriptionAllowsBookings(business: Pick<Business, 'trialEndsAt'>): void {
    const avail = this.subscription.computeAvailability(business.trialEndsAt ?? null);
    if (!avail.canAcceptBookings) {
      throw new AppException(
        ErrorCodes.SUBSCRIPTION_EXPIRED,
        402,
        'Business subscription is not active.',
        { detail: avail.reason ?? null },
      );
    }
  }

  private adminLifecycleUpdate(
    actor: { userId: string },
    businessId: string,
    fn: (tx: TenantTransaction, current: Business) => Promise<Business> | Business,
  ): Promise<Business> {
    return withTenantContext(
      this.prisma,
      { userId: actor.userId, scope: 'SUPER_ADMIN' },
      async (tx) => {
        const current = this.requireFound(
          await tx.business.findUnique({ where: { id: businessId } }),
        );
        return fn(tx, current);
      },
    );
  }

  private requireFound<T>(row: T | null): T {
    if (!row) throw new NotFoundException('Business not found.');
    return row;
  }
}

export interface BusinessAdminRow {
  business: Business;
  owner: { userId: string; email: string | null } | null;
}

/** System actor for automatic/platform changes (REQ-044). */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return base || `business-${randomUUID().slice(0, 8)}`;
}

function profileUpdateData(
  input: BusinessProfileInput,
  current: Business,
): Prisma.BusinessUpdateInput {
  return {
    name: input.name !== undefined && input.name !== '' ? input.name : current.name,
    publicSlug: input.publicSlug ?? current.publicSlug,
    category: input.category ?? current.category,
    description: input.description ?? current.description,
    phone: input.phone ?? current.phone,
    contactEmail: input.contactEmail ?? current.contactEmail,
    address: input.address ?? current.address,
    latitude: input.latitude ?? current.latitude,
    longitude: input.longitude ?? current.longitude,
    googleMapsLink: input.googleMapsLink ?? current.googleMapsLink,
    openStreetMapLink: input.openStreetMapLink ?? current.openStreetMapLink,
  };
}

/** Drop explicitly-undefined keys so Prisma ignores absent fields. */
function distinctData<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
