import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { Roles, RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { ActorContext } from '../common/context/actor-context';
import { ValidationException } from '../common/http/app-error';
import { BookingAdminService } from './booking-admin.service';
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
 * Platform booking views for Admin / Super Admin (REQ-176/177).
 *
 * Admin (`@Roles(Role.Admin)`, rank-inclusive so Super Admin may also use it):
 * current status only — NO history tables are read (REQ-176). Super Admin gets
 * the full audit detail via the super-admin controller below (REQ-177).
 * Backed by the elevated `app_superadmin` connection.
 */
@Controller('/api/v1/admin/bookings')
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.Admin)
export class BookingAdminController {
  constructor(private readonly service: BookingAdminService) {}

  @Get()
  async list(@Actor() actor: ActorContext, @Query() query: Record<string, unknown>) {
    const page = optionalInt(query.page, 'page', 0);
    const pageSize = optionalInt(query.pageSize, 'pageSize', 50);
    return this.service.listStatus(actor.userId, {
      businessId: optionalString(query.businessId),
      status: optionalStatus(query.status),
      from: optionalDate(query.from, 'from'),
      to: optionalDate(query.to, 'to'),
      skip: page * pageSize,
      take: pageSize,
    });
  }

  @Get(':bookingId')
  async detail(@Actor() actor: ActorContext, @Param('bookingId') bookingId: string) {
    return { booking: await this.service.statusDetail(actor.userId, bookingId) };
  }
}

/**
 * Super Admin booking audit + batch completion (REQ-177, REQ-227..230).
 * Strictly Super Admin (`@RolesExact`) so Admin can never reach history.
 */
@Controller('/api/v1/super-admin/bookings')
@UseGuards(SessionGuard, RolesGuard)
@RolesExact(Role.SuperAdmin)
export class BookingSuperAdminController {
  constructor(private readonly service: BookingAdminService) {}

  @Get(':bookingId')
  async audit(@Actor() actor: ActorContext, @Param('bookingId') bookingId: string) {
    return { booking: await this.service.superAdminDetail(actor.userId, bookingId) };
  }

  @Post(':bookingId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Actor() actor: ActorContext,
    @Param('bookingId') bookingId: string,
    @Req() req: Request,
  ) {
    void req;
    return {
      booking: await this.service.confirmCompleted(actor.userId, bookingId, 'SuperAdmin'),
    };
  }
}

function optionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw ? raw : undefined;
}

function optionalStatus(raw: unknown): BookingStatus | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (!(BOOKING_STATUSES as readonly string[]).includes(raw)) {
    throw new ValidationException([{ field: 'status', message: 'Unknown booking status filter.' }]);
  }
  return raw as BookingStatus;
}

function optionalDate(raw: unknown, field: string): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new ValidationException([{ field, message: 'Must be a valid date-time.' }]);
  }
  return value;
}

function optionalInt(raw: unknown, field: string, fallback = 0): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationException([{ field, message: 'Must be a non-negative integer.' }]);
  }
  return value;
}
