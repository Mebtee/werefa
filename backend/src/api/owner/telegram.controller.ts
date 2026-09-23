import { Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TelegramConnectionService } from '../../domain/notifications/telegram-connection.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import {
  OwnerTelegramStatusView,
  TelegramConnectionView,
  telegramConnectProjection,
} from '../dto/projections';
import { BusinessIdParamDto } from '../dto/payloads';

/**
 * Owner Telegram connection (Prompt 51; spec §23.3, REQ-065/066).
 *
 * The owner links the business to their personal Telegram chat so new payment
 * proofs (N09) are delivered there with Accept/Reject inline buttons. Both
 * endpoints are tenancy-guarded: the acting user must own the business, and the
 * connection is scoped per (user, business).
 */
@ApiTags('owner · telegram')
@Controller('owner/businesses')
@UseGuards(ApiAuthGuard)
export class OwnerTelegramController {
  constructor(@Inject(TelegramConnectionService) private readonly connections: TelegramConnectionService) {}

  @Get(':businessId/telegram/status')
  @ApiOperation({ summary: 'Whether the acting owner has a live Telegram connection for this business.' })
  @ApiOkResponse({ type: OwnerTelegramStatusView })
  async status(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerTelegramStatusView> {
    const connected = await this.connections.ownerConnected(actor.actorUserId ?? '', params.businessId);
    return { connected };
  }

  @Post(':businessId/telegram/connect')
  @ApiOperation({
    summary:
      'Return a one-time deep link that connects the acting owner’s Telegram chat to this business (10-minute code).',
  })
  @ApiOkResponse({ type: TelegramConnectionView })
  @HttpCode(200)
  async connect(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<TelegramConnectionView> {
    const result = await this.connections.connectOwner(actor.actorUserId ?? '', params.businessId);
    return telegramConnectProjection(result);
  }
}