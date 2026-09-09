import { describe, expect, it } from 'vitest';
import { roleRank, Role } from '@werefa/shared';
import { RolesGuard } from '../../apps/api/src/common/guards/roles.guard';
import { ROLES_KEY } from '../../apps/api/src/common/decorators/roles.decorator';
import { ErrorCodes } from '@werefa/shared';

function contextFor(actor: { role?: Role } | undefined, roles: Role[] | undefined) {
  const reflector = {
    getAllAndOverride: (key: unknown) => (key === ROLES_KEY ? roles : undefined),
  };
  const guard = new RolesGuard(reflector as never);
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ actor }),
    }),
  } as never;

  return { guard, ctx };
}

function expectForbidden(fn: () => unknown): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect((err as { code?: string }).code).toBe(ErrorCodes.FORBIDDEN);
}

describe('RolesGuard', () => {
  it('allows through when no @Roles is declared', () => {
    const { guard, ctx } = contextFor({ role: Role.Owner }, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when the actor role satisfies the requirement', () => {
    const { guard, ctx } = contextFor({ role: Role.Admin }, [Role.Admin]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('enforces the role hierarchy Admin >= Owner', () => {
    const adminOnOwner = contextFor({ role: Role.Admin }, [Role.Owner]);
    expect(adminOnOwner.guard.canActivate(adminOnOwner.ctx)).toBe(true);

    const ownerOnAdmin = contextFor({ role: Role.Owner }, [Role.Admin]);
    expectForbidden(() => ownerOnAdmin.guard.canActivate(ownerOnAdmin.ctx));
  });

  it('lets SuperAdmin satisfy Admin and Owner requirements', () => {
    for (const req of [Role.Owner, Role.Admin, Role.SuperAdmin]) {
      const { guard, ctx } = contextFor({ role: Role.SuperAdmin }, [req]);
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('rejects an actor without a role', () => {
    const { guard, ctx } = contextFor(undefined, [Role.Admin]);
    expectForbidden(() => guard.canActivate(ctx));
  });

  it('roleRank matches the documented hierarchy', () => {
    expect(roleRank[Role.Owner]).toBe(1);
    expect(roleRank[Role.Admin]).toBe(2);
    expect(roleRank[Role.SuperAdmin]).toBe(3);
  });
});
