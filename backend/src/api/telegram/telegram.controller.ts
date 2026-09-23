import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { TelegramWebhookService, TelegramUpdatePayload } from '../../domain/notifications/telegram-webhook.service';

/**
 * Telegram Bot API inbound webhook (Prompt 51; spec §23.3).
 *
 * The Bot API calls `POST /api/v1/telegram/webhook` for every update and signs
 * each request with `X-Telegram-Bot-Api-Secret-Token`. The controller compares
 * the header in constant time and journals mismatches as security events; a
 * valid update is dispatched to the webhook service (exactly-once by
 * `update_id`). The raw update body is intentionally NOT validated by the
 * global class-validator pipe — the webhook service performs defensive
 * shape-checks instead, so unknown Telegram fields are never stripped.
 */
@ApiExcludeController()
@Controller('telegram')
export class TelegramController {
  constructor(private readonly webhookService: TelegramWebhookService) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Telegram webhook (Bot API inbound).' })
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Body() update: TelegramUpdatePayload,
  ): Promise<{ ok: true }> {
    if (!this.webhookService.isValidSecret(secret)) {
      const ip = forwardedFor?.split(',')[0]?.trim();
      await this.webhookService.recordSecretMismatch(ip);
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    await this.webhookService.handleUpdate(update);
    return { ok: true };
  }
}

// Re-exported so ApiModule wiring is a single import statement.
export type { TelegramUpdatePayload };