import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { TelegramConnectionService } from './telegram-connection.service';

/**
 * Telegram Bot API webhook receiver (doc 12 §5). Authenticated by the
 * `X-Telegram-Bot-Api-Secret-Token` header (disabled app → 401), rate-limited
 * per source IP, and deduplicated on `update_id` (at-most-once). The service
 * always answers `{ ok: true }` for legitimately processed updates and keeps
 * binding failures to side-channel security events — never to Telegram retries.
 */
@Public()
@Controller('/api/v1/telegram/webhook')
export class TelegramWebhookController {
  constructor(private readonly connections: TelegramConnectionService) {}

  @Post()
  async handle(
    @Body() body: unknown,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    return this.connections.handleWebhook(body, secretHeader, req.ip);
  }
}
