import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { AdminManagementService } from '../../domain/services/admin-management.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../../api/auth/api-auth.guard';
import { clientInfoFrom } from '../client-info';
import { AdminIdParamDto, CreateAdminDto, DeleteSecurityHistoryDto, ResetAdminPasswordDto } from './auth.dto';

/**
 * Admin management (Prompt 43; REQ-201–206, REQ-217–221). Super Admin only —
 * every operation is enforced by the service and audited to the audit log.
 */
@ApiTags('auth · admin')
@Controller('admin')
@UseGuards(ApiAuthGuard)
export class AdminAuthController {
  constructor(@Inject(AdminManagementService) private readonly adminService: AdminManagementService) {}

  @Get('admins')
  @ApiOperation({ summary: 'List admin accounts with active-session counts.' })
  async listAdmins(@Actor() actor: ActorContext) {
    const admins = await this.adminService.listAdmins(actor);
    return { admins };
  }

  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an admin (max two active; Super Admin only).' })
  async createAdmin(@Actor() actor: ActorContext, @Body() dto: CreateAdminDto) {
    const created = await this.adminService.createAdmin(actor, {
      email: dto.email,
      password: dto.password,
      recoveryEmail: dto.recoveryEmail,
    });
    return { admin: created };
  }

  @Delete('admins/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate an admin, revoking all sessions.' })
  async deactivateAdmin(@Actor() actor: ActorContext, @Param() params: AdminIdParamDto): Promise<void> {
    await this.adminService.deactivateAdmin(actor, params.id);
  }

  @Post('admins/:id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reset an admin password (revokes all sessions).' })
  async resetAdminPassword(
    @Actor() actor: ActorContext,
    @Param() params: AdminIdParamDto,
    @Body() dto: ResetAdminPasswordDto,
  ): Promise<void> {
    await this.adminService.resetAdminPassword(actor, params.id, dto.newPassword);
  }

  @Post('users/:id/force-logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Force-logout an Owner or Admin (Super Admin only).' })
  async forceLogoutUser(@Actor() actor: ActorContext, @Param() params: AdminIdParamDto, @Req() req: ExpressRequest): Promise<void> {
    await this.adminService.forceLogoutUser(actor, params.id, clientInfoFrom(req));
  }

  @Get('security-history')
  @ApiOperation({ summary: 'Platform-wide security history (REQ-203, Super Admin only).' })
  async platformSecurityHistory(@Actor() actor: ActorContext) {
    const events = await this.adminService.listPlatformSecurityHistory(actor);
    return { events };
  }

  @Delete('security-history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete security events older than the given instant (audited).' })
  async deleteSecurityHistory(@Actor() actor: ActorContext, @Body() dto: DeleteSecurityHistoryDto) {
    const deleted = await this.adminService.deleteSecurityHistory(actor, new Date(dto.olderThan));
    return { deleted };
  }
}