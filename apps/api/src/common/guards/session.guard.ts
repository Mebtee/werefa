import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config/environment';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException, UnauthenticatedException } from '../http/app-error';
import { SessionService } from '../../iam/session.service';
import type { ActorContext } from '../context/actor-context';
import { Role } from '@werefa/shared';

/**
 * Validates the session cookie against the session store and attaches
 * `ActorContext` to the request. Skips when handler is `@Public()`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[this.config.sessionCookieName];
    if (!token) throw new UnauthenticatedException('Missing session cookie.');

    let actor: ActorContext;
    try {
      actor = await this.sessions.resolveToken(token, req.ip);
    } catch (err) {
      if (err instanceof AppException) throw err;
      throw new AppException('INTERNAL_ERROR', 500, 'Unable to resolve session');
    }

    (req as Request & { actor: ActorContext }).actor = {
      ...actor,
      role: actor.role ?? Role.Owner,
    } as ActorContext;
    return true;
  }
}
