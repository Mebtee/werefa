import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../config/app-config';
import type { TelegramProvider } from './telegram-provider.port';
import { TelegramVerificationCodeChannel } from './telegram-verification-code-channel';

const INPUT = {
  businessId: '11111111-1111-1111-1111-111111111111',
  bookingId: 7,
  customerPhone: '+251911112233',
  code: '123456',
};

function makeChannel(opts: {
  enabled: boolean;
  connection?: { chatId: bigint } | null;
  ok?: boolean;
}): {
  channel: TelegramVerificationCodeChannel;
  sendMessage: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn(async () => opts.connection ?? null);
  const prisma = {
    telegramConnection: { findFirst },
  } as unknown as PrismaClient;
  const config = { telegramEnabled: opts.enabled } as unknown as AppConfig;
  const sendMessage = vi.fn(async () => ({ ok: opts.ok ?? true }));
  const provider = {
    sendMessage,
    answerCallbackQuery: vi.fn(async () => ({ ok: true })),
    registerWebhook: vi.fn(async () => undefined),
  } as unknown as TelegramProvider;
  return { channel: new TelegramVerificationCodeChannel(prisma, config, provider), sendMessage, findFirst };
}

/**
 * REQ-230 / canonical Section 23.3: the one-time resubmission code is delivered
 * to the customer's connected Telegram chat when present; "otherwise no code is
 * delivered and the code is voided (no code path)". The channel reports which
 * of the three canonical outcomes happened so the caller can void correctly.
 */
describe('TelegramVerificationCodeChannel', () => {
  it('reports CHANNEL_DISABLED without looking up a chat when Telegram is disabled', async () => {
    const { channel, sendMessage, findFirst } = makeChannel({ enabled: false });
    await expect(channel.deliver(INPUT)).resolves.toBe('CHANNEL_DISABLED');
    expect(findFirst).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports NO_CHANNEL when the customer has no connected chat', async () => {
    const { channel, sendMessage } = makeChannel({ enabled: true, connection: null });
    await expect(channel.deliver(INPUT)).resolves.toBe('NO_CHANNEL');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('delivers the plaintext code to the connected chat', async () => {
    const { channel, sendMessage } = makeChannel({
      enabled: true,
      connection: { chatId: 42n },
    });
    await expect(channel.deliver(INPUT)).resolves.toBe('DELIVERED');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const call = sendMessage.mock.calls[0]?.[0] as { chatId: bigint; text: string };
    expect(call.chatId).toBe(42n);
    expect(call.text).toContain('123456');
  });

  it('treats a provider refusal as NO_CHANNEL so the caller voids the code', async () => {
    const { channel } = makeChannel({ enabled: true, connection: { chatId: 42n }, ok: false });
    await expect(channel.deliver(INPUT)).resolves.toBe('NO_CHANNEL');
  });
});
