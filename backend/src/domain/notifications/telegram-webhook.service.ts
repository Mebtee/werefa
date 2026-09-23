/**
 * Telegram webhook inbound handler (Prompt 51; REQ-056 … REQ-068, T-09).
 *
 * Received inside `POST /api/v1/telegram/webhook` after the controller has
 * verified `X-Telegram-Bot-Api-Secret-Token` in constant time. Responsibilities:
 *
 *  - Exactly-once: every `update_id` is recorded in `telegram_update` before
 *    processing; a replayed/duplicated update is skipped (P2002).
 *  - `/start <code>`: redeem the connection code and reply with a friendly
 *    result (welcome on success, expiry/used/invalid guidance otherwise).
 *  - `callback_query` `accept:<token>` / `reject:<token>`: route to
 *    `TelegramCallbackService` (T-09 claim + owner action) and answer the
 *    query; a rejection requiring a reason also re-sends the prompt text.
 *  - Plain text while a rejection is pending: consumed as the rejection reason
 *    (REQ-068). Everything else is ignored.
 *  - Security events are recorded best-effort; processing failures are logged
 *    as events and never crash the webhook (the update is already deduped).
 */

import { createHash, timingSafeEqual } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PRISMA_CLIENT, CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { TELEGRAM_PROVIDER, TelegramProvider } from './telegram-provider.port';
import { TelegramConnectionService } from './telegram-connection.service';
import { TelegramCallbackService, CallbackOutcome } from './telegram-callback.service';
import { parseCallbackData } from './notification-catalog';

/** Telegram Bot API Update (only the fields the bot uses). */
export interface TelegramUpdatePayload {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id?: number };
    message?: { chat?: { id: number } };
    data?: string;
  };
}

type DispatchedUpdate =
  | { kind: 'start'; code: string | null; chatId: bigint }
  | { kind: 'text'; text: string; chatId: bigint }
  | { kind: 'callback'; callbackId: string; action: 'accept' | 'reject'; token: string; chatId: bigint };

@Injectable()
export class TelegramWebhookService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_PROVIDER) private readonly provider: TelegramProvider,
    private readonly connections: TelegramConnectionService,
    private readonly callbacks: TelegramCallbackService,
  ) {}

  /** Constant-time secret comparison (never leaks length-timing). */
  isValidSecret(token: string | undefined): boolean {
    const expected = this.config.telegramBotWebhookSecret;
    if (!expected || !token) return false;
    const actual = Buffer.from(token);
    const want = Buffer.from(expected);
    return actual.length === want.length && timingSafeEqual(actual, want);
  }

  /**
   * Record the failed webhook-signature attempt (best-effort; never throws).
   * Must stay callable from the controller when the secret is wrong.
   */
  async recordSecretMismatch(ip?: string): Promise<void> {
    await this.security('WEBHOOK_SECRET_MISMATCH', 'FAILED', undefined, ip);
  }

  /** Handle one verified Telegram update (exactly-once by update_id). */
  async handleUpdate(update: TelegramUpdatePayload): Promise<void> {
    if (typeof update?.update_id !== 'number') return;

    const updateId = BigInt(update.update_id);
    try {
      await this.prisma.telegramUpdate.create({ data: { updateId } });
    } catch {
      return; // duplicate/replayed update — already processed.
    }

    const dispatch = routeUpdate(update);
    if (!dispatch) return;
    try {
      if (dispatch.kind === 'start') {
        await this.handleStart(dispatch.code, dispatch.chatId);
      } else if (dispatch.kind === 'text') {
        await this.handleText(dispatch.chatId, dispatch.text);
      } else {
        await this.handleCallbackQuery(dispatch.callbackId, dispatch.action, dispatch.token, dispatch.chatId);
      }
    } catch {
      await this.security('UPDATE_PROCESSING_FAILED', 'FAILED');
    }
  }

  /** `/start <code>` — redeem the connection and reply with a friendly result. */
  private async handleStart(code: string | null, chatId: bigint): Promise<void> {
    if (!code) {
      await this.reply(
        chatId,
        'Welcome to Werefa! To get appointment updates on Telegram, open the booking page you received and tap "Connect Telegram".',
      );
      return;
    }

    const businessId = await this.prisma.telegramConnectionToken
      .findFirst({ where: { codeHash: sha256(code) }, select: { businessId: true } })
      .then((row) => row?.businessId ?? null)
      .catch(() => null);

    try {
      const redeemed = await this.connections.redeem(code, chatId);
      const name = await this.businessName(businessId);
      const at = name ? ` at ${name}` : '';
      const text =
        redeemed.kind === 'BUSINESS_OWNER'
          ? `Connected${at}! New payment proofs will be sent to this chat and you can accept or reject them right here.`
          : `Connected${at}! You will get updates about your appointments here.`;
      await this.reply(chatId, text);
      await this.security('TELEGRAM_REDEEM', 'SUCCESS', businessId);
    } catch (err) {
      const detail = redeemFriendlyMessage(err);
      await this.reply(chatId, detail.text);
      await this.security('TELEGRAM_REDEEM', detail.result, businessId);
    }
  }

  /** Plain-text message: consumed as a pending rejection reason (REQ-068). */
  private async handleText(chatId: bigint, text: string): Promise<void> {
    const outcome = await this.callbacks.submitRejectReason(chatId, text);
    if (outcome.kind === 'REFUSED') return; // no pending prompt — stay silent.
    if (outcome.kind === 'EXECUTED') {
      await this.reply(chatId, outcome.message);
    }
    await this.security('TELEGRAM_REJECT_REASON', 'SUCCESS');
  }

  /** Inline Accept/Reject button callback (chat binding enforced by T-09 claim). */
  private async handleCallbackQuery(
    callbackId: string,
    action: 'accept' | 'reject',
    token: string,
    chatId: bigint,
  ): Promise<void> {
    const outcome: CallbackOutcome =
      action === 'accept'
        ? await this.callbacks.acceptProof(token, chatId)
        : await this.callbacks.startReject(token, chatId);

    if (outcome.kind === 'REFUSED') {
      await this.answer(callbackId, outcome.message);
      await this.security('TELEGRAM_CALLBACK', 'REFUSED');
      return;
    }

    const alertText = outcome.kind === 'NEEDS_REASON' ? outcome.prompt : outcome.message;
    await this.answer(callbackId, alertText);
    if (outcome.kind === 'NEEDS_REASON') {
      await this.reply(chatId, outcome.prompt);
    }
    await this.security('TELEGRAM_CALLBACK', 'SUCCESS');
  }

  private async answer(callbackId: string, text: string): Promise<void> {
    await this.provider.answerCallbackQuery(callbackId, text);
  }

  private async reply(chatId: bigint, text: string): Promise<void> {
    await this.provider.sendMessage({ chatId, text });
  }

  private async businessName(businessId: string | null): Promise<string | null> {
    if (!businessId) return null;
    return this.prisma.business
      .findUnique({ where: { id: businessId }, select: { name: true } })
      .then((b) => b?.name ?? null)
      .catch(() => null);
  }

  /** Best-effort security journal; failures never surface to the caller. */
  private async security(
    type: string,
    result: string,
    businessId?: string | null,
    ip?: string,
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          businessId: businessId ?? null,
          type: type.slice(0, 64),
          result: result.slice(0, 32),
          ip: ip?.slice(0, 64) ?? null,
        },
      });
    } catch {
      // journal is best-effort
    }
  }
}

/** Route one update to a typed dispatch (pure; returns null when ignored). */
export function routeUpdate(update: TelegramUpdatePayload): DispatchedUpdate | null {
  if (update.message?.text !== undefined) {
    const chatId = BigInt(update.message.chat.id);
    const text = update.message.text.trim();
    if (text.startsWith('/')) {
      if (!text.startsWith('/start')) return null; // unknown command — ignore
      const rest = text.slice('/start'.length).trim();
      return { kind: 'start', code: rest ? rest.split(/\s+/)[0] : null, chatId };
    }
    if (text.length === 0) return null;
    return { kind: 'text', text, chatId };
  }

  if (update.callback_query) {
    const parsed = update.callback_query.data === undefined ? null : parseCallbackData(update.callback_query.data);
    if (!parsed) return null;
    const chatId = BigInt(update.callback_query.message?.chat?.id ?? update.callback_query.from?.id ?? 0);
    if (chatId === 0n) return null;
    return {
      kind: 'callback',
      callbackId: update.callback_query.id,
      action: parsed.action,
      token: parsed.token,
      chatId,
    };
  }

  return null;
}

/** Friendly webhook copy for a failed code redemption, mapped by error code. */
export function redeemFriendlyMessage(err: unknown): { text: string; result: string } {
  const code = err instanceof AppError ? (err as AppError & { code?: ErrorCode }).code : undefined;
  switch (code) {
    case 'TOKEN_EXPIRED':
      return {
        text: 'This connection code has expired. Please request a new one on the booking page.',
        result: 'EXPIRED',
      };
    case 'TOKEN_USED':
      return {
        text: 'This connection code has already been used. Please request a new one on the booking page.',
        result: 'USED',
      };
    case 'CONFLICT':
      return {
        text: 'This Telegram chat is already linked to another connection. Please connect from the booking page with a different chat.',
        result: 'CONFLICT',
      };
    default:
      return {
        text: 'This connection code is not valid. Please request a new one on the booking page.',
        result: 'INVALID',
      };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}