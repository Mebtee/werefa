/**
 * Telegram transport boundary (Prompt 51; spec §18, T-09).
 *
 * The domain only depends on this port. The HTTP adapter talks to the Bot API
 * over `fetch`; a disabled adapter is used for fail-safe no-credential runs and
 * tests inject a fake. Message *construction* and *routing* stay in the
 * notification services — the provider is deliberately shape-only.
 */

export interface TelegramInlineButton {
  text: string;
  /** `callback_data` for inline buttons; must not exceed Telegram's 64-byte limit. */
  callbackData: string;
}

export interface TelegramSendMessageInput {
  chatId: bigint;
  text: string;
  /** Single-row inline keyboards (one row per inner array). */
  replyMarkup?: { inlineKeyboard: TelegramInlineButton[][] };
}

export interface TelegramSendMessageResult {
  ok: boolean;
  error?: string;
}

export const TELEGRAM_PROVIDER = Symbol('TELEGRAM_PROVIDER');

export interface TelegramProvider {
  sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendMessageResult>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<{ ok: boolean; error?: string }>;
  /** Register/refresh the webhook with the configured secret token. */
  registerWebhook(): Promise<void>;
}