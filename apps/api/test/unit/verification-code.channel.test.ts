import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../src/database/prisma.service';
import { FakeTelegramProvider } from '../../src/notifications/providers';
import {
  InMemoryVerificationCodeChannel,
  TelegramVerificationCodeChannel,
  renderVerificationCodeTelegram,
  type CodeDeliveryInput,
} from '../../src/booking/verification-code.channel';

const INPUT: CodeDeliveryInput = {
  businessId: 'business-1',
  bookingId: 'booking-1',
  phone: '+251900000001',
  code: '123456',
  purpose: 'BOOKING_RESUBMISSION',
  ttlMinutes: 15,
};

/** Build the production channel against a stubbed Prisma + Fake provider. */
function channelWith(connection: { status: string; chatId: bigint | null } | null): {
  channel: TelegramVerificationCodeChannel;
  telegram: FakeTelegramProvider;
} {
  const fakeTx = {
    $executeRawUnsafe: async () => 0,
    telegramConnection: {
      findUnique: async () => connection,
    },
  };
  const prisma = {
    $transaction: async (fn: (tx: typeof fakeTx) => Promise<unknown>): Promise<unknown> =>
      fn(fakeTx),
  } as unknown as PrismaService;
  const telegram = new FakeTelegramProvider();
  return { channel: new TelegramVerificationCodeChannel(prisma, telegram), telegram };
}

describe('TelegramVerificationCodeChannel (REQ-230, doc 08 §9.2)', () => {
  it('delivers to the booking’s ACTIVE chat and returns true', async () => {
    const { channel, telegram } = channelWith({ status: 'ACTIVE', chatId: 12345n });
    const delivered = await channel.deliver(INPUT);
    expect(delivered).toBe(true);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].chatId).toBe(12345n);
    expect(telegram.sent[0].text).toContain('123456');
  });

  it('returns false and sends nothing when the booking has no Telegram connection', async () => {
    const { channel, telegram } = channelWith(null);
    expect(await channel.deliver(INPUT)).toBe(false);
    expect(telegram.sent).toHaveLength(0);
  });

  it('returns false for a non-ACTIVE / REVOKED connection', async () => {
    for (const status of ['PENDING', 'REVOKED', 'EXPIRED']) {
      const { channel, telegram } = channelWith({ status, chatId: 12345n });
      expect(await channel.deliver(INPUT)).toBe(false);
      expect(telegram.sent).toHaveLength(0);
    }
  });

  it('returns false when the provider rejects the send (message never durable)', async () => {
    const { channel, telegram } = channelWith({ status: 'ACTIVE', chatId: 12345n });
    telegram.mode = 'fail-all';
    expect(await channel.deliver(INPUT)).toBe(false);
    expect(telegram.sent).toHaveLength(0);
  });
});

describe('renderVerificationCodeTelegram', () => {
  it('states the code, its TTL and single-use, without booking details', () => {
    const { text } = renderVerificationCodeTelegram('654321', 15);
    expect(text).toContain('654321');
    expect(text).toContain('15 minutes');
    expect(text).toContain('once');
    expect(text).not.toContain('booking-1');
    expect(text).not.toContain('business-1');
    expect(text).not.toContain('+251');
    expect(text).not.toContain('<');
    expect(text).not.toContain('http');
  });
});

describe('InMemoryVerificationCodeChannel (TEST-ONLY double)', () => {
  it('captures the code and reports a successful delivery', async () => {
    const channel = new InMemoryVerificationCodeChannel();
    expect(await channel.deliver(INPUT)).toBe(true);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0].code).toBe('123456');
    expect(channel.sent[0].bookingId).toBe('booking-1');
  });

  it('reports failure when the failDelivery knob is set (drives the void path)', async () => {
    const channel = new InMemoryVerificationCodeChannel();
    channel.failDelivery = true;
    expect(await channel.deliver(INPUT)).toBe(false);
    expect(channel.sent).toHaveLength(0);
  });
});
