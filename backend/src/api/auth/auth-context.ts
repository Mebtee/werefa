import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config';
import { ActorContext, ownerActor } from '../../domain/authorization/actor-context';

/**
 * HTTP authentication boundary (Prompt 42 §20).
 *
 * Authentication is DEFERRED; there is no real session/token system yet. The
 * controllers never trust client headers directly. They depend on an
 * `AuthContextResolver` that produces an explicit `ActorContext`. Two
 * implementations exist:
 *
 *  - `DeniedAuthContextResolver` (production default): every owner-scoped route
 *    fails with UNAUTHENTICATED until a real auth provider lands. No header,
 *    no cookie, no request field can ever grant access.
 *  - `TestAuthContextResolver` (development/tests only): resolves an actor from
 *    `X-Actor-Role` + `X-Actor-Id`. It is constructed ONLY when
 *    `AUTH_TEST_ENABLED` is truthy AND the environment is not production, and it
 *    hard-fails in its constructor otherwise — a belt-and-suspenders guard so a
 *    misconfigured production deploy can never instantiate it.
 */
export const AUTH_CONTEXT_RESOLVER = Symbol('AUTH_CONTEXT_RESOLVER');

export interface AuthContextResolver {
  resolve(req: Request): ActorContext;
}

export class DeniedAuthContextResolver implements AuthContextResolver {
  resolve(_req: Request): ActorContext {
    throw AppError.unauthenticated('Authentication is not implemented yet.');
  }
}

const TEST_HEADERS = {
  role: 'x-actor-role',
  id: 'x-actor-id',
} as const;

export class TestAuthContextResolver implements AuthContextResolver {
  constructor(config: AppConfig) {
    if (config.nodeEnv === 'production') {
      throw new Error('TestAuthContextResolver must never be used in production.');
    }
    if (!config.authTestEnabled) {
      throw new Error('TestAuthContextResolver requires AUTH_TEST_ENABLED=true.');
    }
  }

  resolve(req: Request): ActorContext {
    const role = String(req.headers[TEST_HEADERS.role] ?? '');
    const id = String(req.headers[TEST_HEADERS.id] ?? '');
    switch (role.toUpperCase()) {
      case 'OWNER':
        if (id) return ownerActor(id);
        break;
      case 'ADMIN':
        if (id) return { actorType: 'ADMIN', actorUserId: id };
        break;
      case 'SUPER_ADMIN':
        if (id) return { actorType: 'SUPER_ADMIN', actorUserId: id };
        break;
      case 'SYSTEM':
        return { actorType: 'SYSTEM', actorUserId: null };
      case 'CUSTOMER':
        return { actorType: 'CUSTOMER', actorUserId: null };
      default:
        break;
    }
    throw AppError.unauthenticated('A valid test actor context must be provided.');
  }
}