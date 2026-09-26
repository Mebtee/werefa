import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { BusinessRepository } from '../repositories/business.repository.port';
import type { BookingRepository } from '../repositories/booking.repository.port';
import type { PaymentRepository } from '../repositories/payment.repository.port';
import type { ResubmissionVerificationRepository } from '../repositories/resubmission.repository.port';
import type { FileRepository } from '../repositories/file.repository.port';
import type { PaymentProofStorage } from '../repositories/proof-storage.port';
import type { GlobalClock } from '../time/global-clock';
import type { DomainEventBus } from '../events/domain-events';
import type {
  VerificationCodeChannel,
  VerificationCodeDeliveryResult,
} from '../notifications/verification-code-channel.port';
import { ResubmissionService } from './resubmission.service';

const NOW = new Date('2026-09-14T18:00:00.000Z');
const PHONE = '+251911112233';

function makeService(delivery: VerificationCodeDeliveryResult): {
  service: ResubmissionService;
  markUsed: ReturnType<typeof vi.fn>;
  securityEvents: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    resubmissionVerification: { count: vi.fn(async () => 0) },
    securityEvent: { create: vi.fn(async () => undefined) },
  } as unknown as PrismaClient;

  const businessRepo = {
    findBySlug: vi.fn(async () => ({ id: 'b1' })),
  } as unknown as BusinessRepository;
  const bookingRepo = {
    findById: vi.fn(async () => ({ id: 7, customerPhone: PHONE, status: 'REJECTED' })),
  } as unknown as BookingRepository;
  const verificationRepo = {
    create: vi.fn(async () => ({ id: 'v1', expiresAt: new Date(NOW.getTime() + 600_000) })),
    markUsed: vi.fn(async () => true),
  } as unknown as ResubmissionVerificationRepository;
  const codeChannel = {
    deliver: vi.fn(async () => delivery),
  } as unknown as VerificationCodeChannel;

  const service = new ResubmissionService(
    prisma,
    businessRepo,
    bookingRepo,
    {} as PaymentRepository,
    verificationRepo,
    {} as FileRepository,
    {} as PaymentProofStorage,
    { now: () => NOW } as unknown as GlobalClock,
    {} as DomainEventBus,
    codeChannel,
  );

  const markUsed = (verificationRepo as unknown as { markUsed: ReturnType<typeof vi.fn> }).markUsed;
  const securityEvents = (prisma as unknown as { securityEvent: { create: ReturnType<typeof vi.fn> } }).securityEvent.create;
  return { service, markUsed, securityEvents };
}

/**
 * REQ-230 / canonical Section 23.3: when the approved delivery channel is
 * available but the customer has no connected chat, the issued code is voided
 * so it can never be consumed; otherwise it stays live until its TTL.
 */
describe('ResubmissionService.requestCode — code delivery (REQ-230)', () => {
  it('voids the code when the delivery channel reports NO_CHANNEL', async () => {
    const { service, markUsed, securityEvents } = makeService('NO_CHANNEL');
    const result = await service.requestCode({ businessSlug: 'salon', phone: PHONE, bookingId: 7 });

    expect(markUsed).toHaveBeenCalledTimes(1);
    expect(markUsed.mock.calls[0]?.[1]).toEqual({ id: 'v1', businessId: 'b1' });
    expect(securityEvents).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessId: 'b1', type: 'BOOKING_VERIFICATION_CODE_NO_CHANNEL' }),
    });
    expect(result.verificationId).toBe('v1');
  });

  it('leaves the code live when delivery succeeds', async () => {
    const { service, markUsed, securityEvents } = makeService('DELIVERED');
    await service.requestCode({ businessSlug: 'salon', phone: PHONE, bookingId: 7 });

    expect(markUsed).not.toHaveBeenCalled();
    expect(securityEvents).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessId: 'b1', type: 'RESUBMISSION_CODE_REQUEST' }),
    });
  });

  it('leaves the code live when the channel is operationally disabled', async () => {
    const { service, markUsed } = makeService('CHANNEL_DISABLED');
    await service.requestCode({ businessSlug: 'salon', phone: PHONE, bookingId: 7 });
    expect(markUsed).not.toHaveBeenCalled();
  });
});
