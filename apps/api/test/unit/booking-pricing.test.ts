import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@werefa/shared';
import { BookingPricingService } from '../../apps/api/src/booking/booking-pricing';
import type { TenantTransaction } from '../../apps/api/src/database/tenant-executor';
import type { ServiceLineInput } from '../../apps/api/src/booking/booking-input';

/**
 * Prompt 11 — REQ-070/072–075/079 pricing resolution into immutable snapshot
 * lines. Taps the service/catalog seams with in-memory rows so the pure
 * combination math (per-line price/duration + totals) is pinned without a DB.
 */

function service(id: string, name: string, basePriceMinor: bigint, baseDurationMinutes: number) {
  return {
    id,
    name,
    businessId: 'business-1',
    isActive: true,
    basePriceMinor,
    baseDurationMinutes,
  };
}

function variation(id: string, serviceId: string, priceDeltaMinor = 0n, durationDeltaMinutes = 0) {
  return {
    id,
    serviceId,
    businessId: 'business-1',
    isActive: true,
    priceDeltaMinor,
    durationDeltaMinutes,
  };
}

function addOn(id: string, serviceId: string, priceDeltaMinor = 0n, durationDeltaMinutes = 0) {
  return {
    id,
    serviceId,
    businessId: 'business-1',
    isActive: true,
    priceDeltaMinor,
    durationDeltaMinutes,
  };
}

function txMock(opts: {
  services?: ReturnType<typeof service>[];
  variations?: ReturnType<typeof variation>[];
  addOns?: ReturnType<typeof addOn>[];
}): TenantTransaction {
  const findMany = <T>(rows: T[]) => vi.fn(async () => rows as T[]);
  return {
    service: { findMany: findMany(opts.services ?? []) },
    serviceVariation: { findMany: findMany(opts.variations ?? []) },
    addOn: { findMany: findMany(opts.addOns ?? []) },
  } as unknown as TenantTransaction;
}

describe('BookingPricingService.resolveCombination', () => {
  it('computes per-line and total price/duration for multiple services (REQ-074/075)', async () => {
    const tx = txMock({
      services: [service('s1', 'Haircut', 300n, 30), service('s2', 'Beard trim', 150n, 15)],
    });
    const svc = new BookingPricingService();
    const input: ServiceLineInput[] = [
      { serviceId: 's1', addOnIds: [] },
      { serviceId: 's2', addOnIds: [] },
    ];

    const combo = await svc.resolveCombination(tx, 'business-1', input);

    expect(combo.lines).toEqual([
      { serviceId: 's1', nameSnapshot: 'Haircut', unitPriceMinor: 300n, durationMinutes: 30 },
      { serviceId: 's2', nameSnapshot: 'Beard trim', unitPriceMinor: 150n, durationMinutes: 15 },
    ]);
    expect(combo.totalPriceMinor).toBe(450n);
    expect(combo.totalDurationMinutes).toBe(45);
  });

  it('applies variation deltas and add-on deltas to the service base (REQ-071/072/073)', async () => {
    const tx = txMock({
      services: [service('s1', 'Cut', 300n, 30)],
      variations: [variation('v1', 's1', 100n, 15)],
      addOns: [addOn('a1', 's1', 50n, 5), addOn('a2', 's1', 20n, 10)],
    });
    const svc = new BookingPricingService();
    const input: ServiceLineInput[] = [
      { serviceId: 's1', variationId: 'v1', addOnIds: ['a1', 'a2'] },
    ];

    const combo = await svc.resolveCombination(tx, 'business-1', input);

    expect(combo.lines[0]).toEqual({
      serviceId: 's1',
      nameSnapshot: 'Cut',
      unitPriceMinor: 470n,
      durationMinutes: 60,
    });
    expect(combo.totalPriceMinor).toBe(470n);
    expect(combo.totalDurationMinutes).toBe(60);
  });

  it('snapshots catalog names, so later renames never rewrite a line', async () => {
    const tx = txMock({ services: [service('s1', 'Haircut Plus', 300n, 30)] });
    const svc = new BookingPricingService();
    const combo = await svc.resolveCombination(tx, 'business-1', [
      { serviceId: 's1', addOnIds: [] },
    ]);
    expect(combo.lines[0].nameSnapshot).toBe('Haircut Plus');
  });

  it('refuses services that are deactivated or belong to another business (REQ-079)', async () => {
    const tx = txMock({ services: [service('s1', 'Hidden', 100n, 10)] });
    const svc = new BookingPricingService();

    const err = await svc
      .resolveCombination(tx, 'business-1', [{ serviceId: 's2', addOnIds: [] }])
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect((err as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses a variation that does not belong to the service', async () => {
    const tx = txMock({
      services: [service('s1', 'Cut', 300n, 30)],
      variations: [variation('v1', 'other-service', 100n, 5)],
    });
    const svc = new BookingPricingService();
    const err = await svc
      .resolveCombination(tx, 'business-1', [{ serviceId: 's1', variationId: 'v1', addOnIds: [] }])
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((err as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses an add-on that does not belong to the service', async () => {
    const tx = txMock({
      services: [service('s1', 'Cut', 300n, 30)],
      addOns: [addOn('a1', 'other-service', 50n, 5)],
    });
    const svc = new BookingPricingService();
    const err = await svc
      .resolveCombination(tx, 'business-1', [{ serviceId: 's1', addOnIds: ['a1'] }])
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((err as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects a combination whose effective duration is invalid', async () => {
    const tx = txMock({
      services: [service('s1', 'Lunch special', 100n, 30)],
      variations: [variation('v1', 's1', 0n, -30)],
    });
    const svc = new BookingPricingService();
    const err = await svc
      .resolveCombination(tx, 'business-1', [{ serviceId: 's1', variationId: 'v1', addOnIds: [] }])
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((err as { code?: string }).code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});
