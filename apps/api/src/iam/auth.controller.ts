import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { API_PREFIX } from '@werefa/shared';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { Actor } from '../common/decorators/actor.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { type ActorContext } from '../common/context/actor-context';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SecurityEventService } from './security-events.service';
import { PasswordResetService } from './reset-token.service';
import { EmailVerificationService } from './email-verification.service';
import { RateLimitService } from './rate-limit.service';
import { bodyObject, readString } from './validation';
import { clientMetadata } from './client-metadata';
import { clearSessionCookie, writeSessionCookie } from './cookies';

/**
 * Identity/auth endpoints (REQ-024/033/035, R191–R197, Prompt 08 §3–§8).
 * Login/logout/password change are cookie-session based; reset request/complete
 * are public + rate-limited with no account-existence disclosure.
 */
@Controller(`${API_PREFIX}/auth`)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly security: SecurityEventService,
    private readonly resets: PasswordResetService,
    private readonly verifications: EmailVerificationService,
    private readonly rateLimits: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    user: { id: string; email: string; role: string };
    session: { expiresAt: string };
  }> {
    const payload = bodyObject(body);
    const email = readString(payload, 'email', { required: true, email: true, max: 255 })!;
    const password = readString(payload, 'password', { required: true })!;
    const ip = req.ip;

    await this.rateLimits.check(
      `auth:login:${ip ?? 'unknown'}`,
      this.config.authRateLimitMax,
      this.config.authRateLimitWindowMs,
    );

    const result = await this.auth.login(email, password, ip, req.headers['user-agent']);
    writeSessionCookie(res, result.session.token, this.config);
    return {
      user: result.user,
      session: { expiresAt: result.session.expiresAt.toISOString() },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async logout(
    @Actor() actor: ActorContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const meta = clientMetadata(req.headers['user-agent'], req.ip);
    await this.sessions.revokeSession(actor.sessionId);
    await this.security.record({
      type: 'LOGOUT',
      userId: actor.userId,
      ip: req.ip,
      device: meta.device,
      browser: meta.browser,
      result: 'SUCCESS',
    });
    clearSessionCookie(res, this.config);
  }

  @Get('me')
  @UseGuards(SessionGuard, RolesGuard)
  async me(@Actor() actor: ActorContext): Promise<{
    userId: string;
    email: string;
    role: string;
    businessId: string | undefined;
    ownedBusinessIds: string[];
  }> {
    const email = await this.auth.profileEmail(actor.userId);
    return {
      userId: actor.userId,
      email,
      role: actor.role,
      businessId: actor.businessId,
      ownedBusinessIds: actor.ownedBusinessIds,
    };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async changePassword(
    @Actor() actor: ActorContext,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const payload = bodyObject(body);
    const currentPassword = readString(payload, 'currentPassword', { required: true })!;
    const newPassword = readString(payload, 'newPassword', { required: true })!;
    const ip = req.ip;
    await this.auth.changePassword(
      actor,
      currentPassword,
      newPassword,
      ip,
      req.headers['user-agent'],
    );
    clearSessionCookie(res, this.config);
  }

  @Post('password/reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Public()
  async requestReset(@Body() body: unknown, @Req() req: Request): Promise<{ message: string }> {
    const payload = bodyObject(body);
    const email = readString(payload, 'email', { required: true, email: true, max: 255 })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `auth:reset-request:${ip ?? 'unknown'}`,
      this.config.authRateLimitMax,
      this.config.authRateLimitWindowMs,
    );
    return this.resets.request(email, ip, req.headers['user-agent']);
  }

  @Post('password/reset/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async completeReset(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const payload = bodyObject(body);
    const token = readString(payload, 'token', { required: true })!;
    const newPassword = readString(payload, 'newPassword', { required: true })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `auth:reset-complete:${ip ?? 'unknown'}`,
      this.config.authRateLimitMax,
      this.config.authRateLimitWindowMs,
    );
    await this.resets.complete(token, newPassword, ip, req.headers['user-agent']);
  }

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Public()
  async register(@Body() body: unknown, @Req() req: Request): Promise<{ message: string }> {
    const payload = bodyObject(body);
    const email = readString(payload, 'email', { required: true, email: true, max: 255 })!;
    const password = readString(payload, 'password', { required: true })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `auth:register:${ip ?? 'unknown'}`,
      this.config.authRateLimitMax,
      this.config.authRateLimitWindowMs,
    );
    return this.verifications.register(email, password, ip, req.headers['user-agent']);
  }

  @Post('verify-email/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Public()
  async requestVerification(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const payload = bodyObject(body);
    const email = readString(payload, 'email', { required: true, email: true, max: 255 })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `auth:verify-request:${ip ?? 'unknown'}`,
      this.config.authRateLimitMax,
      this.config.authRateLimitWindowMs,
    );
    return this.verifications.request(email, ip, req.headers['user-agent']);
  }

  @Post('verify-email/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Public()
  async completeVerification(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const payload = bodyObject(body);
    const token = readString(payload, 'token', { required: true })!;
    const ip = req.ip;
    await this.rateLimits.check(
      `auth:verify-complete:${ip ?? 'unknown'}`,
      this.config.authRateLimitMax,
      this.config.authRateLimitWindowMs,
    );
    await this.verifications.complete(token, ip, req.headers['user-agent']);
  }

  @Get('ping')
  @HttpCode(HttpStatus.OK)
  ping(): { ok: true; at: string } {
    return { ok: true, at: new Date().toISOString() };
  }
}
