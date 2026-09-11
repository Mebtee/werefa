import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { API_PREFIX, Role } from '@werefa/shared';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { Actor } from '../common/decorators/actor.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { type ActorContext } from '../common/context/actor-context';
import { SuperAdminService, type AdminListItem } from './super-admin.service';
import { RecoveryService } from './recovery.service';
import { RateLimitService } from './rate-limit.service';
import { bodyObject, readString } from './validation';

/** Super Admin admin-lifecycle endpoints (REQ-217..221); SuperAdmin only. */
@Controller(`${API_PREFIX}/super-admin`)
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.SuperAdmin)
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Get('admins')
  listAdmins(): Promise<{ admins: AdminListItem[] }> {
    return this.service.listAdmins();
  }

  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  async createAdmin(
    @Actor() actor: ActorContext,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ id: string; email: string }> {
    const payload = bodyObject(body);
    const email = readString(payload, 'email', { required: true, email: true, max: 255 })!;
    const password = readString(payload, 'password', { required: true })!;
    void actor;
    return this.service.createAdmin(email, password, req.ip, req.headers['user-agent']);
  }

  @Post('admins/:id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateAdmin(
    @Actor() actor: ActorContext,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    void actor;
    await this.service.deactivateAdmin(id, req.ip, req.headers['user-agent']);
  }

  @Post('admins/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivateAdmin(
    @Actor() actor: ActorContext,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    void actor;
    await this.service.reactivateAdmin(id, req.ip, req.headers['user-agent']);
  }

  @Post('admins/:id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeAdminPassword(
    @Actor() actor: ActorContext,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<void> {
    const payload = bodyObject(body);
    const newPassword = readString(payload, 'newPassword', { required: true })!;
    void actor;
    await this.service.changeAdminPassword(id, newPassword, req.ip, req.headers['user-agent']);
  }

  @Post('logout/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forceLogout(
    @Actor() actor: ActorContext,
    @Param('userId') userId: string,
    @Req() req: Request,
  ): Promise<void> {
    void actor;
    await this.service.forceLogout(userId, req.ip, req.headers['user-agent']);
  }
}

/** Public emergency recovery surface (REQ-198..200) — strictly rate limited. */
@Controller(`${API_PREFIX}/super-admin/recovery`)
@Public()
export class RecoveryController {
  constructor(
    private readonly recovery: RecoveryService,
    private readonly rateLimits: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  async request(@Body() body: unknown, @Req() req: Request): Promise<{ message: string }> {
    const payload = bodyObject(body);
    const recoveryEmail = readString(payload, 'recoveryEmail', {
      required: true,
      email: true,
      max: 255,
    })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `recovery:request:${ip ?? 'unknown'}`,
      this.config.recoveryRateLimitMax,
      this.config.recoveryRateLimitWindowMs,
    );
    return this.recovery.request(recoveryEmail, ip, req.headers['user-agent']);
  }

  @Post('complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const payload = bodyObject(body);
    const code = readString(payload, 'code', { required: true })!;
    const newPassword = readString(payload, 'newPassword', { required: true })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `recovery:complete:${ip ?? 'unknown'}`,
      this.config.recoveryRateLimitMax,
      this.config.recoveryRateLimitWindowMs,
    );
    await this.recovery.complete(code, newPassword, ip, req.headers['user-agent']);
  }
}
