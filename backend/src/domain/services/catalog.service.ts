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
 * hard deletes — deactivation only; a service with future bookings cannot be
 * deactivated (REQ-077). `validateCombination` builds immutable component
 * snapshots for booking creation (REQ-074/076) and refuses inactive services.
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
    const hasFuture = await this.bookingRepo.hasServiceFutureBookings(businessId, serviceId);
    if (hasFuture) {
      throw domainErrors.invalidSchedule({ serviceId: 'Service cannot be deactivated because it has future bookings (REQ-077).' });
    }
    await withBusinessAdvisoryLock(this.prisma, businessId, async (tx) => {
      const updated = await tx.service.updateMany({ where: { id: serviceId, businessId, isActive: true }, data: { isActive: false } });
      if (updated.count !== 1) throw domainErrors.businessNotFound('Service not found.');
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

  /**
   * Validate a service/variation/addon combination and return immutable
   * component snapshots + totals (REQ-074/076). Inactive items are rejected.
   */
  async validateCombination(
    businessId: string,
    input: { serviceId: string; variationIds?: string[]; addOnIds?: string[] },
  ): Promise<{ components: BookingComponentInput[]; totalPriceMinor: bigint; totalDurationMinutes: number }> {
    const service = await this.prisma.service.findFirst({ where: { id: input.serviceId, businessId, isActive: true } });
    if (!service) throw domainErrors.inactiveService({ serviceId: 'Service is not active.' });

    const components: BookingComponentInput[] = [
      { serviceId: service.id, componentType: 'SERVICE', nameSnapshot: service.name, unitPriceMinor: service.basePriceMinor, durationMinutes: service.baseDurationMinutes },
    ];
    let total = service.basePriceMinor;
    let duration = service.baseDurationMinutes;

    const variationIds = input.variationIds ?? [];
    const addOnIds = input.addOnIds ?? [];
    if (variationIds.length > 0) {
      const vars = await this.prisma.serviceVariation.findMany({ where: { id: { in: variationIds }, serviceId: service.id, isActive: true } });
      if (vars.length !== variationIds.length) throw domainErrors.inactiveService({ variationIds: 'One or more variations are not active.' });
      for (const v of vars) {
        components.push({ serviceId: null, componentType: 'VARIATION', nameSnapshot: v.name, unitPriceMinor: v.priceDeltaMinor, durationMinutes: v.durationDeltaMinutes });
        total += v.priceDeltaMinor;
        duration += v.durationDeltaMinutes;
      }
    }
    if (addOnIds.length > 0) {
      const addons = await this.prisma.addOn.findMany({ where: { id: { in: addOnIds }, serviceId: service.id, isActive: true } });
      if (addons.length !== addOnIds.length) throw domainErrors.inactiveService({ addOnIds: 'One or more add-ons are not active.' });
      for (const a of addons) {
        components.push({ serviceId: null, componentType: 'ADD_ON', nameSnapshot: a.name, unitPriceMinor: a.priceDeltaMinor, durationMinutes: a.durationDeltaMinutes });
        total += a.priceDeltaMinor;
        duration += a.durationDeltaMinutes;
      }
    }
    if (duration <= 0) throw domainErrors.inactiveService({ duration: 'Selected combination has no duration.' });
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