import type { PrismaClient } from '@prisma/client';

/**
 * Base tenant-scoped repository.
 *
 * Conventions enforced by the architecture (doc 04 §4, doc 07 §1):
 *  - Every tenant-entity lookup goes through a businessId-scoped method.
 *  - There is NO bare "getById" that lacks a tenant parameter.
 *  - Query scoping always includes businessId (or the ownership join).
 */
export abstract class TenantRepository<T> {
  protected abstract readonly table: string;

  constructor(protected readonly db: PrismaClient) {}

  /**
   * Read a single entity by its primary key AND business id.
   * Returns null when it does not belong to the given business (never leaks
   * existence across tenants).
   */
  abstract getByBusinessId(businessId: string, id: string): Promise<T | null>;

  protected assertBusinessId(businessId: string, id: string): void {
    if (!businessId || !id) {
      // Should never happen given typed callers; guard against accidental
      // empty scoping.
      throw new Error(
        `TenantRepository: businessId and id are required (table=${this.table}). Refusing unscoped access.`,
      );
    }
  }
}
