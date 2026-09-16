import { describe, expect, it } from 'vitest';
import { ErrorCode, ERROR_CODE_TO_HTTP } from './error-codes';

describe('error taxonomy (doc 23 §1)', () => {
  it('provides the full architecture code set', () => {
    const codes = Object.values(ErrorCode);
    expect(codes).toHaveLength(21);
    for (const code of ['VALIDATION_ERROR', 'RATE_LIMITED', 'INTERNAL_ERROR', 'SLOT_UNAVAILABLE'] as ErrorCode[]) {
      expect(codes).toContain(code);
    }
  });

  it('maps codes to the architecture HTTP statuses', () => {
    expect(ERROR_CODE_TO_HTTP[ErrorCode.VALIDATION_ERROR]).toBe(400);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.UNAUTHENTICATED]).toBe(401);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.FORBIDDEN]).toBe(403);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.NOT_FOUND]).toBe(404);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.SLOT_UNAVAILABLE]).toBe(409);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.SUBSCRIPTION_EXPIRED]).toBe(422);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.FILE_TOO_LARGE]).toBe(413);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.RATE_LIMITED]).toBe(429);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.ACCOUNT_LOCKED]).toBe(423);
    expect(ERROR_CODE_TO_HTTP[ErrorCode.INTERNAL_ERROR]).toBe(500);
  });
});