import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@werefa/shared';
import {
  AccountLockedException,
  AppException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  TooManyRequestsException,
  UnauthenticatedException,
  ValidationException,
} from '../../apps/api/src/common/http/app-error';

describe('AppException', () => {
  it('maps typed errors to the documented error code + HTTP status', () => {
    const cases = [
      new ValidationException([{ field: 'email', message: 'invalid' }]),
      new UnauthenticatedException(),
      new ForbiddenException(),
      new NotFoundException(),
      new ConflictException(),
      new TooManyRequestsException(),
      new AccountLockedException(),
    ];
    expect(cases.map((e) => e.code)).toEqual([
      ErrorCodes.VALIDATION_ERROR,
      ErrorCodes.UNAUTHENTICATED,
      ErrorCodes.FORBIDDEN,
      ErrorCodes.NOT_FOUND,
      ErrorCodes.CONFLICT,
      ErrorCodes.RATE_LIMITED,
      ErrorCodes.ACCOUNT_LOCKED,
    ]);
    expect(cases.map((e) => e.httpStatus)).toEqual([400, 401, 403, 404, 409, 429, 423]);
  });

  it('includes validation fields in the envelope for VALIDATION_ERROR', () => {
    const env = new ValidationException([{ field: 'email', message: 'invalid' }]).toEnvelope();
    expect(env.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(env.error.fields).toEqual([{ field: 'email', message: 'invalid' }]);
  });

  it('does not leak internal details when safeForClient=false', () => {
    const e = new AppException(ErrorCodes.INTERNAL_ERROR, 500, 'pwnd', {
      detail: 'secret internal sql',
      safeForClient: false,
    });
    const env = e.toEnvelope();
    expect(env.error.title).toBe('pwnd');
    expect(env.error.detail).toBe(null);
  });

  it('uses empty field list for validation even when unset', () => {
    const e = new AppException(ErrorCodes.VALIDATION_ERROR, 400, 'nope');
    expect(e.toEnvelope().error.fields).toEqual([]);
  });
});
