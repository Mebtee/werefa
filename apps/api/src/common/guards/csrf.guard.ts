import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/environment';
import { ForbiddenException } from '../http/app-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense (doc 14 §5 / doc 18 §1): SameSite=Lax cookie + a required custom
 * header on every state-changing request that carries a session cookie. Public
 * (cookie-less) endpoints are unaffected. Applied globally.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method?.toUpperCase() ?? 'GET';
    if (SAFE_METHODS.has(method)) return true;

    const hasSessionCookie = Boolean(req.cookies?.[this.config.sessionCookieName]);
    if (!hasSessionCookie) return true;

    if ((req.headers['x-requested-with'] ?? '') !== 'fetch') {
      throw new ForbiddenException('Cross-site request blocked.');
    }
    return true;
  }
}
