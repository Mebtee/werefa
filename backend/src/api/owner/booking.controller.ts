import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BookingService } from '../../domain/services/booking.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import {
  OwnerBookingDetailView,
  OwnerBookingView,
  ownerBookingDetailProjection,
  ownerBookingProjection,
  proofFileName,
} from '../dto/projections';
import { BookingIdParamDto, BusinessIdParamDto, OwnerBookingListQuery, ProofIdParamDto, RejectPayload, ReschedulePayload } from '../dto/payloads';

/**
 * Owner booking management (Prompt 42 §9; REQ-100 … REQ-126, REQ-159). Every
 * bookingId is owner-authorized through the service TenantGuard. Manual COMPLETE
 * is intentionally absent (lifecycle is automatic); rescheduling goes through
 * the Prompt 41 service semantics (payment preserved, no noop history rows).
 */
@ApiTags('owner · bookings')
@Controller('owner/businesses')
@UseGuards(ApiAuthGuard)
export class OwnerBookingController {
  constructor(@Inject(BookingService) private readonly bookingService: BookingService) {}

  @Get(':businessId/bookings')
  @ApiOperation({ summary: 'List bookings with filters (status, date range, customer search). Newest first.' })
  @ApiOkResponse({ type: OwnerBookingView, isArray: true })
  async list(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Query() query: OwnerBookingListQuery,
  ): Promise<OwnerBookingView[]> {
    const list = await this.bookingService.listForOwner(actor, params.businessId, {
      statusIn: query.status ? [query.status as import('@prisma/client').BookingState] : undefined,
      after: query.from ? new Date(query.from) : undefined,
      before: query.to ? new Date(query.to) : undefined,
      search: query.search,
      limit: query.limit,
    });
    return list.map(ownerBookingProjection);
  }

  @Get(':businessId/bookings/:bookingId')
  @ApiOperation({ summary: 'Booking detail incl. status history + proof submission timeline.' })
  @ApiOkResponse({ type: OwnerBookingDetailView })
  async detail(@Actor() actor: ActorContext, @Param() params: BookingIdParamDto): Promise<OwnerBookingDetailView> {
    const booking = await this.bookingService.getForOwner(actor, params.businessId, params.bookingId);
    return ownerBookingDetailProjection(booking);
  }

  private async detailAfter(actor: ActorContext, businessId: string, bookingId: number): Promise<OwnerBookingDetailView> {
    const booking = await this.bookingService.getForOwner(actor, businessId, bookingId);
    return ownerBookingDetailProjection(booking);
  }

  @Post(':businessId/bookings/:bookingId/accept')
  @ApiOperation({ summary: 'Accept payment proof → booking CONFIRMED, slot ALLOCATED.' })
  @ApiOkResponse({ type: OwnerBookingDetailView })
  @HttpCode(200)
  async accept(@Actor() actor: ActorContext, @Param() params: BookingIdParamDto): Promise<OwnerBookingDetailView> {
    await this.bookingService.acceptProof(actor, params.businessId, params.bookingId);
    return this.detailAfter(actor, params.businessId, params.bookingId);
  }

  @Post(':businessId/bookings/:bookingId/reject')
  @ApiOperation({ summary: 'Reject payment proof with a reason → booking REJECTED, slot stays LOCKED (REQ-123).' })
  @ApiOkResponse({ type: OwnerBookingDetailView })
  @HttpCode(200)
  async reject(
    @Actor() actor: ActorContext,
    @Param() params: BookingIdParamDto,
    @Body() payload: RejectPayload,
  ): Promise<OwnerBookingDetailView> {
    await this.bookingService.rejectProof(actor, params.businessId, params.bookingId, payload.reason);
    return this.detailAfter(actor, params.businessId, params.bookingId);
  }

  @Get(':businessId/bookings/:bookingId/proofs/:proofId')
  @ApiOperation({ summary: 'Download a payment-proof file (tenant + booking scoped, binary, REQ-118).' })
  @ApiOkResponse({ description: 'Binary proof file with an attachment filename.' })
  async downloadProof(
    @Actor() actor: ActorContext,
    @Param() params: ProofIdParamDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.bookingService.getOwnerProofDownload(
      actor,
      params.businessId,
      params.bookingId,
      params.proofId,
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${proofFileName(file.proofId, file.mimeType)}"`);
    res.setHeader('Content-Length', file.sizeBytes.toString());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(file.bytes);
  }

  @Post(':businessId/bookings/:bookingId/cancel')
  @ApiOperation({ summary: 'Cancel a booking (releases the slot when it was held).' })
  @ApiOkResponse({ type: OwnerBookingDetailView })
  @HttpCode(200)
  async cancel(@Actor() actor: ActorContext, @Param() params: BookingIdParamDto): Promise<OwnerBookingDetailView> {
    await this.bookingService.cancelBooking(actor, params.businessId, params.bookingId);
    return this.detailAfter(actor, params.businessId, params.bookingId);
  }

  @Post(':businessId/bookings/:bookingId/no-show')
  @ApiOperation({ summary: 'Mark a CONFIRMED booking as NO_SHOW (releases the slot).' })
  @ApiOkResponse({ type: OwnerBookingDetailView })
  @HttpCode(200)
  async noShow(@Actor() actor: ActorContext, @Param() params: BookingIdParamDto): Promise<OwnerBookingDetailView> {
    await this.bookingService.markNoShow(actor, params.businessId, params.bookingId);
    return this.detailAfter(actor, params.businessId, params.bookingId);
  }

  @Post(':businessId/bookings/:bookingId/reschedule')
  @ApiOperation({ summary: 'Reschedule a CONFIRMED booking to another time (payment preserved).' })
  @ApiOkResponse({ type: OwnerBookingDetailView })
  @HttpCode(200)
  async reschedule(
    @Actor() actor: ActorContext,
    @Param() params: BookingIdParamDto,
    @Body() payload: ReschedulePayload,
  ): Promise<OwnerBookingDetailView> {
    await this.bookingService.reschedule(actor, params.businessId, params.bookingId, new Date(payload.startAt));
    return this.detailAfter(actor, params.businessId, params.bookingId);
  }

  @Post(':businessId/bookings/:bookingId/release-slot')
  @ApiOperation({ summary: 'Manually release the held slot of a CANCELLED/REJECTED booking.' })
  @HttpCode(204)
  async releaseSlot(@Actor() actor: ActorContext, @Param() params: BookingIdParamDto): Promise<void> {
    await this.bookingService.releaseSlot(actor, params.businessId, params.bookingId);
  }
}