import { Injectable } from '@nestjs/common';
import { ValidationException } from '../common/http/app-error';
import type { TenantTransaction } from '../database/tenant-executor';
import type { ServiceLineInput } from './booking-input';

export interface SnapshotLine {
  serviceId: string;
  nameSnapshot: string;
  unitPriceMinor: bigint;
  durationMinutes: number;
}

export interface Combination {
  lines: SnapshotLine[];
  totalPriceMinor: bigint;
  totalDurationMinutes: number;
}

/**
 * Resolves the selected services/variations/add-ons into immutable snapshot
 * lines and total price/duration (REQ-070, REQ-072–075).
 *
 * - Only active services are selectable (REQ-079).
 * - Variation must belong to its service and be active; required add-ons must
 *   belong to the service and be active.
 * - Effective per-line price/duration = base + variation delta + add-on deltas
 *   (REQ-071/072/073); totals are the sum (REQ-074/075).
 * - Line snapshots are written once inside the booking transaction and NEVER
 *   mutated (REQ-076/080) — the service catalog may change afterwards without
 *   rewriting history.
 */
@Injectable()
export class BookingPricingService {
  async resolveCombination(
    tx: TenantTransaction,
    businessId: string,
    services: ServiceLineInput[],
  ): Promise<Combination> {
    const serviceIds = Array.from(new Set(services.map((s) => s.serviceId)));
    const loaded = await tx.service.findMany({
      where: { id: { in: serviceIds }, businessId, isActive: true },
    });
    const byId = new Map(loaded.map((s) => [s.id, s]));

    const variationIds = Array.from(
      new Set(services.filter((s) => s.variationId).map((s) => s.variationId as string)),
    );
    const variations = variationIds.length
      ? await tx.serviceVariation.findMany({
          where: { id: { in: variationIds }, businessId, isActive: true },
        })
      : [];
    const variationByService = new Map(variations.map((v) => [`${v.serviceId}:${v.id}`, v]));
    const variationById = new Map(variations.map((v) => [v.id, v]));

    const addOnIds = Array.from(new Set(services.flatMap((s) => s.addOnIds)));
    const addOns = addOnIds.length
      ? await tx.addOn.findMany({
          where: { id: { in: addOnIds }, businessId, isActive: true },
        })
      : [];
    const addOnById = new Map(addOns.map((a) => [a.id, a]));

    const lines: SnapshotLine[] = [];
    let totalPriceMinor = 0n;
    let totalDurationMinutes = 0;

    for (const line of services) {
      const service = byId.get(line.serviceId);
      if (!service) {
        throw new ValidationException([
          { field: 'services', message: 'One or more selected services are unavailable.' },
        ]);
      }
      let priceMinor = service.basePriceMinor;
      let durationMinutes = service.baseDurationMinutes;

      if (line.variationId) {
        const variation = variationById.get(line.variationId);
        const belongs = variationByService.get(`${service.id}:${line.variationId}`);
        if (!variation || !belongs) {
          throw new ValidationException([
            {
              field: 'services',
              message: 'A selected option is unavailable for the chosen service.',
            },
          ]);
        }
        priceMinor += variation.priceDeltaMinor;
        durationMinutes += variation.durationDeltaMinutes;
      }

      for (const addOnId of line.addOnIds) {
        const addOn = addOnById.get(addOnId);
        if (!addOn || addOn.serviceId !== service.id) {
          throw new ValidationException([
            {
              field: 'services',
              message: 'A selected add-on is unavailable for the chosen service.',
            },
          ]);
        }
        priceMinor += addOn.priceDeltaMinor;
        durationMinutes += addOn.durationDeltaMinutes;
      }

      if (durationMinutes < 1) {
        throw new ValidationException([
          { field: 'services', message: 'A selected combination has an invalid duration.' },
        ]);
      }

      lines.push({
        serviceId: service.id,
        nameSnapshot: service.name,
        unitPriceMinor: priceMinor,
        durationMinutes,
      });
      totalPriceMinor += priceMinor;
      totalDurationMinutes += durationMinutes;
    }

    return { lines, totalPriceMinor, totalDurationMinutes };
  }
}
