import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { ActorContext } from '../common/context/actor-context';
import { BusinessService } from './business.service';
import { BusinessSerializer, type BusinessAdminDto } from './business.serializer';

/**
 * Admin/Super Admin business management (REQ-041). Read (list/detail) is open
 * to Admin + Super Admin; business-lifecycle writes (deactivate/reactivate/
 * pause/resume/edit) are Super Admin only (REQ-042: Admin is restricted from
 * owner-only and super-admin-only operations). All writes run in the elevated
 * SUPER_ADMIN scope and are audited.
 */
@Controller('/api/v1/admin/businesses')
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.Admin)
export class BusinessAdminController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly serializer: BusinessSerializer,
  ) {}

  @Get()
  async list(
    @Actor() actor: ActorContext,
    @Query('search') search?: string,
  ): Promise<{ businesses: BusinessAdminDto[] }> {
    const rows = await this.businesses.adminList(actor, { search });
    return {
      businesses: rows.map((r) => this.serializer.adminView(r.business, r.owner)),
    };
  }

  @Get(':businessId')
  async get(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessAdminDto }> {
    const row = await this.businesses.adminGet(actor, businessId);
    return {
      business: this.serializer.adminView(row.business, row.owner),
    };
  }

  @Patch(':businessId')
  @Roles(Role.SuperAdmin)
  async update(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<{ business: BusinessAdminDto }> {
    const business = await this.businesses.adminUpdate(actor, businessId, body);
    return { business: this.serializer.adminView(business) };
  }

  @Post(':businessId/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SuperAdmin)
  async deactivate(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessAdminDto }> {
    const business = await this.businesses.adminDeactivate(actor, businessId);
    return { business: this.serializer.adminView(business) };
  }

  @Post(':businessId/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SuperAdmin)
  async reactivate(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessAdminDto }> {
    const business = await this.businesses.adminReactivate(actor, businessId);
    return { business: this.serializer.adminView(business) };
  }

  @Post(':businessId/pause')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SuperAdmin)
  async pause(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<{ business: BusinessAdminDto }> {
    const business = await this.businesses.adminPause(actor, businessId, body);
    return { business: this.serializer.adminView(business) };
  }

  @Post(':businessId/resume')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SuperAdmin)
  async resume(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessAdminDto }> {
    const business = await this.businesses.adminResume(actor, businessId);
    return { business: this.serializer.adminView(business) };
  }
}
