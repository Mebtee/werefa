import type { Prisma } from '@prisma/client';
import { tenantContextSql, type TenantContextValues } from '@werefa/db';
import type { PrismaService } from './prisma.service';

export type TenantTransaction = Prisma.TransactionClient;

/**
 * Run `fn` inside an interactive transaction with the tenant GUCs set via
 * `SET LOCAL` (doc 04 §4/§7). The app role enforces RLS, so tenant-scoped
 * queries MUST be performed inside a transaction that establishes context —
 * otherwise the policies filter every row (defense-in-depth, never bypassed).
 *
 * The GUCs are transaction-local and cleared automatically when the
 * transaction ends, so context never leaks onto pooled connections.
 */
export async function withTenantContext<T>(
  prisma: PrismaService,
  ctx: TenantContextValues,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(tenantContextSql(ctx));
    return fn(tx);
  });
}

/**
 * Convenience: run a tenant-context transaction for an owner acting within one
 * business scope (the common business-management path).
 */
export function withOwnerBusinessContext<T>(
  prisma: PrismaService,
  userId: string,
  businessId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return withTenantContext(prisma, { userId, businessId, scope: 'OWNER' }, fn);
}

/** Convenience: run a tenant-context transaction for a Super Admin flow. */
export function withSuperAdminContext<T>(
  prisma: PrismaService,
  userId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return withTenantContext(prisma, { userId, scope: 'SUPER_ADMIN' }, fn);
}

/**
 * Anonymous public read context (SELECT-only; business_public_select policy).
 * Used exclusively by the unauthenticated public business-page controllers.
 */
export function withPublicContext<T>(
  prisma: PrismaService,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return withTenantContext(prisma, { scope: 'PUBLIC' }, fn);
}
