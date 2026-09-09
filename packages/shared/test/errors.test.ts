import { describe, it, expect } from 'vitest';
import { ErrorCodes, isErrorCode, type ErrorCode, type ErrorEnvelope } from '../src';

describe('ErrorCodes', () => {
  it('contains all expected codes', () => {
    const codes: ErrorCode[] = [
      'VALIDATION_ERROR',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'SLOT_UNAVAILABLE',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'ACCOUNT_LOCKED',
      'VERIFICATION_REQUIRED',
      'TOKEN_EXPIRED',
      'TOKEN_USED',
      'PAYMENT_REJECTED',
      'PAYMENT_PENDING',
      'INVALID_TRANSITION',
      'SCHEDULE_AFFECTED',
      'SUBSCRIPTION_EXPIRED',
      'BUSINESS_PAUSED',
      'FILE_TOO_LARGE',
      'FILE_TYPE_INVALID',
      'INVALID_SIGNATURE',
    ];
    for (const c of codes) {
      expect(ErrorCodes[c]).toBe(c);
    }
  });

  it('rejects unknown codes via isErrorCode', () => {
    expect(isErrorCode('UNKNOWN')).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(123)).toBe(false);
  });

  it('accepts valid codes via isErrorCode', () => {
    expect(isErrorCode('VALIDATION_ERROR')).toBe(true);
    expect(isErrorCode('RATE_LIMITED')).toBe(true);
  });
});

describe('ErrorEnvelope type shape', () => {
  it('validates structural shape at compile/runtime', () => {
    const envelope: ErrorEnvelope = {
      error: {
        code: 'NOT_FOUND',
        title: 'Not found',
        detail: 'The requested resource does not exist.',
        fields: null,
      },
    };
    expect(envelope.error.code).toBe('NOT_FOUND');
    expect(envelope.error.fields).toBeNull();
  });
});
