/**
 * Real Telegram Bot API HTTP adapter (Prompt 51).
 *
 * Uses the global `fetch` against `https://api.telegram.org/bot<token>/<method>`.
 * The token is injected at construction time (from validated config) and is
 * never logged. Every transport failure is surfaced as `{ ok: false, error }`
 * so the outbox can record bounded retries instead of throwing.
 */

import { TelegramProvider, TelegramSendMessageInput, TelegramSendMessageResult } from './telegram-provider.port';

const API_BASE = 'https://api.telegram.org/bot';

export class HttpTelegramProvider implements TelegramProvider {
  constructor(
    private readonly token: string,
    private readonly webhookSecret: string,
    private readonly webhookUrl: string | null,
  ) {}

  async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendMessageResult> {
    try {
      const body: Record<string, unknown> = {
        chat_id: String(input.chatId),
        text: input.text,
      };
      if (input.replyMarkup?.inlineKeyboard?.length) {
        body.reply_markup = {
          inline_keyboard: input.replyMarkup.inlineKeyboard.map((row) =>
            row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
          ),
        };
      }
      const res = await this.post('sendMessage', body);
      if (!res.ok) {
        return { ok: false, error: rawError(res) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.post('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
      });
      return res.ok ? { ok: true } : { ok: false, error: rawError(res) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async registerWebhook(): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    await this.post('setWebhook', {
      url: this.webhookUrl,
      secret_token: this.webhookSecret,
    });
  }

  private async post(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; body: unknown }> {
    const res = await fetch(`${API_BASE}${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    return {
      ok: res.ok && isOkPayload(json),
      body: json,
    };
  }
}

function isOkPayload(json: unknown): boolean {
  return typeof json === 'object' && json !== null && (json as { ok?: unknown }).ok === true;
}

function rawError(res: { body: unknown }): string {
  const b = res.body;
  if (typeof b === 'object' && b !== null) {
    const desc = (b as { description?: unknown }).description;
    if (typeof desc === 'string') return desc.slice(0, 500);
  }
  return 'Telegram API request failed';
}