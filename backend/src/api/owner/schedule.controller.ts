import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ScheduleService } from '../../domain/services/schedule.service';
import { ReportingService } from '../../domain/services/reporting.service';
import { TenantGuard } from '../../domain/authorization/tenant-guard';
import { ActorContext } from '../../domain/authorization/actor-context';
import { GLOBAL_CLOCK, GlobalClock } from '../../domain/time/global-clock';
import { renderScheduleHistoryPdf } from '../../domain/reports/report-pdf';
import { parseBound, sendPdf } from '../report-http';
import { ScheduleHistoryQuery, scheduleHistoryFileName } from '../dto/reports';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import {
  OwnerScheduleConflictView,
  OwnerScheduleSaveResultView,
  OwnerScheduleView,
  ScheduleExceptionView,
  ownerScheduleConflictProjection,
  ownerScheduleProjection,
} from '../dto/projections';
import { BusinessIdParamDto, RecordExceptionPayload, SaveSchedulePayload } from '../dto/payloads';

/**
 * Owner schedule management (Prompt 42 §8; REQ-082 … REQ-099, REQ-150/151/152).
 * Every save creates a NEW immutable version; history is read-only, there is no
 * restore endpoint (REQ-169).
 */
@ApiTags('owner · schedule')
@Controller('owner/businesses')
@UseGuards(ApiAuthGuard)
export class OwnerScheduleController {
  constructor(
    @Inject(ScheduleService) private readonly scheduleService: ScheduleService,
    @Inject(ReportingService) private readonly reporting: ReportingService,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
    @Inject(GLOBAL_CLOCK) private readonly clock: GlobalClock,
  ) {}

  @Get(':businessId/schedule/current')
  @ApiOperation({ summary: 'Current ACTIVE schedule with periods and special dates.' })
  @ApiOkResponse({ type: OwnerScheduleView })
  async current(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerScheduleView> {
    await this.tenantGuard.requireOwnedBusiness(actor, params.businessId);
    const version = await this.scheduleService.getActiveVersion(params.businessId);
    if (!version) throw new NotFoundException('No active schedule version.');
    return ownerScheduleProjection(version);
  }

  @Get(':businessId/schedule/versions')
  @ApiOperation({ summary: 'Schedule version history with full snapshots (read-only).' })
  @ApiOkResponse({ type: OwnerScheduleView, isArray: true })
  async versions(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerScheduleView[]> {
    await this.tenantGuard.requireOwnedBusiness(actor, params.businessId);
    const versions = await this.scheduleService.listVersionsWithDetails(params.businessId);
    return versions.map(ownerScheduleProjection);
  }

  @Get(':businessId/schedule/conflicts')
  @ApiOperation({ summary: 'Live bookings made impossible by the current ACTIVE schedule (REQ-092/093).' })
  @ApiOkResponse({ type: OwnerScheduleConflictView, isArray: true })
  async conflicts(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerScheduleConflictView[]> {
    await this.tenantGuard.requireOwnedBusiness(actor, params.businessId);
    const conflicts = await this.scheduleService.listOpenConflicts(params.businessId);
    return conflicts.map(ownerScheduleConflictProjection);
  }

  @Get(':businessId/schedule-history.pdf')
  @ApiOperation({ summary: 'Export own-business schedule history as PDF (REQ-166/170…172).' })
  @ApiOkResponse({ description: 'application/pdf attachment (versions + dates/times only).' })
  async scheduleHistoryPdf(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Query() query: ScheduleHistoryQuery,
    @Res() res: Response,
  ): Promise<void> {
    await this.tenantGuard.requireOwnedBusiness(actor, params.businessId);
    const result = await this.reporting.scheduleHistory(params.businessId, {
      from: parseBound(query.from, this.clock, 'start'),
      to: parseBound(query.to, this.clock, 'end'),
    });
    const pdf = renderScheduleHistoryPdf(result.rows, this.clock, {
      scopeLabel: 'Own business',
      from: result.from,
      to: result.to,
    });
    sendPdf(res, pdf, scheduleHistoryFileName(this.clock.dateKey(this.clock.now())));
  }

  @Put(':businessId/schedule')
  @ApiOperation({ summary: 'Save a new schedule version (activated immediately unless paused).' })
  @ApiOkResponse({ type: OwnerScheduleSaveResultView })
  async save(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: SaveSchedulePayload,
  ): Promise<OwnerScheduleSaveResultView> {
    const result = await this.scheduleService.saveTemplate(actor, params.businessId, {
      name: payload.name,
      template: {
        workingPeriods: payload.workingPeriods,
        blockedPeriods: payload.blockedPeriods ?? [],
        specialDates: (payload.specialDates ?? []).map((s) => ({
          date: new Date(`${s.date}T00:00:00.000Z`),
          kind: s.kind as 'CLOSED' | 'CUSTOM',
          startMinutes: s.startMinutes ?? null,
          endMinutes: s.endMinutes ?? null,
        })),
      },
    });
    const version = await this.scheduleService.getVersion(params.businessId, result.versionId);
    if (!version) throw new NotFoundException('Schedule version not found.');
    return {
      versionId: result.versionId,
      versionNo: version.versionNo,
      activated: result.activated,
      version: ownerScheduleProjection(version),
    };
  }

  @Post(':businessId/schedule/exceptions')
  @ApiOperation({ summary: 'Record a keep-an-existing-booking exception (real schedule conflict only).' })
  @ApiOkResponse({ type: ScheduleExceptionView })
  async exception(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: RecordExceptionPayload,
  ): Promise<ScheduleExceptionView> {
    const created = await this.scheduleService.recordScheduleException(actor, params.businessId, payload.bookingId, payload.versionId, payload.reason);
    return {
      id: created.id,
      scheduleVersionId: created.scheduleVersionId,
      bookingId: created.bookingId,
      reason: created.reason,
      createdAt: created.createdAt.toISOString(),
    };
  }
}