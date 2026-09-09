import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { readString } from '../iam/validation';
import {
  TelegramConnectionService,
  type TelegramConnectRequest,
  type TelegramConnectResult,
  type TelegramStatusView,
} from './telegram-connection.service';

@Public()
@Controller('/api/v1/public/businesses/:slug/bookings/:bookingId/telegram')
export class TelegramPublicController {
  constructor(private readonly connections: TelegramConnectionService) {}

  @Post('connect')
  async connect(
    @Param('slug') slug: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<TelegramConnectResult> {
    const input = readPhoneInput(body);
    return this.connections.initiate(slug, bookingId, input, req.ip);
  }

  @Post('status')
  async status(
    @Param('slug') slug: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<TelegramStatusView> {
    const input = readPhoneInput(body);
    return this.connections.status(slug, bookingId, input);
  }

  @Post('disconnect')
  async disconnect(
    @Param('slug') slug: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const input = readPhoneInput(body);
    return this.connections.disconnect(slug, bookingId, input, req.ip);
  }
}

function readPhoneInput(body: unknown): TelegramConnectRequest {
  const phone = readString(body as Record<string, unknown>, 'phone', { required: true, max: 20 });
  if (!phone) {
    // readString throws when required and missing; this guard exists for typing.
    return { phone: '' };
  }
  return { phone };
}
