import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ForbiddenException, UnauthenticatedException } from '../http/app-error';
import type { ActorContext } from '../context/actor-context';

const BUSINESS_ID_PARAM = 'businessId';

/**
 * Tenant-boundary guard (app-level; RLS remains defense-in-depth).
 *
 * For business-scoped routes that carry a `businessId` route param, verifies
 * the actor's ownership BEFORE the handler runs:
 *   - Super Admin is permitted (elevated scope).
 *   - Owner must have the business in `ActorContext.ownedBusinessIds`
 *     (resolved from the `business_owner` matrix at session resolution).
 *
 * Routes that resolve the business from the session's active business
 * (`businessId` not in the URL) still must scope queries via businessId —
 * enforced by the repository layer (no id-only reads).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const actor = (req as Request & { actor?: ActorContext }).actor;
    if (!actor) throw new UnauthenticatedException();

    const businessId = (req.params as Record<string, string>)[BUSINESS_ID_PARAM];
    if (!businessId) return true; // no tenant param on this route; scoping by active business

    // Platform roles (Admin/Super Admin) with explicit scope can read across:
    if (actor.scope === 'SUPER_ADMIN' || actor.role === 'SuperAdmin') return true;

    if (!actor.ownedBusinessIds.includes(businessId)) {
      throw new ForbiddenException('You do not have access to this business.');
    }
    return true;
  }
}
