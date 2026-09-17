import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Auth-specific error factories (Prompt 43).
 *
 * Generic failures are used wherever leaking account existence would aid
 * enumeration. Lockout and strong-recovery conditions use explicit codes.
 */
export function invalidCredentials(): AppError {
  return AppError.unauthenticated('Invalid email or password.');
}

export function accountLocked(): AppError {
  return new AppError({
    code: ErrorCode.ACCOUNT_LOCKED,
    title: 'Account locked',
    detail: 'Too many failed login attempts. Try again later.',
  });
}

export function recoveryCodeInvalid(): AppError {
  return new AppError({
    code: ErrorCode.TOKEN_EXPIRED,
    title: 'Recovery code invalid',
    detail: 'The recovery code is invalid or has expired.',
  });
}

export function adminLimitReached(): AppError {
  return new AppError({
    code: ErrorCode.CONFLICT,
    title: 'Conflict',
    detail: 'The maximum of two active admins has been reached.',
  });
}