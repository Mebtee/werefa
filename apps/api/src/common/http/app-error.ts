import { ErrorCodes, type ErrorCode, type ErrorEnvelope, type FieldError } from '@werefa/shared';

/**
 * Application-domain error carrying an error code mapped to an HTTP status.
 *
 * The controller/filter layer derives transport status from the typed error
 * (doc 23 §4) — never ad hoc 500s for domain failures.
 */
export class AppException extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly detail: string | null;
  readonly fields: FieldError[] | null;
  readonly safeForClient: boolean;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    opts: { detail?: string | null; fields?: FieldError[] | null; safeForClient?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppException';
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = opts.detail ?? null;
    this.fields = opts.fields ?? null;
    this.safeForClient = opts.safeForClient ?? true;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        title: this.message,
        detail: this.safeForClient ? this.detail : null,
        fields: this.fields ?? (this.code === ErrorCodes.VALIDATION_ERROR ? [] : null),
      },
    };
  }
}

export class ValidationException extends AppException {
  constructor(fields: FieldError[], detail = 'One or more fields are invalid.') {
    super(ErrorCodes.VALIDATION_ERROR, 400, 'Validation failed', { detail, fields });
  }
}

export class UnauthenticatedException extends AppException {
  constructor(detail = 'Authentication is required.') {
    super(ErrorCodes.UNAUTHENTICATED, 401, 'Authentication required', { detail });
  }
}

export class ForbiddenException extends AppException {
  constructor(detail = 'You do not have permission to perform this action.') {
    super(ErrorCodes.FORBIDDEN, 403, 'Forbidden', { detail });
  }
}

export class NotFoundException extends AppException {
  constructor(detail = 'The requested resource does not exist.') {
    super(ErrorCodes.NOT_FOUND, 404, 'Not found', { detail });
  }
}

export class ConflictException extends AppException {
  constructor(
    detail = 'The request conflicts with current state.',
    code: ErrorCode = ErrorCodes.CONFLICT,
  ) {
    super(code, 409, 'Conflict', { detail });
  }
}

export class TooManyRequestsException extends AppException {
  constructor(detail = 'Rate limit exceeded. Try again later.') {
    super(ErrorCodes.RATE_LIMITED, 429, 'Rate limited', { detail });
  }
}

export class AccountLockedException extends AppException {
  constructor(detail = 'Account temporarily locked due to repeated failures.') {
    super(ErrorCodes.ACCOUNT_LOCKED, 423, 'Account locked', { detail });
  }
}
