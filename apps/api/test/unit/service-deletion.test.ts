import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes, type ErrorCode } from '@werefa/shared';
import { ServiceService } from '../../apps/api/src/service/service.service';
import type { PrismaService } from '../../apps/api/src/database/prisma.service';
import type { SecurityEventService } from '../../apps/api/src/iam/security-events.service';
import type { FutureBookingsSeam } from '../../apps/api/src/service/future-bookings.seam';

/**
 * Prompt 10 — REQ-077 deletion-protection unit tests.
 *
 * Integration coverage for the hard-delete path is naturally limited because
 * the future-bookings seam honestly returns 0 (the booking store does not exist
 * yet). These unit tests pin the BEHAVIOR that is already implemented: when the
 * seam reports future bookings, `remove` MUST refuse the hard delete, record a
 * SERVICE_DELETE_BLOCKED event, and never touch the database.
 */
describe('ServiceService hard-delete protection (REQ-077)', () => {
  it('refuses deletion when the future-bookings seam reports bookings (S)', async () => {
    const recorded: Array<{ type: string; userId: string; businessId: string; result: string }> =
      [];
    const security = {
      record: async (input: {
        type: string;
        userId: string;
        businessId: string;
        result: string;
      }) => {
        recorded.push(input);
      },
    } as unknown as SecurityEventService;
    const prisma = {
      // The blocked path must never reach the tenant transaction.
      $transaction: vi.fn(() => {
        throw new Error('remove() must not open a DB transaction when deletion is blocked');
      }),
    } as unknown as PrismaService;
    const seam = {
      countFutureBookings: vi.fn().mockResolvedValue(2),
    } as unknown as FutureBookingsSeam;

    const svc = new ServiceService(prisma, security, seam);

    const err = await svc.remove({ userId: 'owner-a' }, 'business-1', 'service-1').then(
      () => null,
      (e: unknown) => e,
    );
    const typed = err as { code?: ErrorCode; httpStatus?: number; detail?: string | null };
    expect(err).not.toBeNull();
    expect(typed.code).toBe(ErrorCodes.CONFLICT);
    expect(typed.httpStatus).toBe(409);
    expect(String(typed.detail).toLowerCase()).toContain('future bookings');

    expect(seam.countFutureBookings).toHaveBeenCalledWith('service-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      type: 'SERVICE_DELETE_BLOCKED',
      userId: 'owner-a',
      businessId: 'business-1',
      result: 'DENIED',
    });
  });

  it('does not record SERVICE_DELETE_BLOCKED when no future bookings exist', async () => {
    const recorded: Array<{ type: string }> = [];
    const security = {
      record: async (input: { type: string }) => {
        recorded.push(input);
      },
    } as unknown as SecurityEventService;
    // With the seam returning 0 the DELETE_BLOCKED branch must not fire; the
    // fixture stops at the transaction boundary because the seam check happens
    // first — any DB access now would be the start of the delete path, which is
    // covered by the integration suite.
    const prisma = {
      $transaction: vi.fn(() => {
        throw new Error('unexpected transaction');
      }),
    } as unknown as PrismaService;
    const seam = {
      countFutureBookings: vi.fn().mockResolvedValue(0),
    } as unknown as FutureBookingsSeam;

    const svc = new ServiceService(prisma, security, seam);

    await expect(svc.remove({ userId: 'owner-a' }, 'business-1', 'service-1')).rejects.toThrow(
      'unexpected transaction',
    );
    expect(recorded).toHaveLength(0);
  });
});
