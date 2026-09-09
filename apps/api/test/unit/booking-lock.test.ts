import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ErrorCodes, type ErrorCode } from '@werefa/shared';
import { ConflictException } from '../../apps/api/src/common/http/app-error';
import {
  isRetryableDbError,
  isUniqueViolation,
  runBookingTransaction,
} from '../../apps/api/src/booking/booking-lock';

/**
 * Prompt 11 — bounded retry and error classification (architecture doc 08 §6).
 *
 * `runBookingTransaction` wraps withTenantContext (which calls `$transaction`)
 * + advisory lock. We drive the real `withTenantContext` against a mock
 * PrismaService whose interactive `$transaction` raises synthetic Postgres
 * error objects with the relevant `code` properties, proving the retry loop's
 * ejection, backoff, and exhaustion semantics are correct without a live
 * database.
 */

function retryableError(code: string) {
  return Object.assign(new Error(`Simulated ${code}`), { code });
}

function makePrisma(throws: Array<unknown> | (() => unknown) = []) {
  let call = 0;
  return {
    $transaction: vi.fn(async (fn: Function) => {
      if (typeof throws === 'function') {
        const err = throws();
        if (err) throw err;
      } else {
        if (call < throws.length) throw throws[call++];
      }
      // The embedded tenant-context tx only needs to SET LOCAL the GUCs and
      // take the advisory lock.
      return fn({
        $executeRawUnsafe: vi.fn().mockResolvedValue([undefined]),
        $executeRaw: vi.fn().mockResolvedValue([undefined]),
      });
    }),
  } as unknown as import('../../apps/api/src/database/prisma.service').PrismaService;
}

describe('isRetryableDbError', () => {
  it('accepts serialization (40001), lock-not-available (40P01), deadlock (3D001)', () => {
    expect(isRetryableDbError(retryableError('40001'))).toBe(true);
    expect(isRetryableDbError(retryableError('40P01'))).toBe(true);
    expect(isRetryableDbError(retryableError('3D001'))).toBe(true);
  });

  it('rejects normal and unknown codes', () => {
    expect(isRetryableDbError(retryableError('23505'))).toBe(false);
    expect(isRetryableDbError(retryableError('P2002'))).toBe(false);
    expect(isRetryableDbError(new Error('network'))).toBe(false);
    expect(isRetryableDbError(null)).toBe(false);
    expect(isRetryableDbError(undefined)).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('detects P2002 unique violations and rejects other codes', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: '40001' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('runBookingTransaction bounded retry', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the result on first success without retrying', async () => {
    const prisma = makePrisma([]);
    const fn = vi.fn(async () => 'ok');
    const result = await runBookingTransaction(prisma, {}, 'biz', fn);
    expect(result).toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and returns on eventual success', async () => {
    const prisma = makePrisma([retryableError('40001'), retryableError('40P01')]);
    const fn = vi.fn(async () => 'ok');
    const result = await runBookingTransaction(prisma, {}, 'biz', fn);
    expect(result).toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('re-throws non-transient errors immediately without further attempts', async () => {
    const prisma = makePrisma([retryableError('23505')]);
    const fn = vi.fn();
    await runBookingTransaction(prisma, {}, 'biz', fn).then(
      () => {
        throw new Error('should have thrown');
      },
      (err: unknown) => {
        const typed = err as { code?: string };
        expect(typed.code).toBe('23505');
      },
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('re-throws AppException immediately (non-retryable domain error)', async () => {
    const domainError = new ConflictException('Concurrent ownership change.', ErrorCodes.CONFLICT);
    const prisma = makePrisma([domainError]);
    const fn = vi.fn();
    await runBookingTransaction(prisma, {}, 'biz', fn).then(
      () => {
        throw new Error('should have thrown');
      },
      (err: unknown) => {
        const typed = err as { code?: ErrorCode; httpStatus?: number };
        expect(typed.httpStatus).toBe(409);
        expect(typed.code).toBe(ErrorCodes.CONFLICT);
      },
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('throws ConflictException after exhausting the attempt budget', async () => {
    const prisma = makePrisma([
      retryableError('40001'),
      retryableError('40001'),
      retryableError('40001'),
    ]);
    const fn = vi.fn();
    await runBookingTransaction(prisma, {}, 'biz', fn).then(
      () => {
        throw new Error('should have thrown');
      },
      (err: unknown) => {
        const typed = err as { code?: ErrorCode; httpStatus?: number };
        expect(typed.httpStatus).toBe(409);
        expect(typed.code).toBe(ErrorCodes.CONFLICT);
      },
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(fn).not.toHaveBeenCalled();
  });
});
