import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { CatalogService } from './catalog.service';

/**
 * CatalogService.validateCombinations coverage (Prompt 48). Only the prisma
 * seam is faked — TenantGuard/BookingRepository are untouched by this method.
 */

interface FakeService {
  id: string;
  businessId: string;
  isActive: boolean;
  name: string;
  basePriceMinor: bigint;
  baseDurationMinutes: number;
  variations: { id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number }[];
  addOns: { id: string; name: string; priceDeltaMinor: bigint; durationDeltaMinutes: number }[];
}

const svc = (id: string, businessId: string, overrides: Partial<FakeService> = {}): FakeService => ({
  id,
  businessId,
  isActive: true,
  name: `Service ${id}`,
  basePriceMinor: 10000n,
  baseDurationMinutes: 60,
  variations: [],
  addOns: [],
  ...overrides,
});

function makeCatalog(services: FakeService[]) {
  const prisma = {
    service: {
      findMany: async ({ where }: { where: { id?: { in: string[] }; businessId: string; isActive?: boolean } }) =>
        services.filter(
          (s) =>
            (where?.id?.in ?? [s.id]).includes(s.id) &&
            s.businessId === where.businessId &&
            (where?.isActive === undefined || s.isActive === where.isActive),
        ),
    },
  };
  return new CatalogService(prisma as never, {} as never, {} as never);
}

async function expectInactiveCode(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VALIDATION_ERROR');
    return;
  }
  throw new Error('expected VALIDATION_ERROR, but the call succeeded');
}

describe('CatalogService.validateCombinations', () => {
  const hair = svc('svc-hair', 'biz-a', { basePriceMinor: 10000n, baseDurationMinutes: 60 });
  const facial = svc('svc-facial', 'biz-a', { basePriceMinor: 15000n, baseDurationMinutes: 45 });

  it('resolves one selection to components and totals (REQ-074/076)', async () => {
    const catalog = makeCatalog([
      {
        ...hair,
        variations: [{ id: 'var-styling', name: 'Styling', priceDeltaMinor: 2000n, durationDeltaMinutes: 10 }],
        addOns: [{ id: 'add-wash', name: 'Wash', priceDeltaMinor: 1500n, durationDeltaMinutes: 5 }],
      },
    ]);
    const result = await catalog.validateCombinations('biz-a', [
      { serviceId: 'svc-hair', variationIds: ['var-styling'], addOnIds: ['add-wash'] },
    ]);
    expect(result.totalPriceMinor).toBe(13500n);
    expect(result.totalDurationMinutes).toBe(75);
    expect(result.components.map((c) => c.componentType)).toEqual(['SERVICE', 'VARIATION', 'ADD_ON']);
    expect(result.components.map((c) => String(c.unitPriceMinor))).toEqual(['10000', '2000', '1500']);
  });

  it('sums several services into one appointment duration (REQ-070)', async () => {
    const catalog = makeCatalog([hair, facial]);
    const result = await catalog.validateCombinations('biz-a', [
      { serviceId: 'svc-hair', variationIds: [], addOnIds: [] },
      { serviceId: 'svc-facial', variationIds: [], addOnIds: [] },
    ]);
    expect(result.totalPriceMinor).toBe(25000n);
    expect(result.totalDurationMinutes).toBe(105);
    expect(result.components).toHaveLength(2);
  });

  it('permits the same service chosen again in another selection (canon implies no prohibition)', async () => {
    const catalog = makeCatalog([hair]);
    const result = await catalog.validateCombinations('biz-a', [
      { serviceId: 'svc-hair' },
      { serviceId: 'svc-hair' },
    ]);
    expect(result.totalPriceMinor).toBe(20000n);
    expect(result.totalDurationMinutes).toBe(120);
    expect(result.components).toHaveLength(2);
  });

  it('rejects a duplicated variation within one selection', async () => {
    const catalog = makeCatalog([
      { ...hair, variations: [{ id: 'var-styling', name: 'Styling', priceDeltaMinor: 2000n, durationDeltaMinutes: 10 }] },
    ]);
    await expectInactiveCode(
      catalog.validateCombinations('biz-a', [{ serviceId: 'svc-hair', variationIds: ['var-styling', 'var-styling'] }]),
    );
  });

  it('rejects an inactive service', async () => {
    const catalog = makeCatalog([{ ...hair, isActive: false }]);
    await expectInactiveCode(catalog.validateCombinations('biz-a', [{ serviceId: 'svc-hair' }]));
  });

  it('rejects a variation absent from the active list (e.g. inactive)', async () => {
    const catalog = makeCatalog([
      { ...hair, variations: [{ id: 'var-styling', name: 'Styling', priceDeltaMinor: 2000n, durationDeltaMinutes: 10 }] },
    ]);
    await expectInactiveCode(catalog.validateCombinations('biz-a', [{ serviceId: 'svc-hair', variationIds: ['var-inactive'] }]));
  });

  it('rejects a service owned by another business (tenant isolation)', async () => {
    const catalog = makeCatalog([svc('svc-other', 'biz-b')]);
    await expectInactiveCode(catalog.validateCombinations('biz-a', [{ serviceId: 'svc-other' }]));
  });

  it('rejects an unknown service id', async () => {
    const catalog = makeCatalog([hair]);
    await expectInactiveCode(catalog.validateCombinations('biz-a', [{ serviceId: 'svc-nope' }]));
  });

  it('validateCombination delegates with identical results for a single selection', async () => {
    const catalog = makeCatalog([
      { ...hair, addOns: [{ id: 'add-wash', name: 'Wash', priceDeltaMinor: 1500n, durationDeltaMinutes: 5 }] },
    ]);
    const single = await catalog.validateCombination('biz-a', { serviceId: 'svc-hair', addOnIds: ['add-wash'] });
    const multi = await catalog.validateCombinations('biz-a', [{ serviceId: 'svc-hair', addOnIds: ['add-wash'] }]);
    expect(single.totalPriceMinor).toBe(multi.totalPriceMinor);
    expect(single.totalDurationMinutes).toBe(multi.totalDurationMinutes);
    expect(single.components).toEqual(multi.components);
  });
});