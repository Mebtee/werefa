import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScheduleService } from '../../domain/services/schedule.service';
import { TenantGuard } from '../../domain/authorization/tenant-guard';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import { OwnerScheduleView, ownerScheduleProjection } from '../dto/projections';
import { BusinessIdParamDto } from '../dto/payloads';

/**
 * Super Admin schedule inspection (REQ-167/168).
 *
 * Visible to Super Admins only: Admins receive 403 like any other non-owner
 * caller. Read-only — Super Admins audit schedule history, they never edit a
 * business schedule.
 */
@ApiTags('admin · schedule')
@Controller('admin/businesses')
@UseGuards(ApiAuthGuard)
export class AdminScheduleController {
  constructor(
    @Inject(ScheduleService) private readonly scheduleService: ScheduleService,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
  ) {}

  @Get(':businessId/schedule/versions')
  @ApiOperation({ summary: 'Schedule version history with full snapshots (Super Admin only).' })
  @ApiOkResponse({ type: OwnerScheduleView, isArray: true })
  async versions(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
  ): Promise<OwnerScheduleView[]> {
    this.tenantGuard.requireSuperAdmin(actor);
    const versions = await this.scheduleService.listVersionsWithDetails(params.businessId);
    return versions.map(ownerScheduleProjection);
  }
}