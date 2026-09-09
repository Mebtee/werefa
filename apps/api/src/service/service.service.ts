import { Injectable } from '@nestjs/common';
import type { AddOn, Prisma, Service, ServiceVariation } from '@prisma/client';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '../common/http/app-error';
import { PrismaService } from '../database/prisma.service';
import {
  withOwnerBusinessContext,
  withPublicContext,
  type TenantTransaction,
} from '../database/tenant-executor';
import { SecurityEventService } from '../iam/security-events.service';
import { FutureBookingsSeam } from './future-bookings.seam';
import {
  parseAddOnInput,
  parseServiceInput,
  parseVariationInput,
  type ServiceDeltaInput,
} from './service-input';
import type { ServiceWithChildren } from './service.serializer';

/**
 * Service catalog service (Prompt 10, Domain 8 — Services/Pricing).
 *
 * Every tenant-scoped read/write runs inside a tenant-context transaction
 * (`withOwnerBusinessContext` = OWNER scope + SET LOCAL) — RLS is
 * defense-in-depth, never bypassed (doc 04 §4/§7). Ownership is asserted at
 * three layers: the TenantGuard (URL businessId ∈ actor.ownedBusinessIds), the
 * `businessId` filters on every query, and the transaction RLS window.
 *
 * Money is integer minor units (bigint in the store) and durations whole
 * minutes (REQ-226) — nothing floaty ever enters the domain. Name uniqueness
 * is per business (DB unique index); the public catalog exposure is exactly
 * active services/variations/add-ons (REQ-079/214).
 */
@Injectable()
export class ServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityEventService,
    private readonly futureBookings: FutureBookingsSeam,
  ) {}

  // -------------------------------------------------------------------------
  // Service lifecycle
  // -------------------------------------------------------------------------

  async create(
    actor: { userId: string },
    businessId: string,
    inputRaw: unknown,
  ): Promise<ServiceWithChildren> {
    const input = parseServiceInput(inputRaw, true);
    const created = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        try {
          const row = await tx.service.create({
            data: {
              businessId,
              name: input.name!,
              basePriceMinor: BigInt(input.basePriceMinor!),
              baseDurationMinutes: input.baseDurationMinutes!,
            },
          });
          return this.withChildren(tx, row);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException(
              'A service with this name already exists in this business.',
            );
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'SERVICE_CREATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return created;
  }

  async list(actor: { userId: string }, businessId: string): Promise<ServiceWithChildren[]> {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, (tx) =>
      tx.service
        .findMany({
          where: { businessId },
          include: { variations: true, addOns: true },
          orderBy: { createdAt: 'asc' },
        })
        .then((rows) => rows.map(childRows)),
    );
  }

  async get(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
  ): Promise<ServiceWithChildren> {
    return withOwnerBusinessContext(this.prisma, actor.userId, businessId, (tx) =>
      this.loadOwned(tx, businessId, serviceId),
    );
  }

  async update(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    inputRaw: unknown,
  ): Promise<ServiceWithChildren> {
    const input = parseServiceInput(inputRaw, false);
    const updated = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.service.findFirst({ where: { id: serviceId, businessId } }),
        );

        const nextBase =
          input.basePriceMinor !== undefined
            ? BigInt(input.basePriceMinor)
            : current.basePriceMinor;
        const nextDuration =
          input.baseDurationMinutes !== undefined
            ? input.baseDurationMinutes
            : current.baseDurationMinutes;
        if (input.basePriceMinor !== undefined || input.baseDurationMinutes !== undefined) {
          await this.assertVariationTotalsValid(tx, serviceId, nextBase, nextDuration);
        }

        const data: Prisma.ServiceUpdateInput = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.basePriceMinor !== undefined) data.basePriceMinor = BigInt(input.basePriceMinor);
        if (input.baseDurationMinutes !== undefined) {
          data.baseDurationMinutes = input.baseDurationMinutes;
        }
        try {
          const row = await tx.service.update({ where: { id: serviceId }, data });
          return this.withChildren(tx, row);
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException(
              'A service with this name already exists in this business.',
            );
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'SERVICE_UPDATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return updated;
  }

  /** Deactivate (REQ-078): retained, historical refs intact, excluded from new selection/public (REQ-079/080). */
  async deactivate(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
  ): Promise<ServiceWithChildren> {
    const row = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.service.findFirst({ where: { id: serviceId, businessId } }),
        );
        if (!current.isActive) {
          throw new ConflictException('This service is already deactivated.');
        }
        const updated = await tx.service.update({
          where: { id: serviceId },
          data: { isActive: false },
        });
        return this.withChildren(tx, updated);
      },
    );
    await this.security.record({
      type: 'SERVICE_DEACTIVATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return row;
  }

  /** Reactivate (REQ-081): back to new selection + public catalog (per later scheduling rules). */
  async reactivate(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
  ): Promise<ServiceWithChildren> {
    const row = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.service.findFirst({ where: { id: serviceId, businessId } }),
        );
        if (current.isActive) {
          throw new ConflictException('This service is not deactivated.');
        }
        const updated = await tx.service.update({
          where: { id: serviceId },
          data: { isActive: true },
        });
        return this.withChildren(tx, updated);
      },
    );
    await this.security.record({
      type: 'SERVICE_REACTIVATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return row;
  }

  /**
   * Hard delete (REQ-077): refused while future bookings exist (boundary seam),
   * allowed otherwise. Cascades to this service's variations/add-ons.
   */
  async remove(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
  ): Promise<ServiceWithChildren> {
    const blockers = await this.futureBookings.countFutureBookings(serviceId);
    if (blockers > 0) {
      await this.security.record({
        type: 'SERVICE_DELETE_BLOCKED',
        userId: actor.userId,
        businessId,
        result: 'DENIED',
      });
      throw new ConflictException(
        'This service has future bookings and cannot be permanently deleted; deactivate it instead.',
      );
    }
    const row = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = await this.loadOwned(tx, businessId, serviceId);
        await tx.service.delete({ where: { id: serviceId } });
        return current;
      },
    );
    await this.security.record({
      type: 'SERVICE_DELETE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return row;
  }

  // -------------------------------------------------------------------------
  // Service variations (REQ-072)
  // -------------------------------------------------------------------------

  async createVariation(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    inputRaw: unknown,
  ): Promise<ServiceVariation> {
    const input = parseVariationInput(inputRaw, { requireAll: true });
    const created = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const svc = await this.requireOwnedService(tx, businessId, serviceId);
        this.assertDeltasValid(svc, input);
        try {
          return await tx.serviceVariation.create({
            data: {
              serviceId,
              businessId,
              name: input.name!,
              priceDeltaMinor: BigInt(input.priceDeltaMinor!),
              durationDeltaMinutes: input.durationDeltaMinutes!,
            },
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException(
              'A variation with this name already exists on this service.',
            );
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'SERVICE_VARIATION_CREATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return created;
  }

  async updateVariation(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    variationId: string,
    inputRaw: unknown,
  ): Promise<ServiceVariation> {
    const input = parseVariationInput(inputRaw, { requireAll: false });
    const updated = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        const current = this.requireFound(
          await tx.serviceVariation.findFirst({
            where: { id: variationId, serviceId, businessId },
          }),
        );
        const svc = await this.requireOwnedService(tx, businessId, serviceId);
        const name = input.name ?? current.name;
        const priceDelta =
          input.priceDeltaMinor !== undefined
            ? BigInt(input.priceDeltaMinor)
            : current.priceDeltaMinor;
        const durationDelta =
          input.durationDeltaMinutes !== undefined
            ? input.durationDeltaMinutes
            : current.durationDeltaMinutes;
        this.assertDeltasValid(svc, {
          name,
          priceDeltaMinor: Number(priceDelta),
          durationDeltaMinutes: durationDelta,
        });
        const data: Prisma.ServiceVariationUpdateInput = {
          name,
          priceDeltaMinor: priceDelta,
          durationDeltaMinutes: durationDelta,
        };
        if (input.isActive !== undefined) data.isActive = input.isActive;
        try {
          return await tx.serviceVariation.update({
            where: { id: variationId },
            data,
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException(
              'A variation with this name already exists on this service.',
            );
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'SERVICE_VARIATION_UPDATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return updated;
  }

  async deleteVariation(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    variationId: string,
  ): Promise<ServiceVariation> {
    const [row] = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        await this.requireOwnedService(tx, businessId, serviceId);
        const current = this.requireFound(
          await tx.serviceVariation.findFirst({
            where: { id: variationId, serviceId, businessId },
          }),
        );
        await tx.serviceVariation.delete({ where: { id: variationId } });
        return [current];
      },
    );
    await this.security.record({
      type: 'SERVICE_VARIATION_DELETE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return row;
  }

  // -------------------------------------------------------------------------
  // Add-ons (REQ-073)
  // -------------------------------------------------------------------------

  async createAddOn(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    inputRaw: unknown,
  ): Promise<AddOn> {
    const input = parseAddOnInput(inputRaw, { requireAll: true });
    const created = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        await this.requireOwnedService(tx, businessId, serviceId);
        try {
          return await tx.addOn.create({
            data: {
              serviceId,
              businessId,
              name: input.name!,
              priceDeltaMinor: BigInt(input.priceDeltaMinor!),
              durationDeltaMinutes: input.durationDeltaMinutes!,
            },
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException('An add-on with this name already exists on this service.');
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'SERVICE_ADDON_CREATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return created;
  }

  async updateAddOn(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    addOnId: string,
    inputRaw: unknown,
  ): Promise<AddOn> {
    const input = parseAddOnInput(inputRaw, { requireAll: false });
    const updated = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        await this.requireOwnedService(tx, businessId, serviceId);
        const current = this.requireFound(
          await tx.addOn.findFirst({ where: { id: addOnId, serviceId, businessId } }),
        );
        const data: Prisma.AddOnUpdateInput = {
          name: input.name ?? current.name,
          priceDeltaMinor:
            input.priceDeltaMinor !== undefined
              ? BigInt(input.priceDeltaMinor)
              : current.priceDeltaMinor,
          durationDeltaMinutes:
            input.durationDeltaMinutes !== undefined
              ? input.durationDeltaMinutes
              : current.durationDeltaMinutes,
        };
        if (input.isActive !== undefined) data.isActive = input.isActive;
        try {
          return await tx.addOn.update({
            where: { id: addOnId },
            data,
          });
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw new ConflictException('An add-on with this name already exists on this service.');
          }
          throw err;
        }
      },
    );
    await this.security.record({
      type: 'SERVICE_ADDON_UPDATE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return updated;
  }

  async deleteAddOn(
    actor: { userId: string },
    businessId: string,
    serviceId: string,
    addOnId: string,
  ): Promise<AddOn> {
    const [row] = await withOwnerBusinessContext(
      this.prisma,
      actor.userId,
      businessId,
      async (tx) => {
        await this.requireOwnedService(tx, businessId, serviceId);
        const current = this.requireFound(
          await tx.addOn.findFirst({ where: { id: addOnId, serviceId, businessId } }),
        );
        await tx.addOn.delete({ where: { id: addOnId } });
        return [current];
      },
    );
    await this.security.record({
      type: 'SERVICE_ADDON_DELETE',
      userId: actor.userId,
      businessId,
      result: 'SUCCESS',
    });
    return row;
  }

  // -------------------------------------------------------------------------
  // Public catalog (REQ-079/214) — SELECT-only, PUBLIC scope
  // -------------------------------------------------------------------------

  /** Active services of the business the slug resolves (its active children incl.). */
  async listPublic(businessSlug: string): Promise<ServiceWithChildren[]> {
    return withPublicContext(this.prisma, async (tx) => {
      const business = await tx.business.findUnique({ where: { publicSlug: businessSlug } });
      if (!business) throw new NotFoundException('Business not found.');
      const rows = await tx.service.findMany({
        where: { businessId: business.id, isActive: true },
        include: {
          variations: { where: { isActive: true } },
          addOns: { where: { isActive: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(childRows);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async loadOwned(
    tx: TenantTransaction,
    businessId: string,
    serviceId: string,
  ): Promise<ServiceWithChildren> {
    const row = await tx.service.findFirst({ where: { id: serviceId, businessId } });
    if (!row) throw new NotFoundException('Service not found.');
    return this.withChildren(tx, row);
  }

  private async requireOwnedService(
    tx: TenantTransaction,
    businessId: string,
    serviceId: string,
  ): Promise<Service> {
    const row = await tx.service.findFirst({ where: { id: serviceId, businessId } });
    if (!row) throw new NotFoundException('Service not found.');
    return row;
  }

  private async withChildren(
    tx: TenantTransaction,
    service: Service,
  ): Promise<ServiceWithChildren> {
    const [variations, addOns] = await Promise.all([
      tx.serviceVariation.findMany({ where: { serviceId: service.id } }),
      tx.addOn.findMany({ where: { serviceId: service.id } }),
    ]);
    return { service, variations, addOns };
  }

  /**
   * Effective-total invariant for signed variation deltas (REQ-072 + REQ-071):
   * base + delta must stay >= 0 minor units and >= 1 minute. Enforced at the
   * app layer for variation create/update AND when the base price/duration is
   * edited (the DB cannot express the cross-row check).
   */
  private assertVariationTotalsValid(
    tx: TenantTransaction,
    serviceId: string,
    nextBase: bigint,
    nextDuration: number,
  ): Promise<void> {
    return tx.serviceVariation.findMany({ where: { serviceId } }).then((variations) => {
      for (const v of variations) {
        if (nextBase + v.priceDeltaMinor < 0n) {
          throw new ValidationException([
            {
              field: 'basePriceMinor',
              message: `Variation "${v.name}" would drop the effective price below 0.`,
            },
          ]);
        }
        if (nextDuration + v.durationDeltaMinutes < 1) {
          throw new ValidationException([
            {
              field: 'baseDurationMinutes',
              message: `Variation "${v.name}" would drop the effective duration below 1 minute.`,
            },
          ]);
        }
      }
    });
  }

  private assertDeltasValid(svc: Service, input: ServiceDeltaInput): void {
    const effectivePrice = svc.basePriceMinor + BigInt(input.priceDeltaMinor ?? 0);
    const effectiveDuration = svc.baseDurationMinutes + (input.durationDeltaMinutes ?? 0);
    if (effectivePrice < 0n) {
      throw new ValidationException([
        {
          field: 'priceDeltaMinor',
          message: 'The effective price (base + delta) cannot be negative.',
        },
      ]);
    }
    if (effectiveDuration < 1) {
      throw new ValidationException([
        {
          field: 'durationDeltaMinutes',
          message: 'The effective duration (base + delta) must be at least 1 minute.',
        },
      ]);
    }
  }

  private requireFound<T>(row: T | null): T {
    if (!row) throw new NotFoundException('Service not found.');
    return row;
  }
}

function childRows(
  row: Service & { variations: ServiceVariation[]; addOns: AddOn[] },
): ServiceWithChildren {
  return { service: row, variations: row.variations, addOns: row.addOns };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
