import type { AppConfig } from '../config/environment';
import { ValidationException } from '../common/http/app-error';

/**
 * Sensible production password policy (doc 23-compatible validation, no
 * product-specified constraints): length bounds configurable via env.
 */
export function validateNewPassword(
  password: string,
  config: AppConfig,
  field = 'newPassword',
): void {
  if (typeof password !== 'string' || password.length < config.passwordMinLength) {
    throw new ValidationException([
      { field, message: `Password must be at least ${config.passwordMinLength} characters.` },
    ]);
  }
  if (password.length > config.passwordMaxLength) {
    throw new ValidationException([
      { field, message: `Password must be at most ${config.passwordMaxLength} characters.` },
    ]);
  }
}
