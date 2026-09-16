import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ScheduleService } from '../../domain/services/schedule.service';
import { TenantGuard } from '../../domain/authorization/tenant-guard';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import {
  OwnerScheduleSaveResultView,
  OwnerScheduleVersionView,
  OwnerScheduleView,
  ScheduleExceptionView,
  ownerScheduleProjection,
  ownerScheduleVersionProjection,
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
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
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
  @ApiOperation({ summary: 'Schedule version history (read-only).' })
  @ApiOkResponse({ type: OwnerScheduleVersionView, isArray: true })
  async versions(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerScheduleVersionView[]> {
    await this.tenantGuard.requireOwnedBusiness(actor, params.businessId);
    const versions = await this.scheduleService.listVersions(params.businessId);
    return versions.map(ownerScheduleVersionProjection);
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
    const created = await this.scheduleService.recordScheduleException(actor, params.businessId, payload.bookingId, payload.versionId);
    return { id: created.id, scheduleVersionId: created.scheduleVersionId, bookingId: created.bookingId, createdAt: created.createdAt.toISOString() };
  }
}