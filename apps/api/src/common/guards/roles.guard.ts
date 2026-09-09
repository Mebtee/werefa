import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleRank, type Role } from '@werefa/shared';
import { ROLES_KEY, type RoleGuardConfig } from '../decorators/roles.decorator';
import { ForbiddenException } from '../http/app-error';

/**
 * Role-based access control.
 * Requires a session-guard-validated actor. When @Roles(...) is absent on a
 * handler, any authenticated actor is allowed (ownership scoping happens via
 * the tenant guard / queries).
 *
 * Default behaviour uses the role hierarchy (SuperAdmin > Admin > Owner): a
 * higher-ranked role satisfies any lower requirement. Domains that must NOT
 * inherit by rank (e.g. owner-only business management) use @RolesExact(...)
 * for strict equality.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const declared = this.reflector.getAllAndOverride<Role[] | RoleGuardConfig>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!declared) return true;

    const roles: Role[] = Array.isArray(declared) ? declared : declared.roles;
    const exact = Array.isArray(declared) ? false : declared.exact === true;
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const actor = req.actor as { role?: Role } | undefined;
    if (!actor?.role) throw new ForbiddenException('Authenticated actor required.');

    const granted = exact
      ? roles.includes(actor.role)
      : roles.some((r) => (roleRank[actor.role as Role] ?? 0) >= (roleRank[r] ?? 0));
    if (!granted) {
      throw new ForbiddenException('You do not have the required role.');
    }
    return true;
  }
}
