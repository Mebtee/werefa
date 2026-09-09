import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import type { ActorContext } from '../common/context/actor-context';
import { ValidationException } from '../common/http/app-error';
import { BookingService } from './booking.service';
import { parseRejectInput, parseRescheduleInput } from './booking-input';
import type { BookingStatus } from '@prisma/client';

const BOOKING_STATUSES: readonly BookingStatus[] = [
  'PAYMENT_PENDING',
  'CONFIRMED',
  'REJECTED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
];

/**
 * Owner booking management endpoints (Prompt 11, Domain 5 / doc 04 §9).
 *
 * Owner-only via `@RolesExact(Role.Owner)` — Admins/Super Admins use the
 * platform booking controllers instead. Every route is business-scoped by the
 * TenantGuard (businessId ∈ actor.ownedBusinessIds); RLS re-scopes at the row.
 */
@Controller('/api/v1/businesses/:businessId/bookings')
@UseGuards(SessionGuard, RolesGuard, TenantGuard)
@RolesExact(Role.Owner)
export class BookingController {
  constructor(private readonly service: BookingService) {}

  @Get()
  async list(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.list(actor, businessId, {
      status: parseOptionalStatus(query.status),
      from: parseOptionalDate(query.from, 'from'),
      to: parseOptionalDate(query.to, 'to'),
      sort: query.sort === 'UPCOMING' ? 'UPCOMING' : 'RECENT',
      skip: parseIntOptional(query.page, 'page') * parseIntOptional(query.pageSize, 'pageSize'),
      take: parseIntOptional(query.pageSize, 'pageSize'),
    });
  }

  @Get(':bookingId')
  async detail(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<{ booking: Awaited<ReturnType<BookingService['detail']>> }> {
    return { booking: await this.service.detail(actor, businessId, bookingId) };
  }

  @Post(':bookingId/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<{ booking: Awaited<ReturnType<BookingService['accept']>> }> {
    return { booking: await this.service.accept(actor, businessId, bookingId) };
  }

  @Post(':bookingId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<{ booking: Awaited<ReturnType<BookingService['reject']>> }> {
    const { reason } = parseRejectInput(body);
    return { booking: await this.service.reject(actor, businessId, bookingId, reason) };
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<{ booking: Awaited<ReturnType<BookingService['cancel']>> }> {
    return { booking: await this.service.cancel(actor, businessId, bookingId) };
  }

  @Post(':bookingId/reschedule')
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<{ booking: Awaited<ReturnType<BookingService['reschedule']>> }> {
    const { newStartAt } = parseRescheduleInput(body);
    return { booking: await this.service.reschedule(actor, businessId, bookingId, newStartAt) };
  }

  @Post(':bookingId/no-show')
  @HttpCode(HttpStatus.OK)
  async noShow(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<{ booking: Awaited<ReturnType<BookingService['noShow']>> }> {
    return { booking: await this.service.noShow(actor, businessId, bookingId) };
  }

  @Post(':bookingId/release-slot')
  @HttpCode(HttpStatus.OK)
  async releaseSlot(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<{ ok: true }> {
    return this.service.releaseSlot(actor, businessId, bookingId);
  }
}

function parseOptionalStatus(raw: unknown): BookingStatus | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (!(BOOKING_STATUSES as readonly string[]).includes(raw)) {
    throw new ValidationException([{ field: 'status', message: 'Unknown booking status filter.' }]);
  }
  return raw as BookingStatus;
}

function parseOptionalDate(raw: unknown, field: string): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new ValidationException([{ field, message: 'Must be a valid date-time.' }]);
  }
  return value;
}

function parseIntOptional(raw: unknown, field: string, fallback = 0): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationException([{ field, message: 'Must be a non-negative integer.' }]);
  }
  return value;
}
