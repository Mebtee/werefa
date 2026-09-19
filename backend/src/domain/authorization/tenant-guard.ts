import { Inject, Injectable } from '@nestjs/common';
import { BusinessWithOwner } from '../repositories/business.repository.port';
import { BUSINESS_REPOSITORY } from '../repositories/tokens';
import { BusinessRepository } from '../repositories/business.repository.port';
import { domainErrors } from '../errors/domain-errors';
import { ActorContext, isAdminOrSuperAdmin, isOwner, isSuperAdmin, isSystem } from './actor-context';

/**
 * Explicit tenant authorization boundary (Prompt 41 §25, doc 04).
 *
 * Owner-scoped operations go through `requireOwnedBusiness`; the membership
 * check resolves the owning business inside the query path rather than trusting
 * a client-supplied tenant id. A non-owner (or a non-member) receives NOT_FOUND
 * so resource existence is never leaked. Platform administration uses a
 * separate role gate; the System actor drives automatic lifecycle duties.
 */
@Injectable()
export class TenantGuard {
  constructor(@Inject(BUSINESS_REPOSITORY) private readonly businessRepo: BusinessRepository) {}

  async requireOwnedBusiness(ctx: ActorContext, businessId: string): Promise<BusinessWithOwner> {
    if (!isOwner(ctx) || !ctx.actorUserId) {
      throw domainErrors.unauthorizedTenantAccess('This operation requires an owner context.');
    }
    const business = await this.businessRepo.findById(businessId);
    if (!business || !business.owners.some((o) => o.userId === ctx.actorUserId)) {
      throw domainErrors.businessNotFound();
    }
    return business;
  }

  requireAdminOrSuperAdmin(ctx: ActorContext): void {
    if (!isAdminOrSuperAdmin(ctx)) {
      throw domainErrors.unauthorizedTenantAccess('This operation requires an admin or super admin context.');
    }
  }

  requireSuperAdmin(ctx: ActorContext): void {
    if (!isSuperAdmin(ctx)) {
      throw domainErrors.unauthorizedTenantAccess('This operation requires a super admin context.');
    }
  }

  requireSystem(ctx: ActorContext): void {
    if (!isSystem(ctx)) {
      throw domainErrors.unauthorizedTenantAccess('This operation requires a system context.');
    }
  }
}