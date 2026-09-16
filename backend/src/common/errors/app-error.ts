import { ErrorCode, ERROR_CODE_TO_HTTP } from './error-codes';

export type ErrorFields = Record<string, string>;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    title: string;
    detail?: string;
    fields: ErrorFields | null;
  };
}

export interface AppErrorOptions {
  code: ErrorCode;
  title: string;
  detail?: string;
  status?: number;
  fields?: ErrorFields | null;
  /** Internal-only context (logged, never serialized). */
  internalContext?: string;
}

/**
 * Typed application error. HTTP status is derived from the code taxonomy by
 * default; a caller may override status only for codes whose architecture
 * mapping allows no ambiguity (e.g. VALIDATION_ERROR stays 400).
 *
 * Serialization complies with spec §33 / doc 23 §2: code, title, detail,
 * fields. Stack traces, internal identifiers and SQL text are never serialized.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly fields: ErrorFields | null;
  readonly internalContext?: string;

  constructor(options: AppErrorOptions) {
    super(options.code);
    this.name = 'AppError';
    this.code = options.code;
    this.title = options.title;
    this.status = options.status ?? ERROR_CODE_TO_HTTP[options.code];
    this.detail = options.detail;
    this.fields = options.fields ?? null;
    this.internalContext = options.internalContext;
  }

  static validation(fields: ErrorFields, detail?: string): AppError {
    return new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      title: 'Invalid request',
      detail,
      status: 400,
      fields,
    });
  }

  static notFound(detail = 'Requested resource not found.'): AppError {
    return new AppError({ code: ErrorCode.NOT_FOUND, title: 'Not found', detail });
  }

  static unauthenticated(detail = 'Authentication is required.'): AppError {
    return new AppError({ code: ErrorCode.UNAUTHENTICATED, title: 'Unauthenticated', detail });
  }

  static forbidden(detail = 'You are not allowed to perform this action.'): AppError {
    return new AppError({ code: ErrorCode.FORBIDDEN, title: 'Forbidden', detail });
  }

  toEnvelope(): ErrorEnvelope {
    const payload: ErrorEnvelope = {
      error: { code: this.code, title: this.title, fields: this.fields },
    };
    if (this.detail) payload.error.detail = this.detail;
    return payload;
  }
}

/**
 * Validation-payload error carried by the transport layer. Produced by the
 * global ValidationPipe exception factory so field errors serialize identically.
 */
export class ValidationRejectedException extends AppError {
  constructor(fields: ErrorFields, detail?: string) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      title: 'Invalid request',
      detail,
      status: 400,
      fields,
    });
  }
}