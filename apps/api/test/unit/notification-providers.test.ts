import { describe, expect, it } from 'vitest';
import {
  DisabledTelegramProvider,
  FakeTelegramProvider,
  classifyMailError,
  isPermanentFailure,
  telegramProviderFromConfig,
} from '../../src/notifications/providers';

describe('DisabledTelegramProvider', () => {
  it('reports CHANNEL_DISABLED', async () => {
    const provider = new DisabledTelegramProvider();
    expect(await provider.sendMessage({ chatId: 1n, text: 'x' })).toBe('CHANNEL_DISABLED');
  });
});

describe('FakeTelegramProvider', () => {
  it('captures sent messages and returns null on success', async () => {
    const provider = new FakeTelegramProvider();
    const outcome = await provider.sendMessage({ chatId: 999n, text: 'hi' });
    expect(outcome).toBeNull();
    expect(provider.sent).toEqual([{ chatId: 999n, text: 'hi' }]);
  });
  it('fail-all forces retryable failures', async () => {
    const provider = new FakeTelegramProvider();
    provider.mode = 'fail-all';
    expect(await provider.sendMessage({ chatId: 1n, text: 'x' })).toBe('TRANSIENT');
  });
});

describe('telegramProviderFromConfig', () => {
  it('selects fake in test env regardless of enabled flag', () => {
    expect(telegramProviderFromConfig({ appEnv: 'test', telegramEnabled: false })).toBeInstanceOf(
      FakeTelegramProvider,
    );
  });
  it('selects disabled provider when not enabled / no token', () => {
    expect(
      telegramProviderFromConfig({ appEnv: 'production', telegramEnabled: false }),
    ).toBeInstanceOf(DisabledTelegramProvider);
    expect(
      telegramProviderFromConfig({ appEnv: 'production', telegramEnabled: true }),
    ).toBeInstanceOf(DisabledTelegramProvider);
  });
});

describe('failure classification', () => {
  it('treats permanent categories as permanent', () => {
    expect(isPermanentFailure('CHANNEL_DISABLED')).toBe(true);
    expect(isPermanentFailure('INVALID_RECIPIENT')).toBe(true);
    expect(isPermanentFailure('CHAT_INVALID')).toBe(true);
    expect(isPermanentFailure('PROVIDER_ERROR')).toBe(true);
    expect(isPermanentFailure('TRANSIENT')).toBe(false);
    expect(isPermanentFailure('RATE_LIMITED')).toBe(false);
  });
  it('classifies SMTP transport errors', () => {
    expect(classifyMailError({ code: 'EAUTH' })).toBe('PROVIDER_ERROR');
    expect(classifyMailError({ code: 'EDNS' })).toBe('PROVIDER_ERROR');
    expect(classifyMailError({ code: 'ECONNECTION' })).toBe('TRANSIENT');
    expect(classifyMailError({ responseCode: 550 })).toBe('INVALID_RECIPIENT');
    expect(classifyMailError({ responseCode: 421 })).toBe('TRANSIENT');
  });
});
