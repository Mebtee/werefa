import { Controller, Get, Post, UseGuards, Param } from '@nestjs/common';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import type { ActorContext } from '../common/context/actor-context';
import {
  OwnerTelegramService,
  type OwnerTelegramConnectResult,
  type OwnerTelegramStatusView,
} from './owner-telegram.service';

/**
 * Owner Telegram payment-notification endpoints (Prompt 23, REQ-065/066).
 * Owner-only; business-scoped by the TenantGuard. The connect link is a
 * one-time, expiring token consumed by the webhook — it is issued here but
 * never stored raw.
 */
@Controller('/api/v1/businesses/:businessId/telegram')
@UseGuards(SessionGuard, RolesGuard, TenantGuard)
@RolesExact(Role.Owner)
export class TelegramOwnerController {
  constructor(private readonly ownerTelegram: OwnerTelegramService) {}

  @Get('status')
  async status(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ telegram: OwnerTelegramStatusView }> {
    return { telegram: await this.ownerTelegram.status(actor, businessId) };
  }

  @Post('connect')
  async connect(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ telegram: OwnerTelegramConnectResult }> {
    return { telegram: await this.ownerTelegram.initiate(actor, businessId) };
  }

  @Post('disconnect')
  async disconnect(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ telegram: { message: string } }> {
    return { telegram: await this.ownerTelegram.disconnect(actor, businessId) };
  }
}
