import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BookingService } from '../../domain/services/booking.service';
import { CustomerStatusService } from '../../domain/services/customer-status.service';
import { ResubmissionService } from '../../domain/services/resubmission.service';
import { isAllowedProofMimeType, PROOF_MAX_BYTES } from '../../domain/lib/proof-file';
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
import { parseMultipartPayload } from '../dto/multipart-payload';

/**
 * Anonymous customer self-service contract (spec §27/§31; REQ-053/054/058/109).
 *
 * Customers are identified by business public slug + phone only — there is no
 * booking reference (REQ-109) and no session. Responses are customer-safe
 * projections: appointment times + a friendly disposition, never internal ids,
 * owner identity, subscription or payment-proof internals.
 *
 * Payment-proof uploads (Prompt 50): booking-create and resubmission-verify are
 * multipart/form-data with the JSON payload in a text field named `payload` and
 * the proof file in a field named `proof`. The declared MIME is only a cheap
 * pre-screen here; the application service authoritatively validates the file
 * bytes (magic-byte sniffing) BEFORE any slot claim is processed.
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
  @ApiOperation({ summary: 'Create a booking + submit payment proof (multipart; idempotent by submissionKey, REQ-121).' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: CustomerBookingView })
  @UseInterceptors(proofUploadInterceptor())
  async createBooking(
    @UploadedFile() proof: ProofUploadFile | undefined,
    @Body('payload') payloadRaw: string | undefined,
  ): Promise<CustomerBookingView> {
    const payload = await parseMultipartPayload(payloadRaw, CreateBookingPayload);
    const { booking } = await this.bookingService.createBooking({
      businessSlug: payload.businessSlug,
      selections: payload.selections.map((s) => ({
        serviceId: s.serviceId,
        variationIds: s.variationId ? [s.variationId] : [],
        addOnIds: s.addOnIds,
      })),
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      note: payload.note,
      startAt: new Date(payload.startAt),
      submissionKey: payload.submissionKey,
      paymentMethod: payload.paymentMethod,
      proof: toProofInput(proof),
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
  @ApiOperation({ summary: 'Resubmit proof for a rejected booking using the one-time code (multipart).' })
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ type: CustomerResubmissionResultView })
  @HttpCode(200)
  @UseInterceptors(proofUploadInterceptor())
  async verifyResubmission(
    @UploadedFile() proof: ProofUploadFile | undefined,
    @Body('payload') payloadRaw: string | undefined,
  ): Promise<CustomerResubmissionResultView> {
    const payload = await parseMultipartPayload(payloadRaw, ResubmissionVerifyPayload);
    const result = await this.resubmissionService.resubmitForCustomer({
      businessSlug: payload.businessSlug,
      phone: payload.phone,
      code: payload.code,
      submissionKey: payload.submissionKey,
      proof: toProofInput(proof),
    });
    return {
      booking: customerBookingProjection(payload.businessSlug, result.booking),
      outcome: 'PROOF_RECEIVED',
    };
  }
}

/** Uploaded `proof` file part (multer memory storage). */
interface ProofUploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

function toProofInput(file: ProofUploadFile | undefined): { bytes: Buffer; mimeType: string } | null {
  return file ? { bytes: file.buffer, mimeType: file.mimetype } : null;
}

/**
 * Shared multipart setup for the `proof` field: 5 MB cap + cheap declared-MIME
 * pre-screen. The authoritative byte validation happens in the service.
 */
function proofUploadInterceptor() {
  return FileInterceptor('proof', {
    storage: memoryStorage(),
    limits: { fileSize: PROOF_MAX_BYTES },
    fileFilter: proofFileFilter,
  });
}

function proofFileFilter(
  _req: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!isAllowedProofMimeType(file.mimetype)) {
    callback(new HttpException('Unsupported payment-proof file type.', HttpStatus.UNSUPPORTED_MEDIA_TYPE), false);
    return;
  }
  callback(null, true);
}