import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { ActorContext } from '../../domain/authorization/actor-context';
import { AUTH_CONTEXT_RESOLVER, AuthContextResolver } from './auth-context';
import { Inject } from '@nestjs/common';

const ACTOR_CONTEXT_PROPERTY = 'actorContext';

export interface AuthenticatedRequest extends Request {
  [ACTOR_CONTEXT_PROPERTY]?: ActorContext;
}

/**
 * Route guard that resolves the explicit ActorContext for the HTTP request.
 * Applied to owner-scoped controllers. The resolution is environment-gated
 * (production always denies); the TenantGuard in the domain services is the
 * authorization boundary for owner/membership checks.
 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_CONTEXT_RESOLVER) private readonly resolver: AuthContextResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    req[ACTOR_CONTEXT_PROPERTY] = await this.resolver.resolve(req);
    return true;
  }
}

/** Param decorator that injects the authenticated ActorContext. */
export const Actor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActorContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request[ACTOR_CONTEXT_PROPERTY]) {
      throw new Error('ActorContext was not resolved for this request. Apply ApiAuthGuard.');
    }
    return request[ACTOR_CONTEXT_PROPERTY]!;
  },
);

export { ACTOR_CONTEXT_PROPERTY };