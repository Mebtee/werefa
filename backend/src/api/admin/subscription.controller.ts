import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubscriptionBillingService } from '../../domain/services/subscription-billing.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import { AdminSubscriptionProofView, adminProofProjection } from '../dto/projections';
import {
  RejectSubscriptionProofPayload,
  SubscriptionProofIdParamDto,
  SubscriptionProofQueueQuery,
} from '../dto/payloads';

/**
 * Subscription proof review queue (REQ-137/138). Visible to Admins and Super
 * Admins via ApiAuthGuard; the service re-validates with
 * requireAdminOrSuperAdmin so an endpoint can never be reached by an owner.
 */
@ApiTags('admin · subscription')
@Controller('admin/subscription')
@UseGuards(ApiAuthGuard)
export class AdminSubscriptionController {
  constructor(@Inject(SubscriptionBillingService) private readonly billing: SubscriptionBillingService) {}

  @Get('proofs')
  @ApiOperation({ summary: 'Review queue (default PENDING) with owning business + owner (REQ-137).' })
  @ApiOkResponse({ type: AdminSubscriptionProofView, isArray: true })
  async proofQueue(
    @Actor() actor: ActorContext,
    @Query() query: SubscriptionProofQueueQuery,
  ): Promise<AdminSubscriptionProofView[]> {
    const rows = await this.billing.listProofsForReview(actor, query.state);
    return rows.map(adminProofProjection);
  }

  @Post('proofs/:proofId/approve')
  @ApiOperation({ summary: 'Approve a pending proof → new paid month (REQ-137). Idempotent.' })
  @ApiOkResponse({ type: AdminSubscriptionProofView })
  @HttpCode(200)
  async approve(
    @Actor() actor: ActorContext,
    @Param() params: SubscriptionProofIdParamDto,
  ): Promise<AdminSubscriptionProofView> {
    const row = await this.billing.approveProof(actor, params.proofId);
    return adminProofProjection(row);
  }

  @Post('proofs/:proofId/reject')
  @ApiOperation({ summary: 'Reject a pending proof; requires a reason sent to the owner (REQ-138).' })
  @ApiOkResponse({ type: AdminSubscriptionProofView })
  @HttpCode(200)
  async reject(
    @Actor() actor: ActorContext,
    @Param() params: SubscriptionProofIdParamDto,
    @Body() payload: RejectSubscriptionProofPayload,
  ): Promise<AdminSubscriptionProofView> {
    const row = await this.billing.rejectProof(actor, params.proofId, payload.reason);
    return adminProofProjection(row);
  }
}