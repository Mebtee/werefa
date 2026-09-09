import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { BookingPublicService } from './booking-public.service';
import { BookingResubmissionService } from './booking-resubmission.service';
import {
  parseAvailabilityInput,
  parseCreateBookingInput,
  parseRequestCodeInput,
  parseResubmitInput,
} from './booking-input';

/**
 * Public booking endpoints (Prompt 11, Domain 5): an anonymous customer books
 * into the business page. All reads/inserts run in the PUBLIC RLS scope with
 * the `app.booking_public` marker pinned to the slug's business; resubmission
 * additionally pins `app.customer_phone` so UPDATE policies only admit the
 * caller's own verified phone. Unauthenticated → the global CSRF guard is
 * cookie-checked and passes.
 */
@Public()
@Controller('/api/v1/public/businesses/:slug/bookings')
export class BookingPublicController {
  constructor(
    private readonly bookings: BookingPublicService,
    private readonly resubmissions: BookingResubmissionService,
  ) {}

  /** Availability pre-check for a start time + services (no reservation). */
  @Post('availability')
  @HttpCode(HttpStatus.OK)
  async availability(@Param('slug') slug: string, @Body() body: unknown) {
    return {
      availability: await this.bookings.checkAvailability(slug, parseAvailabilityInput(body)),
    };
  }

  /** Create a booking (T1): multipart form + payment proof file. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Param('slug') slug: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ created: boolean; booking: unknown }> {
    const bodyObject = body as Record<string, unknown>;
    const input = parseCreateBookingInput(bodyObject ?? {});
    const result = await this.bookings.create(
      slug,
      input,
      file ? { buffer: file.buffer, mimetype: file.mimetype, size: file.size } : undefined,
    );
    return { created: result.created, booking: result.booking };
  }
}

/** Resubmission flow (T10): request a code, then resubmit a new proof. */
@Public()
@Controller('/api/v1/public/businesses/:slug/resubmissions')
export class BookingResubmissionController {
  constructor(private readonly resubmissions: BookingResubmissionService) {}

  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  async requestCode(@Param('slug') slug: string, @Body() body: unknown, @Req() req: Request) {
    return this.resubmissions.requestCode(slug, parseRequestCodeInput(body), req.ip);
  }

  @Post('resubmit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  async resubmit(
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ booking: unknown }> {
    const input = parseResubmitInput((body as Record<string, unknown>) ?? {});
    const result = await this.resubmissions.resubmit(
      slug,
      input,
      file ? { buffer: file.buffer, mimetype: file.mimetype, size: file.size } : undefined,
      req.ip,
    );
    return { booking: result.booking };
  }
}
