import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { BookingService } from '../../domain/services/booking.service';
import { CustomerStatusService } from '../../domain/services/customer-status.service';
import { ResubmissionService } from '../../domain/services/resubmission.service';
import {
  CustomerBookingView,
  CustomerResubmissionResultView,
  CustomerStatusView,
  customerBookingProjection,
  customerStatusProjection,
} from '../dto/projections';
import {
  CreateBookingPayload,
  CustomerStatusQuery,
  ResubmissionRequestPayload,
  ResubmissionVerifyPayload,
} from '../dto/payloads';

/**
 * Anonymous customer self-service contract (spec §27/§31; REQ-053/054/058/109).
 *
 * Customers are identified by business public slug + phone only — there is no
 * booking reference (REQ-109) and no session. Responses are customer-safe
 * projections: appointment times + a friendly disposition, never internal ids,
 * owner identity, subscription or payment-proof internals.
 */
@ApiTags('customer')
@Controller('customer')
export class CustomerController {
  constructor(
    @Inject(BookingService) private readonly bookingService: BookingService,
    @Inject(CustomerStatusService) private readonly customerStatusService: CustomerStatusService,
    @Inject(ResubmissionService) private readonly resubmissionService: ResubmissionService,
  ) {}

  @Post('bookings')
  @ApiOperation({ summary: 'Create a booking + submit payment proof (idempotent by submissionKey, REQ-121).' })
  @ApiCreatedResponse({ type: CustomerBookingView })
  async createBooking(@Body() payload: CreateBookingPayload): Promise<CustomerBookingView> {
    const { booking } = await this.bookingService.createBooking({
      businessSlug: payload.businessSlug,
      serviceId: payload.serviceId,
      variationIds: payload.variationIds,
      addOnIds: payload.addOnIds,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      note: payload.note,
      startAt: new Date(payload.startAt),
      submissionKey: payload.submissionKey,
      paymentMethod: payload.paymentMethod,
    });
    return customerBookingProjection(payload.businessSlug, booking);
  }

  @Get('status')
  @ApiOperation({ summary: 'Booking status lookup by business slug + phone (newest first).' })
  @ApiOkResponse({ type: CustomerStatusView })
  async status(@Query() query: CustomerStatusQuery): Promise<CustomerStatusView> {
    const entries = await this.customerStatusService.getStatus({
      businessSlug: query.slug,
      phone: query.phone,
    });
    return customerStatusProjection(entries);
  }

  @Post('resubmission/request-code')
  @ApiOperation({
    summary: 'Request a one-time resubmission code for the latest rejected booking (no booking reference required).',
  })
  @ApiOkResponse({ description: 'The code is delivered out-of-band and never returned.' })
  @HttpCode(200)
  async requestResubmissionCode(@Body() payload: ResubmissionRequestPayload): Promise<{ expiresAt: string }> {
    const result = await this.resubmissionService.requestCodeForCustomer({
      businessSlug: payload.businessSlug,
      phone: payload.phone,
    });
    return { expiresAt: result.expiresAt.toISOString() };
  }

  @Post('resubmission/verify')
  @ApiOperation({ summary: 'Resubmit proof for a rejected booking using the one-time code.' })
  @ApiOkResponse({ type: CustomerResubmissionResultView })
  @HttpCode(200)
  async verifyResubmission(@Body() payload: ResubmissionVerifyPayload): Promise<CustomerResubmissionResultView> {
    const result = await this.resubmissionService.resubmitForCustomer({
      businessSlug: payload.businessSlug,
      phone: payload.phone,
      code: payload.code,
      submissionKey: payload.submissionKey,
    });
    return {
      booking: customerBookingProjection(payload.businessSlug, result.booking),
      outcome: 'PROOF_RECEIVED',
    };
  }
}