import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ActorType } from '@prisma/client';
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

const ACTOR_TYPES: readonly ActorType[] = ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'SYSTEM'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      businessId: optionalUuid(query.businessId, 'businessId'),
      statuses: optionalStatuses(query.status),
      from: optionalDate(query.from, 'from'),
      to: optionalDate(query.to, 'to'),
      sortBy: optionalSortBy(query.sortBy),
      sortDirection: optionalSortDirection(query.sortDirection),
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

  @Get('history')
  async history(@Actor() actor: ActorContext, @Query() query: Record<string, unknown>) {
    const page = optionalInt(query.page, 'page', 0);
    const pageSize = optionalInt(query.pageSize, 'pageSize', 50);
    return this.service.listHistory(actor.userId, {
      businessId: optionalUuid(query.businessId, 'businessId'),
      statuses: optionalStatuses(query.status),
      actorUserId: optionalUuid(query.actorUserId, 'actorUserId'),
      actorTypes: optionalActorTypes(query.actorType),
      from: optionalDate(query.from, 'from'),
      to: optionalDate(query.to, 'to'),
      sortBy: optionalSortBy(query.sortBy),
      sortDirection: optionalSortDirection(query.sortDirection),
      skip: page * pageSize,
      take: pageSize,
    });
  }

  @Get('history/pdf')
  @HttpCode(HttpStatus.OK)
  async historyPdf(
    @Actor() actor: ActorContext,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.exportHistoryPdf(actor.userId, {
      businessId: optionalUuid(query.businessId, 'businessId'),
      statuses: optionalStatuses(query.status),
      actorUserId: optionalUuid(query.actorUserId, 'actorUserId'),
      actorTypes: optionalActorTypes(query.actorType),
      from: optionalDate(query.from, 'from'),
      to: optionalDate(query.to, 'to'),
    });
    res.set('Content-Type', pdf.contentType);
    res.set('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.status(HttpStatus.OK);
    res.send(pdf.buffer);
  }

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

/** UUID filter values (businessId / actorUserId) must be well-formed (REQ §29). */
function optionalUuid(raw: unknown, field: string): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (!UUID_PATTERN.test(raw)) {
    throw new ValidationException([{ field, message: 'Must be a valid UUID.' }]);
  }
  return raw;
}

/**
 * Status filter(s): comma-separated values are OR'd within the category
 * (REQ-185).
 */
function optionalStatuses(raw: unknown): BookingStatus[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const unknown = values.find((v) => !(BOOKING_STATUSES as readonly string[]).includes(v));
  if (unknown) {
    throw new ValidationException([
      { field: 'status', message: `Unknown booking status '${unknown}'.` },
    ]);
  }
  return values as BookingStatus[];
}

/** Actor-type filter(s): comma-separated values are OR'd (REQ-184/185). */
function optionalActorTypes(raw: unknown): ActorType[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const unknown = values.find((v) => !(ACTOR_TYPES as readonly string[]).includes(v));
  if (unknown) {
    throw new ValidationException([
      { field: 'actorType', message: `Unknown actor type '${unknown}'.` },
    ]);
  }
  return values as ActorType[];
}

function optionalSortBy(
  raw: unknown,
): 'date' | 'bookingId' | 'customer' | 'business' | 'status' | 'actor' | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const value = raw as 'date' | 'bookingId' | 'customer' | 'business' | 'status' | 'actor';
  if (!['date', 'bookingId', 'customer', 'business', 'status', 'actor'].includes(value)) {
    throw new ValidationException([
      {
        field: 'sortBy',
        message: 'Must be one of date, bookingId, customer, business, status, actor.',
      },
    ]);
  }
  return value;
}

function optionalSortDirection(raw: unknown): 'asc' | 'desc' | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const value = raw;
  if (value !== 'asc' && value !== 'desc') {
    throw new ValidationException([{ field: 'sortDirection', message: 'Must be asc or desc.' }]);
  }
  return value;
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
