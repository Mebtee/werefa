import { ValidationException } from '../common/http/app-error';

export type BodyPayload = Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Coerce an unknown request body to a plain object or throw a validation error. */
export function bodyObject(input: unknown, field = 'body'): BodyPayload {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationException([{ field, message: 'Request body must be a JSON object.' }]);
  }
  return input as BodyPayload;
}

export interface FieldReadOptions {
  required?: boolean;
  min?: number;
  max?: number;
  email?: boolean;
}

/** Read + validate a string field; throws ValidationException on malformed input. */
export function readString(
  body: BodyPayload | undefined,
  field: string,
  opts: FieldReadOptions = {},
): string | undefined {
  const raw = body?.[field];
  if (raw === undefined || raw === null) {
    if (opts.required) {
      throw new ValidationException([{ field, message: 'This field is required.' }]);
    }
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new ValidationException([{ field, message: 'Must be a string.' }]);
  }
  const value = raw.trim();
  if (!value) {
    if (opts.required) {
      throw new ValidationException([{ field, message: 'This field is required.' }]);
    }
    return undefined;
  }
  if (opts.email && !EMAIL_RE.test(value)) {
    throw new ValidationException([{ field, message: 'Must be a valid email address.' }]);
  }
  if (opts.min !== undefined && value.length < opts.min) {
    throw new ValidationException([{ field, message: `Must be at least ${opts.min} characters.` }]);
  }
  if (opts.max !== undefined && value.length > opts.max) {
    throw new ValidationException([{ field, message: `Must be at most ${opts.max} characters.` }]);
  }
  return value;
}

/**
 * Normalized email for lookups. Emails are stored as CITEXT (case-insensitive
 * unique) — normalization keeps stored values canonical without relying on the
 * DB collation for writes.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
