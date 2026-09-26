import { Controller, Get, Inject, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportingService } from '../../domain/services/reporting.service';
import { TenantGuard } from '../../domain/authorization/tenant-guard';
import { GLOBAL_CLOCK, GlobalClock } from '../../domain/time/global-clock';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import { parseBound, sendPdf } from '../report-http';
import { BookingHistorySortBy } from '../../domain/reports/booking-history.report';
import { renderBookingHistoryPdf, renderScheduleHistoryPdf } from '../../domain/reports/report-pdf';
import { BusinessIdParamDto } from '../dto/payloads';
import {
  BookingHistoryReportQuery,
  BookingHistoryReportView,
  ScheduleHistoryQuery,
  bookingHistoryFileName,
  bookingHistoryRowProjection,
  scheduleHistoryFileName,
  sortDirectionOf,
} from '../dto/reports';

/**
 * Platform reporting / exports (Prompt 59; REQ-177 … REQ-190, REQ-170…172).
 *
 * Super Admin only: Admins receive 403 (REQ-176, REQ-168). Read-only projections
 * over the canonical history tables; nothing here mutates history or sends
 * notifications. The owner booking-report PDF export remains unresolved (§46
 * item 4) and is deliberately absent.
 */
@ApiTags('admin · reports')
@Controller('admin')
@UseGuards(ApiAuthGuard)
export class AdminReportController {
  constructor(
    @Inject(ReportingService) private readonly reporting: ReportingService,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
  ) {}

  private resolveScope(businessId: string | undefined): { businessId?: string } {
    // A single optional business (all businesses when absent; no multi-select, REQ-180/181).
    return businessId ? { businessId } : {};
  }

  @Get('reports/booking-history')
  @ApiOperation({ summary: 'Full booking status history across businesses (Super Admin only, REQ-177).' })
  @ApiOkResponse({ type: BookingHistoryReportView })
  async bookingHistory(
    @Actor() actor: ActorContext,
    @Query() query: BookingHistoryReportQuery,
  ): Promise<BookingHistoryReportView> {
    this.tenantGuard.requireSuperAdmin(actor);
    const sortBy = (query.sortBy ?? 'date') as BookingHistorySortBy;
    const sortDirection = sortDirectionOf(query.sortDirection);
    const result = await this.reporting.bookingHistory({
      statuses: query.status,
      actorTypes: query.actorType,
      actorUserId: query.actorUserId,
      ...this.resolveScope(query.businessId),
      from: parseBound(query.from, this.clock, 'start'),
      to: parseBound(query.to, this.clock, 'end'),
      sortBy,
      sortDirection,
      offset: query.offset,
      limit: query.limit,
    });
    return {
      rows: result.rows.map(bookingHistoryRowProjection),
      total: result.total,
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      sortBy,
      sortDirection,
    };
  }

  @Get('reports/booking-history.pdf')
  @ApiOperation({ summary: 'Export the full booking status history as PDF (Super Admin only, REQ-178…183).' })
  @ApiOkResponse({ description: 'application/pdf attachment (Booking ID, customer, business, status change, date/time, actor).' })
  async bookingHistoryPdf(
    @Actor() actor: ActorContext,
    @Query() query: BookingHistoryReportQuery,
    @Res() res: Response,
  ): Promise<void> {
    this.tenantGuard.requireSuperAdmin(actor);
    const sortBy = (query.sortBy ?? 'date') as BookingHistorySortBy;
    const result = await this.reporting.bookingHistory({
      statuses: query.status,
      actorTypes: query.actorType,
      actorUserId: query.actorUserId,
      ...this.resolveScope(query.businessId),
      from: parseBound(query.from, this.clock, 'start'),
      to: parseBound(query.to, this.clock, 'end'),
      sortBy,
      sortDirection: sortDirectionOf(query.sortDirection),
    });
    const scopeLabel = query.businessId
      ? `Business ${result.rows[0]?.businessName || query.businessId}`
      : 'All businesses';
    const pdf = renderBookingHistoryPdf(result.rows, this.clock, { scopeLabel, from: result.from, to: result.to });
    sendPdf(res, pdf, bookingHistoryFileName(this.clock.dateKey(this.clock.now())));
  }

  @Get('businesses/:businessId/schedule-history.pdf')
  @ApiOperation({ summary: 'Export a business schedule history as PDF (Super Admin only, REQ-167/170…172).' })
  @ApiOkResponse({ description: 'application/pdf attachment (versions + dates/times only).' })
  async scheduleHistoryPdf(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Query() query: ScheduleHistoryQuery,
    @Res() res: Response,
  ): Promise<void> {
    this.tenantGuard.requireSuperAdmin(actor);
    const result = await this.reporting.scheduleHistory(params.businessId, {
      from: parseBound(query.from, this.clock, 'start'),
      to: parseBound(query.to, this.clock, 'end'),
    });
    const pdf = renderScheduleHistoryPdf(result.rows, this.clock, {
      scopeLabel: `Business ${params.businessId}`,
      from: result.from,
      to: result.to,
    });
    sendPdf(res, pdf, scheduleHistoryFileName(this.clock.dateKey(this.clock.now())));
  }
}
