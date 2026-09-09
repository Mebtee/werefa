export interface FieldError {
  field: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    title: string;
    detail: string | null;
    fields: FieldError[] | null;
  };
}

/**
 * Application error codes (architecture doc 23, aligned).
 * Legacy eslint-disable-next-line is not needed; no rules require it here.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_USED: 'TOKEN_USED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  SCHEDULE_AFFECTED: 'SCHEDULE_AFFECTED',
  SCHEDULE_INVALID: 'SCHEDULE_INVALID',
  SCHEDULE_OVERLAP: 'SCHEDULE_OVERLAP',
  SCHEDULE_DUPLICATE: 'SCHEDULE_DUPLICATE',
  TELEGRAM_UNAVAILABLE: 'TELEGRAM_UNAVAILABLE',
  TELEGRAM_TOKEN_EXPIRED: 'TELEGRAM_TOKEN_EXPIRED',
  TELEGRAM_TOKEN_USED: 'TELEGRAM_TOKEN_USED',
  TELEGRAM_INVALID_CHAT: 'TELEGRAM_INVALID_CHAT',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  BUSINESS_PAUSED: 'BUSINESS_PAUSED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_INVALID: 'FILE_TYPE_INVALID',
  CONFLICT: 'CONFLICT',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (Object.values(ErrorCodes) as string[]).includes(value);
}
