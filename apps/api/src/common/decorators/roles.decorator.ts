import { SetMetadata } from '@nestjs/common';
import type { Role } from '@werefa/shared';

/** Metadata key for role access control. */
export const ROLES_KEY = 'werefa:roles';

export interface RoleGuardConfig {
  roles: Role[];
  exact?: boolean;
}

/**
 * Declare the roles allowed to access a handler/controller using the role
 * hierarchy (a role with a higher rank satisfies any lower requirement).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, { roles });

/**
 * Declare roles with STRICT equality: the actor's role must be exactly one of
 * the listed roles, regardless of rank. Used for owner-only domains where
 * Admins/Super Admins must NOT inherit business-owner capabilities by rank
 * (REQ "Admin cannot perform owner-only operations").
 */
export const RolesExact = (...roles: Role[]) => SetMetadata(ROLES_KEY, { roles, exact: true });
