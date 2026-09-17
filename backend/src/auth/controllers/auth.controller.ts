import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response, Request as ExpressRequest } from 'express';
import { AppConfig } from '../../config/app-config';
import { CONFIG } from '../../config/config.constants';
import { ActorContext } from '../../domain/authorization/actor-context';
import { AuthService, ClientInfo, LoginOutcome } from '../../domain/services/auth.service';
import { AdminManagementService } from '../../domain/services/admin-management.service';
import { sessionCookieOptions } from '../cookie-utils';
import { clientInfoFrom } from '../client-info';
import { Actor, ApiAuthGuard } from '../../api/auth/api-auth.guard';
import { ChangePasswordDto, LoginDto } from './auth.dto';

/**
 * Authentication endpoints (Prompt 43; REQ-035, REQ-191–193, REQ-218).
 *
 * Sessions are delivered as an httpOnly SameSite=Lax cookie carrying an opaque
 * token (hashed at rest). The cookie is cleared on logout. Failed logins are
 * generic 401s; lockout is an explicit 423. Every login attempt records a
 * security event.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AdminManagementService) private readonly adminService: AdminManagementService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email + password, issuing an httpOnly session cookie.' })
  async login(@Body() dto: LoginDto, @Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    const client: ClientInfo = clientInfoFrom(req);
    const outcome: LoginOutcome = await this.authService.login({
      email: dto.email,
      password: dto.password,
      client,
    });
    res.cookie(
      this.config.authCookieName,
      outcome.sessionToken,
      sessionCookieOptions(this.config.nodeEnv, this.config.authSessionTtlHours),
    );
    return {
      expiresAt: outcome.expiresAt,
      user: { id: outcome.userId, role: outcome.role },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the session and clear the cookie (idempotent; no prior session required).' })
  async logout(@Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = parseCookies(req.headers.cookie);
    await this.authService.logout(cookies[this.config.authCookieName]);
    res.clearCookie(this.config.authCookieName);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiAuthGuard)
  @ApiOperation({ summary: 'Change password; invalidates every session (Owner/Super Admin only).' })
  async changePassword(@Actor() actor: ActorContext, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.authService.changePassword(actor, {
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  @Get('security')
  @UseGuards(ApiAuthGuard)
  @ApiOperation({ summary: 'Own security event history (login, lockout, password change, ...).' })
  async securityHistory(@Actor() actor: ActorContext) {
    const events = await this.adminService.listOwnSecurityHistory(actor);
    return { events };
  }

  @Get('session')
  @UseGuards(ApiAuthGuard)
  @ApiOperation({ summary: 'Return the authenticated principal for the current session (Prompt 44 session restoration).' })
  async session(@Actor() actor: ActorContext) {
    const user = await this.authService.principalFor(actor);
    return { user };
  }
}

function parseCookies(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const seg of raw.split(';')) {
    const trimmed = seg.trim();
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return result;
}