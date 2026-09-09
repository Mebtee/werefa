import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCodes, type ErrorEnvelope } from '@werefa/shared';
import { AppException } from './app-error';

/**
 * Gloval exception filter producing the unified error envelope (doc 23 §2).
 *
 * - Domain `AppException` → its mapped status + envelope.
 * - NestJS `HttpException` → mapped (non-leaking) envelope.
 * - Unknown errors → 500 `INTERNAL_ERROR` envelope; details never leak the
 *   internal error out (no stack / no internal IDs to the client).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number;
    let envelope: ErrorEnvelope;

    if (exception instanceof AppException) {
      status = exception.httpStatus;
      envelope = exception.toEnvelope();
    } else if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string' ? raw : (raw as { message?: string | string[] }).message;
      const detail = Array.isArray(message) ? message.join('; ') : message;
      status = exception.getStatus();
      envelope = {
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          title: detail ?? 'Request failed',
          detail: null,
          fields: null,
        },
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      envelope = {
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          title: 'Unexpected error',
          detail: null,
          fields: null,
        },
      };
    }

    response.status(status).json(envelope);
  }
}
