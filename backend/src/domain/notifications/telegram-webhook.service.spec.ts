import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { redeemFriendlyMessage, routeUpdate } from './telegram-webhook.service';

function messageUpdate(text: string, chatId = 11): Parameters<typeof routeUpdate>[0] {
  return { update_id: 1, message: { chat: { id: chatId }, text } };
}

function callbackUpdate(data: string, callbackId = 'cb-1', chatId = 11): Parameters<typeof routeUpdate>[0] {
  return {
    update_id: 2,
    callback_query: { id: callbackId, from: { id: chatId }, message: { chat: { id: chatId } }, data },
  };
}

describe('routeUpdate (pure dispatch)', () => {
  it('dispatches /start <code> to a start dispatch with the code', () => {
    expect(routeUpdate(messageUpdate('/start 7f3a...abc'))).toEqual({
      kind: 'start',
      code: '7f3a...abc',
      chatId: 11n,
    });
  });

  it('a bare /start yields code null (welcome without redemption)', () => {
    expect(routeUpdate(messageUpdate('/start'))).toEqual({ kind: 'start', code: null, chatId: 11n });
    expect(routeUpdate(messageUpdate('/start   '))).toEqual({ kind: 'start', code: null, chatId: 11n });
  });

  it('takes only the first token of /start and ignores trailing words', () => {
    expect(routeUpdate(messageUpdate('/start code123 extra'))).toEqual({ kind: 'start', code: 'code123', chatId: 11n });
  });

  it('voices plain text but ignores unknown slash commands', () => {
    expect(routeUpdate(messageUpdate('hello there'))).toEqual({ kind: 'text', text: 'hello there', chatId: 11n });
    expect(routeUpdate(messageUpdate('/help'))).toBeNull();
    expect(routeUpdate(messageUpdate('   '))).toBeNull();
    expect(routeUpdate(messageUpdate('/start'))).not.toBeNull();
  });

  it('trims surrounding whitespace from the payload', () => {
    expect(routeUpdate(messageUpdate('  plain  '))).toEqual({ kind: 'text', text: 'plain', chatId: 11n });
  });

  it('dispatches valid accept/reject callbacks with the parsed token', () => {
    const token = '12345678-1234-1234-1234-123456789012';
    expect(routeUpdate(callbackUpdate(`accept:${token}`))).toEqual({
      kind: 'callback',
      callbackId: 'cb-1',
      action: 'accept',
      token,
      chatId: 11n,
    });
    expect(routeUpdate(callbackUpdate(`reject:${token}`))).toEqual({
      kind: 'callback',
      callbackId: 'cb-1',
      action: 'reject',
      token,
      chatId: 11n,
    });
  });

  it('ignores callbacks with malformed data or no usable chat id', () => {
    expect(routeUpdate(callbackUpdate('bogus'))).toBeNull();
    expect(routeUpdate(callbackUpdate('accept:not-a-uuid'))).toBeNull();
    const noChat = { update_id: 3, callback_query: { id: 'cb-2', data: 'accept:12345678-1234-1234-1234-123456789012' } };
    expect(routeUpdate(noChat)).toBeNull();
  });

  it('returns null for updates without message or callback_query', () => {
    expect(routeUpdate({ update_id: 4 })).toBeNull();
    expect(routeUpdate({ update_id: 4, message: { chat: { id: 9 } } })).toBeNull();
  });

  it('falls back to the sender id when the callback message lacks a chat', () => {
    const data = 'accept:12345678-1234-1234-1234-123456789012';
    const fromChat = { update_id: 5, callback_query: { id: 'cb-3', from: { id: 77 }, data } };
    expect(routeUpdate(fromChat)?.chatId).toBe(77n);
  });
});

describe('redeemFriendlyMessage (error translation)', () => {
  it('maps TOKEN_EXPIRED to an expired guidance message', () => {
    const out = redeemFriendlyMessage(new AppError({ code: ErrorCode.TOKEN_EXPIRED, title: 'x' }));
    expect(out.result).toBe('EXPIRED');
    expect(out.text).toMatch(/expired/i);
  });

  it('maps TOKEN_USED to a used-code guidance message', () => {
    const out = redeemFriendlyMessage(new AppError({ code: ErrorCode.TOKEN_USED, title: 'x' }));
    expect(out.result).toBe('USED');
    expect(out.text).toMatch(/already been used/i);
  });

  it('maps CONFLICT to a chat-rebinding guidance message', () => {
    const out = redeemFriendlyMessage(new AppError({ code: ErrorCode.CONFLICT, title: 'x' }));
    expect(out.result).toBe('CONFLICT');
    expect(out.text).toMatch(/already linked/i);
  });

  it('falls back to INVALID for unknown or non-AppError inputs', () => {
    for (const err of [new Error('boom'), 'oops', null, new AppError({ code: ErrorCode.NOT_FOUND, title: 'x' })]) {
      const out = redeemFriendlyMessage(err);
      expect(out.result).toBe('INVALID');
      expect(out.text).toMatch(/not valid/i);
    }
  });
});