import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Per-business transactional advisory lock (architecture doc 08 §5, ADR-004;
 * Prompt 41 §6).
 *
 * Every booking/slot/payment/subscription mutation must run inside this helper:
 * the caller's `fn` executes within a database transaction that already holds
 * `pg_advisory_xact_lock(hashtext(business_id::text))`. The lock serializes all
 * mutations for one business so the authoritative logic (overlap re-check then
 * claim) is race-free; the partial unique indexes are defense-in-depth.
 */
export async function withBusinessAdvisoryLock<T>(
  prisma: PrismaClient,
  businessId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`;
    return fn(tx);
  });
}