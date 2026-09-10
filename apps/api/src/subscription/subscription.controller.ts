import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import type { ActorContext } from '../common/context/actor-context';
import { SubscriptionService } from './subscription.service';

/**
 * Owner subscription & billing endpoints (Prompt 14, REQ-125..141, doc 15).
 * Owner-only; each route is additionally gated by the TenantGuard so `businessId`
 * must be in the actor's owned business set (REQ-129).
 */
@Controller('/api/v1/businesses/:businessId/subscription')
@UseGuards(SessionGuard, RolesGuard, TenantGuard)
@RolesExact(Role.Owner)
export class SubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get()
  async overview(@Actor() actor: ActorContext, @Param('businessId') businessId: string) {
    return this.subscription.overview(actor, businessId);
  }

  @Get('history')
  async history(@Actor() actor: ActorContext, @Param('businessId') businessId: string) {
    return this.subscription.history(actor, businessId);
  }

  /** Submit a manual payment request: JSON fields + a proof image/PDF (REQ-136). */
  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async submitPayment(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: unknown,
  ) {
    const result = await this.subscription.submitPayment(
      actor,
      businessId,
      file ? { buffer: file.buffer, mimetype: file.mimetype, size: file.size } : undefined,
      body,
    );
    return { payment: result.payment, created: result.created };
  }

  /** Authorized short-lived read URL for the owner's own proof object. */
  @Get('payments/:paymentId/proof')
  @HttpCode(HttpStatus.OK)
  async getProof(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.subscription.getProof(actor, businessId, paymentId);
  }
}
