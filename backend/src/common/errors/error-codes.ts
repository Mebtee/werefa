/**
 * Error taxonomy and codes.
 *
 * Source of truth: architecture doc 23 (Error Handling) §1, driven by spec §33.
 * Only codes defined in the architecture are present; the backend may not invent
 * codes. HTTP status mapping is preserved from the architecture.
 *
 * Non-structural placeholder: full cross-domain usage of every code is completed
 * in later implementation phases; this enum establishes the contract boundary so
 * that all future modules use the same vocabulary.
 */

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  VERIFICATION_REQUIRED = 'VERIFICATION_REQUIRED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_USED = 'TOKEN_USED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  SLOT_UNAVAILABLE = 'SLOT_UNAVAILABLE',
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  INVALID_TRANSITION = 'INVALID_TRANSITION',
  SCHEDULE_AFFECTED = 'SCHEDULE_AFFECTED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  BUSINESS_PAUSED = 'BUSINESS_PAUSED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_TYPE_INVALID = 'FILE_TYPE_INVALID',
  CONFLICT = 'CONFLICT',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export const ERROR_CODE_TO_HTTP: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.VERIFICATION_REQUIRED]: 403,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_USED]: 409,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.SLOT_UNAVAILABLE]: 409,
  [ErrorCode.PAYMENT_REJECTED]: 409,
  [ErrorCode.PAYMENT_PENDING]: 409,
  [ErrorCode.INVALID_TRANSITION]: 409,
  [ErrorCode.SCHEDULE_AFFECTED]: 409,
  [ErrorCode.SUBSCRIPTION_EXPIRED]: 422,
  [ErrorCode.BUSINESS_PAUSED]: 422,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.FILE_TYPE_INVALID]: 415,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INVALID_SIGNATURE]: 401,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
};