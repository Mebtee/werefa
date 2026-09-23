/**
 * Disabled Telegram provider — the fail-safe binding when TELEGRAM_ENABLED is
 * false. Deliveries destined for the disabled channel are SUPPRESSED at outbox
 * write time, so this provider should normally never be called; it exists to
 * keep the DI graph total and honest (never silently "sends").
 */

import { TelegramProvider, TelegramSendMessageInput, TelegramSendMessageResult } from './telegram-provider.port';

export class DisabledTelegramProvider implements TelegramProvider {
  private readonly reason = 'TELEGRAM_ENABLED=false';

  async sendMessage(_input: TelegramSendMessageInput): Promise<TelegramSendMessageResult> {
    return { ok: false, error: this.reason };
  }

  async answerCallbackQuery(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: this.reason };
  }

  async registerWebhook(): Promise<void> {
    // No-op: the channel is disabled.
  }
}