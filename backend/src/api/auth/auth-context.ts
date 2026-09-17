import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config';
import { CONFIG } from '../../config/config.constants';
import { ActorContext, ownerActor } from '../../domain/authorization/actor-context';
import { AuthService } from '../../domain/services/auth.service';
import { parseCookieHeader } from '../../auth/cookie-utils';

/**
 * HTTP authentication boundary (Prompt 43 §20).
 *
 * Controllers never trust client headers directly. They depend on an
 * `AuthContextResolver` that produces an explicit `ActorContext`. Two
 * implementations exist:
 *
 *  - `SessionAuthContextResolver` (default): resolves the actor from the
 *    httpOnly session cookie — the opaque token is sha-256 hashed and looked up
 *    against a valid (non-revoked, non-expired) session row; the owning user
 *    must still exist and not be deactivated. Invalid inputs all collapse to a
 *    single UNAUTHENTICATED error, so the resolver reveals nothing about
 *    whether a token, session or user exists.
 *  - `TestAuthContextResolver` (development/tests only): resolves an actor from
 *    `X-Actor-Role` + `X-Actor-Id`. It is constructed ONLY when
 *    `AUTH_TEST_ENABLED` is truthy AND the environment is not production, and it
 *    hard-fails in its constructor otherwise — a belt-and-suspenders guard so a
 *    misconfigured production deploy can never instantiate it.
 */
export const AUTH_CONTEXT_RESOLVER = Symbol('AUTH_CONTEXT_RESOLVER');

export interface AuthContextResolver {
  resolve(req: Request): Promise<ActorContext>;
}

/** Production default: real server-side session → actor resolution. */
export class SessionAuthContextResolver implements AuthContextResolver {
  constructor(
    private readonly config: AppConfig,
    private readonly authService: AuthService,
  ) {}

  async resolve(req: Request): Promise<ActorContext> {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[this.config.authCookieName];
    return this.authService.resolveActorFromToken(token);
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

  async resolve(req: Request): Promise<ActorContext> {
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

/** Selects the resolver at construction time: test bridge or real sessions. */
export function authContextResolverFactory(config: AppConfig, authService: AuthService): AuthContextResolver {
  if (config.authTestEnabled && config.nodeEnv !== 'production') {
    return new TestAuthContextResolver(config);
  }
  return new SessionAuthContextResolver(config, authService);
}

/**
 * NestJS provider descriptor for AUTH_CONTEXT_RESOLVER. Registered once per
 * module scope that consumes guards (AuthModule's own controllers and the
 * ApiModule owner/admin controllers). Both scopes are stateless resolvers, so
 * two instances are equivalent.
 */
export const AUTH_CONTEXT_RESOLVER_PROVIDER = {
  provide: AUTH_CONTEXT_RESOLVER,
  inject: [CONFIG, AuthService],
  useFactory: (config: AppConfig, authService: AuthService): AuthContextResolver =>
    authContextResolverFactory(config, authService),
};