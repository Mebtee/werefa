import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import type { ActorContext } from '../common/context/actor-context';
import { ValidationException } from '../common/http/app-error';
import { ScheduleService } from './schedule.service';

/**
 * Owner scheduling management (Prompt 12 — Domains 12/13/16, docs 10/13/21).
 *
 * Owner-only via `@RolesExact(Role.Owner)`; Admins/Super Admins use the
 * platform schedule controller instead (REQ-168). Every route is
 * business-scoped by the TenantGuard (businessId ∈ actor.ownedBusinessIds);
 * RLS re-scopes at the row.
 *
 * Endpoints:
 *   GET  ''                          current schedule + advisory warnings
 *   PUT  ''                          save a schedule version (PENDING while paused)
 *   GET  '/conflicts'                fresh affected-bookings list (self-healing)
 *   POST '/bookings/:bookingId/keep' owner keep exception (REQ-160/161)
 *   GET  '/history'                  version history (REQ-166)
 *   GET  '/history/pdf'              PDF export, neutral schedule state (REQ-167/172)
 */
@Controller('/api/v1/businesses/:businessId/schedule')
@UseGuards(SessionGuard, RolesGuard, TenantGuard)
@RolesExact(Role.Owner)
export class ScheduleController {
  constructor(private readonly service: ScheduleService) {}

  @Get()
  async current(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<Awaited<ReturnType<ScheduleService['getCurrent']>>> {
    return this.service.getCurrent(actor, businessId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async save(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<ScheduleService['save']>>> {
    return this.service.save(actor, businessId, body);
  }

  @Get('conflicts')
  async conflicts(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<Awaited<ReturnType<ScheduleService['listConflicts']>>> {
    return this.service.listConflicts(actor, businessId);
  }

  @Post('bookings/:bookingId/keep')
  @HttpCode(HttpStatus.OK)
  async keep(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<Awaited<ReturnType<ScheduleService['keepBooking']>>> {
    return this.service.keepBooking(actor, businessId, bookingId, body);
  }

  @Get('history')
  async history(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<ScheduleService['history']>>> {
    const page = optionalInt(query.page, 'page', 0);
    const pageSize = optionalInt(query.pageSize, 'pageSize', 50);
    if (pageSize > 200) {
      throw new ValidationException([{ field: 'pageSize', message: 'Must be at most 200.' }]);
    }
    return this.service.history(actor, businessId, {
      skip: page * pageSize,
      take: pageSize,
      from: optionalDate(query.from, 'from'),
      to: optionalDate(query.to, 'to'),
    });
  }

  @Get('history/pdf')
  async historyPdf(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.exportPdf(actor, businessId, {
      from: optionalDate(query.from, 'from'),
      to: optionalDate(query.to, 'to'),
    });
    res.set('Content-Type', pdf.contentType);
    res.set('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(pdf.buffer);
  }
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
