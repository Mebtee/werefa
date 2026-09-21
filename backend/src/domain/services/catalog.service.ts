import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import { ActorContext } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { domainErrors } from '../errors/domain-errors';
import { BookingComponentInput } from '../repositories/booking.repository.port';
import { BookingRepository } from '../repositories/booking.repository.port';
import { BOOKING_REPOSITORY } from '../repositories/tokens';
import { withBusinessAdvisoryLock } from '../transactions/business-advisory-lock';

/**
 * Service catalog lifecycle (REQ-069 … REQ-081; Prompt 41 §6). Owner-scoped, no
 * hard deletes — services with future bookings refuse deletion (REQ-077) and
 * are deactivated instead (REQ-078). `validateCombination` builds immutable
 * component snapshots for booking creation (REQ-074/076) and refuses inactive
 * services.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(BOOKING_REPOSITORY) private readonly bookingRepo: BookingRepository,
    private readonly tenantGuard: TenantGuard,
  ) {}

  async createService(
    ctx: ActorContext,
    businessId: string,
    input: { name: string; basePriceMinor: bigint; baseDurationMinutes: number },
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    this.validateBaseInput(input);
    return withBusinessAdvisoryLock(this.prisma, businessId, (tx) =>
      tx.service.create({
        data: {
          businessId,
          name: input.name,
          basePriceMinor: input.basePriceMinor,
          baseDurationMinutes: input.baseDurationMinutes,
          isActive: true,
        },
      }),
    );
  }

  async createVariation(
    ctx: ActorContext,
    businessId: string,
    serviceId: string,
    input: { name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number },
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    if (input.name.length < 1 || input.name.length > 160) {
      throw domainErrors.invalidSchedule({ name: 'Name must be 1–160 characters.' });
    }
    if (input.priceDeltaMinor < 0n || input.durationDeltaMinutes < 0) {
      throw domainErrors.invalidSchedule({ priceDeltaMinor: 'Deltas must be non-negative (Δ relative to base).' });
    }
    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const svc = await tx.service.findFirst({ where: { id: serviceId, businessId } });
      if (!svc) throw domainErrors.businessNotFound('Service not found.');
      return tx.serviceVariation.create({
        data: { businessId, serviceId, name: input.name, priceDeltaMinor: input.priceDeltaMinor, durationDeltaMinutes: input.durationDeltaMinutes, isActive: true },
      });
    });
  }

  async createAddOn(
    ctx: ActorContext,
    businessId: string,
    serviceId: string,
    input: { name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number },
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    if (input.name.length < 1 || input.name.length > 160) {
      throw domainErrors.invalidSchedule({ name: 'Name must be 1–160 characters.' });
    }
    if (input.priceDeltaMinor < 0n || input.durationDeltaMinutes < 0) {
      throw domainErrors.invalidSchedule({ priceDeltaMinor: 'Deltas must be non-negative.' });
    }
    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const svc = await tx.service.findFirst({ where: { id: serviceId, businessId } });
      if (!svc) throw domainErrors.businessNotFound('Service not found.');
      return tx.addOn.create({
        data: { businessId, serviceId, name: input.name, priceDeltaMinor: input.priceDeltaMinor, durationDeltaMinutes: input.durationDeltaMinutes, isActive: true },
      });
    });
  }

  async updateService(
    ctx: ActorContext,
    businessId: string,
    serviceId: string,
    input: { name?: string; basePriceMinor?: bigint; baseDurationMinutes?: number },
  ) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    if (input.basePriceMinor !== undefined && input.basePriceMinor < 0n) {
      throw domainErrors.invalidSchedule({ basePriceMinor: 'Price must be non-negative.' });
    }
    if (input.baseDurationMinutes !== undefined && input.baseDurationMinutes <= 0) {
      throw domainErrors.invalidSchedule({ baseDurationMinutes: 'Duration must be positive.' });
    }
    return withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const updated = await tx.service.updateMany({
        where: { id: serviceId, businessId },
        data: { name: input.name, basePriceMinor: input.basePriceMinor, baseDurationMinutes: input.baseDurationMinutes },
      });
      if (updated.count !== 1) throw domainErrors.businessNotFound('Service not found.');
      return tx.service.findUniqueOrThrow({ where: { id: serviceId } });
    });
  }

  async deactivateService(ctx: ActorContext, businessId: string, serviceId: string): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    // REQ-078: a service with future bookings is deactivated instead of deleted.
    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const updated = await tx.service.updateMany({ where: { id: serviceId, businessId, isActive: true }, data: { isActive: false } });
      if (updated.count !== 1) throw domainErrors.businessNotFound('Service not found.');
    });
  }

  /**
   * REQ-077: hard deletion is refused while the service still has future
   * bookings — deactivate instead. Not exposed over HTTP; owners only see the
   * activate/deactivate path in the UI.
   */
  async deleteService(ctx: ActorContext, businessId: string, serviceId: string): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    const hasFutureBookings = await this.bookingRepo.hasServiceFutureBookings(businessId, serviceId);
    if (hasFutureBookings) {
      throw domainErrors.invalidSchedule({
        serviceId: 'Service has future bookings and cannot be deleted (REQ-077). Deactivate it instead.',
      });
    }
    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      // Variations/add-ons only exist while the service exists; booking history
      // references are kept via component snapshots (serviceId SetNull).
      await tx.addOn.deleteMany({ where: { businessId, serviceId } });
      await tx.serviceVariation.deleteMany({ where: { businessId, serviceId } });
      const deleted = await tx.service.deleteMany({ where: { id: serviceId, businessId } });
      if (deleted.count !== 1) throw domainErrors.businessNotFound('Service not found.');
    });
  }

  async reactivateService(ctx: ActorContext, businessId: string, serviceId: string): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const updated = await tx.service.updateMany({ where: { id: serviceId, businessId, isActive: false }, data: { isActive: true } });
      if (updated.count !== 1) throw domainErrors.businessNotFound('Service not found.');
    });
  }

  /** Active services for the public page (REQ-079: inactive hidden). */
  async listActiveServices(businessId: string) {
    return this.prisma.service.findMany({
      where: { businessId, isActive: true },
      include: { variations: { where: { isActive: true } }, addOns: { where: { isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** All services (incl. inactive) for owner management (REQ-079 owner sees all). */
  async listServicesForOwner(ctx: ActorContext, businessId: string) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.prisma.service.findMany({
      where: { businessId },
      include: { variations: true, addOns: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Single service (owner incl. inactive) with variations/add-ons. */
  async getServiceForOwner(ctx: ActorContext, businessId: string, serviceId: string) {
    await this.tenantGuard.requireOwnedBusiness(ctx, businessId);
    return this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
      include: { variations: true, addOns: true },
    });
  }

  /**
   * Validate a service/variation/addon combination and return immutable
   * component snapshots + totals (REQ-074/076). Inactive items are rejected.
   */
  async validateCombination(
    businessId: string,
    input: { serviceId: string; variationIds?: string[]; addOnIds?: string[] },
  ): Promise<{ components: BookingComponentInput[]; totalPriceMinor: bigint; totalDurationMinutes: number }> {
    return this.validateCombinations(businessId, [input]);
  }

  /**
   * Multi-selection validation (REQ-070): an appointment may span several
   * services, each with its own variation/add-ons. All active services are read
   * in one round trip and every selection is resolved against them. Duplicates
   * *within* one selection are rejected (existing single-combination semantics);
   * the same service chosen again in a *different* selection is allowed — the
   * canon (REQ-070 · REQ-074) implies no prohibition and duration/price simply
   * accumulate. Returns immutable component snapshots + appointment totals.
   */
  async validateCombinations(
    businessId: string,
    selections: { serviceId: string; variationIds?: string[]; addOnIds?: string[] }[],
  ): Promise<{ components: BookingComponentInput[]; totalPriceMinor: bigint; totalDurationMinutes: number }> {
    const services = await this.prisma.service.findMany({
      where: { id: { in: selections.map((s) => s.serviceId) }, businessId, isActive: true },
      include: { variations: { where: { isActive: true } }, addOns: { where: { isActive: true } } },
    });
    const byId = new Map(services.map((s) => [s.id, s]));

    const components: BookingComponentInput[] = [];
    let total = 0n;
    let duration = 0;

    for (const sel of selections) {
      const service = byId.get(sel.serviceId);
      if (!service) throw domainErrors.inactiveService({ serviceId: 'Service is not active.' });

      components.push({ serviceId: service.id, componentType: 'SERVICE', nameSnapshot: service.name, unitPriceMinor: service.basePriceMinor, durationMinutes: service.baseDurationMinutes });
      total += service.basePriceMinor;
      duration += service.baseDurationMinutes;

      const variationIds = sel.variationIds ?? [];
      const addOnIds = sel.addOnIds ?? [];
      if (variationIds.length > 0) {
        const vars = service.variations.filter((v) => variationIds.includes(v.id));
        if (vars.length !== variationIds.length) throw domainErrors.inactiveService({ variationIds: 'One or more variations are not active.' });
        for (const v of vars) {
          components.push({ serviceId: null, componentType: 'VARIATION', nameSnapshot: v.name, unitPriceMinor: v.priceDeltaMinor, durationMinutes: v.durationDeltaMinutes });
          total += v.priceDeltaMinor;
          duration += v.durationDeltaMinutes;
        }
      }
      if (addOnIds.length > 0) {
        const addons = service.addOns.filter((a) => addOnIds.includes(a.id));
        if (addons.length !== addOnIds.length) throw domainErrors.inactiveService({ addOnIds: 'One or more add-ons are not active.' });
        for (const a of addons) {
          components.push({ serviceId: null, componentType: 'ADD_ON', nameSnapshot: a.name, unitPriceMinor: a.priceDeltaMinor, durationMinutes: a.durationDeltaMinutes });
          total += a.priceDeltaMinor;
          duration += a.durationDeltaMinutes;
        }
      }
      if (duration <= 0) throw domainErrors.inactiveService({ duration: 'Selected combination has no duration.' });
    }
    return { components, totalPriceMinor: total, totalDurationMinutes: duration };
  }

  private validateBaseInput(input: { name: string; basePriceMinor: bigint; baseDurationMinutes: number }): void {
    const fields: Record<string, string> = {};
    if (!input.name || input.name.length < 1 || input.name.length > 160) fields.name = 'Name must be 1–160 characters.';
    if (input.basePriceMinor < 0n) fields.basePriceMinor = 'Price must be non-negative.';
    if (input.baseDurationMinutes <= 0 || input.baseDurationMinutes % 1 !== 0) fields.baseDurationMinutes = 'Duration must be a positive whole minute.';
    if (Object.keys(fields).length > 0) throw domainErrors.invalidSchedule(fields);
  }
}