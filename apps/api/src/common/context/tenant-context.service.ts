import { Injectable } from '@nestjs/common';

/**
 * Tenant context service.
 *
 * Every tenant-owned repository query must pass an explicit businessId. This
 * service is the request-scoped holder of the *current* active business while a
 * handler runs; repositories receive the value explicitly rather than relying
 * on this global alone (doc 04 §4 — query scoping never trusts request id
 * alone).
 */
@Injectable()
export class TenantContextService {
  private businessIds = new Set<string>();
  private activeBusinessId: string | null = null;

  /** Register a business the actor owns (from session/ownership query). */
  addOwnedBusiness(id: string): void {
    this.businessIds.add(id);
  }

  setOwnedBusinesses(ids: string[]): void {
    this.businessIds = new Set(ids);
  }

  ownedBusinessIds(): ReadonlySet<string> {
    return this.businessIds;
  }

  setActiveBusiness(id: string): void {
    if (!this.businessIds.has(id)) {
      throw new Error(`Active business ${id} is not in the actor's owned set`);
    }
    this.activeBusinessId = id;
  }

  getActiveBusiness(): string | null {
    return this.activeBusinessId;
  }
}
