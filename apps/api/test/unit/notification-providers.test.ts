import { describe, expect, it } from 'vitest';
import {
  DisabledTelegramProvider,
  FakeTelegramProvider,
  classifyMailError,
  isPermanentFailure,
  telegramProviderFromConfig,
} from '../../src/notifications/providers';

const REPLY_MARKUP = {
  inlineKeyboard: [
    [
      { text: 'Accept payment', callbackData: 'pv:accept:token123' },
      { text: 'Reject payment', callbackData: 'pv:reject:token456' },
    ],
  ],
};

describe('DisabledTelegramProvider', () => {
  it('reports CHANNEL_DISABLED', async () => {
    const provider = new DisabledTelegramProvider();
    expect(await provider.sendMessage({ chatId: 1n, text: 'x' })).toBe('CHANNEL_DISABLED');
  });
  it('reports CHANNEL_DISABLED for media sends and callback answers too', async () => {
    const provider = new DisabledTelegramProvider();
    expect(
      await provider.sendPhoto({
        chatId: 1n,
        text: 'x',
        buffer: Buffer.from('x'),
        mime: 'image/png',
      }),
    ).toBe('CHANNEL_DISABLED');
    expect(
      await provider.sendDocument({
        chatId: 1n,
        text: 'x',
        buffer: Buffer.from('x'),
        mime: 'application/pdf',
      }),
    ).toBe('CHANNEL_DISABLED');
    expect(await provider.answerCallbackQuery({ callbackQueryId: 'cq' })).toBe('CHANNEL_DISABLED');
  });
});

describe('FakeTelegramProvider', () => {
  it('captures sent messages and returns null on success', async () => {
    const provider = new FakeTelegramProvider();
    const outcome = await provider.sendMessage({ chatId: 999n, text: 'hi' });
    expect(outcome).toBeNull();
    expect(provider.sent).toEqual([{ chatId: 999n, text: 'hi' }]);
  });
  it('captures media sends with a buffer + cloned reply markup', async () => {
    const provider = new FakeTelegramProvider();
    const buffer = Buffer.from('fake-png');
    const outcome = await provider.sendPhoto({
      chatId: 555n,
      text: 'caption',
      buffer,
      mime: 'image/png',
      replyMarkup: REPLY_MARKUP,
    });
    expect(outcome).toBeNull();
    expect(provider.media).toHaveLength(1);
    expect(provider.media[0].chatId).toBe(555n);
    expect(provider.media[0].buffer.equals(buffer)).toBe(true);
    expect(provider.media[0].mime).toBe('image/png');
    expect(provider.media[0].replyMarkup?.inlineKeyboard[0][0].callbackData).toContain('pv:accept');
  });
  it('does not leak the caller buffer when mutated after the send', async () => {
    const provider = new FakeTelegramProvider();
    const buffer = Buffer.from('original');
    await provider.sendDocument({ chatId: 1n, text: '', buffer, mime: 'application/pdf' });
    buffer.write('MUTATED');
    expect(provider.media[0].buffer.toString()).toBe('original');
  });
  it('records callback answers', async () => {
    const provider = new FakeTelegramProvider();
    expect(await provider.answerCallbackQuery({ callbackQueryId: 'cq-1', text: 'ok' })).toBeNull();
    expect(provider.callbackAnswers).toEqual([{ callbackQueryId: 'cq-1', text: 'ok' }]);
  });
  it('fail-all forces retryable failures', async () => {
    const provider = new FakeTelegramProvider();
    provider.mode = 'fail-all';
    expect(await provider.sendMessage({ chatId: 1n, text: 'x' })).toBe('TRANSIENT');
    expect(
      await provider.sendPhoto({
        chatId: 1n,
        text: '',
        buffer: Buffer.from('x'),
        mime: 'image/png',
      }),
    ).toBe('TRANSIENT');
  });
  it('failNext(n) fails n media/callback calls then recovers', async () => {
    const provider = new FakeTelegramProvider();
    provider.failNext(2);
    expect(
      await provider.sendDocument({
        chatId: 1n,
        text: '',
        buffer: Buffer.from('x'),
        mime: 'application/pdf',
      }),
    ).toBe('TRANSIENT');
    expect(await provider.answerCallbackQuery({ callbackQueryId: 'cq' })).toBe('TRANSIENT');
    expect(
      await provider.sendPhoto({
        chatId: 1n,
        text: '',
        buffer: Buffer.from('x'),
        mime: 'image/png',
      }),
    ).toBe(null);
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
