import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { ActorContext } from '../common/context/actor-context';
import { ValidationException } from '../common/http/app-error';
import { ScheduleService } from './schedule.service';

/**
 * Super Admin schedule history + export across any business (REQ-167/170).
 *
 * Strictly Super Admin (`@RolesExact(Role.SuperAdmin)`) so Admin can never
 * reach business schedule history (REQ-168). Backed by the elevated
 * `app_superadmin` connection inside ScheduleService. No TenantGuard — a
 * Super Admin reads any tenant by business_id.
 */
@Controller('/api/v1/super-admin/businesses/:businessId/schedule/history')
@UseGuards(SessionGuard, RolesGuard)
@RolesExact(Role.SuperAdmin)
export class ScheduleSuperAdminController {
  constructor(private readonly service: ScheduleService) {}

  @Get()
  async history(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<ScheduleService['historyForSuperAdmin']>>> {
    const { from, to } = parseRange(query);
    return this.service.historyForSuperAdmin(businessId, { from, to });
  }

  @Get('pdf')
  async historyPdf(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const { from, to } = parseRange(query);
    const pdf = await this.service.exportPdfForSuperAdmin(businessId, { from, to });
    res.set('Content-Type', pdf.contentType);
    res.set('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(pdf.buffer);
  }
}

function parseRange(query: Record<string, unknown>): { from?: Date; to?: Date } {
  const from = optionalDate(query.from, 'from');
  const to = optionalDate(query.to, 'to');
  return { from, to };
}

function optionalDate(raw: unknown, field: string): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new ValidationException([{ field, message: 'Must be a valid date-time.' }]);
  }
  return value;
}
