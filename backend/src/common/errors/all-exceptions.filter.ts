import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from 'pino';
import { getRequestContext } from '../context/request-context';
import { AppError, ErrorEnvelope } from './app-error';
import { ErrorCode, ERROR_CODE_TO_HTTP } from './error-codes';
import { LOGGER } from '../logging/logging.module';

interface SafelyMappedPayload {
  status: number;
  code: ErrorCode;
  title?: string;
  detail?: string;
}

function mapHttpStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return ErrorCode.FILE_TOO_LARGE;
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return ErrorCode.FILE_TYPE_INVALID;
    case HttpStatus.LOCKED:
      return ErrorCode.ACCOUNT_LOCKED;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

function mapHttpExceptionPayload(ex: HttpException): SafelyMappedPayload {
  const status = ex.getStatus();
  return { status, code: mapHttpStatus(status) };
}

/**
 * Global exception handler. Serializes every error to the single architecture
 * envelope (doc 23 §2, spec §33) and never leaks stack traces, internal IDs,
 * tenant data, or SQL text. 5xx are logged with correlation + internals but the
 * response body is always a safe INTERNAL_ERROR.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response: Response = http.getResponse();
    const ctx = getRequestContext();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: ErrorEnvelope['error'];

    if (exception instanceof AppError) {
      status = ERROR_CODE_TO_HTTP[exception.code];
      payload = exception.toEnvelope().error;
    } else if (exception instanceof HttpException) {
      const mapped = mapHttpExceptionPayload(exception);
      status = mapped.code === ErrorCode.INTERNAL_ERROR ? HttpStatus.INTERNAL_SERVER_ERROR : mapped.status;
      payload = {
        code: mapped.code,
        title: mapped.title ?? mapped.code,
        fields: status === HttpStatus.BAD_REQUEST ? {} : null,
      };
    } else {
      payload = {
        code: ErrorCode.INTERNAL_ERROR,
        title: 'Internal server error',
        detail: 'An unexpected error occurred.',
        fields: null,
      };
    }

    const logBindings: Record<string, unknown> = {
      responseCode: payload.code,
      status,
      requestId: ctx?.requestId,
      businessId: ctx?.businessId,
      actorId: ctx?.actorId,
    };

    if (status >= 500) {
      this.logger.error({ err: exception instanceof Error ? exception : String(exception), ...logBindings }, 'request failed');
    } else {
      this.logger.warn({ ...logBindings, detail: payload.detail }, `request rejected (${status})`);
    }

    response.status(status).json({ error: payload });
  }
}