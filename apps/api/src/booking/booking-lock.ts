import type { Prisma } from '@prisma/client';
import {
  withTenantContext,
  withOwnerBusinessContext,
  type TenantTransaction,
} from '../database/tenant-executor';
import type { PrismaService } from '../database/prisma.service';
import { ConflictException } from '../common/http/app-error';

/**
 * Transaction-scoped per-business advisory lock (architecture doc 08 §3).
 *
 * Every booking/slot-claim mutation path MUST run under this lock so that the
 * in-transaction availability re-check and the guarded state updates are
 * serialized for the business. The partial unique index on active slot locks
 * is defense-in-depth ONLY; overlap prevention is this lock + the authoritative
 * re-check inside it (doc 08 §1/§3.1).
 */
export async function withBusinessAdvisoryLock<T>(
  tx: TenantTransaction,
  businessId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}::text))`;
  return fn();
}

/** Owner-scoped tenant transaction that immediately takes the business lock. */
export function withOwnerBookingLock<T>(
  prisma: PrismaService,
  userId: string,
  businessId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return withOwnerBusinessContext(prisma, userId, businessId, (tx) =>
    withBusinessAdvisoryLock(tx, businessId, () => fn(tx)),
  );
}

/** Tenant transaction with an arbitrary context that also takes the business lock. */
export function withBookingLock<T>(
  prisma: PrismaService,
  ctx: Parameters<typeof withTenantContext>[1],
  businessId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return withTenantContext(prisma, ctx, (tx) =>
    withBusinessAdvisoryLock(tx, businessId, () => fn(tx)),
  );
}

const RETRYABLE_STATES = new Set(['40001', '40P01', '3D001']);

/** True for transient Postgres errors that justify a bounded retry (doc 08 §6). */
export function isRetryableDbError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    RETRYABLE_STATES.has((err as { code?: string }).code ?? '')
  );
}

/**
 * Bounded retry around a serialized booking mutation (doc 08 §6). Default 3
 * attempts with exponential backoff; never retries non-transient failures.
 * Non-retryable AppExceptions propagate immediately.
 */
export async function runBookingTransaction<T>(
  prisma: PrismaService,
  ctx: Parameters<typeof withTenantContext>[1],
  businessId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
  opts: { attempts?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTenantContext(prisma, ctx, (tx) =>
        withBusinessAdvisoryLock(tx, businessId, () => fn(tx)),
      );
    } catch (err) {
      if (!isRetryableDbError(err)) throw err;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 25 * attempt * attempt));
      }
    }
  }
  throw new ConflictException('The operation could not be completed. Please retry.');
}

/** Prisma unique-violation detection (P2002), mapped to a slot-unavailable result. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

export type { Prisma };
