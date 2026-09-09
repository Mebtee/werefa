import { ValidationException } from '../common/http/app-error';
import { bodyObject, readString } from '../iam/validation';

export interface ServiceInput {
  name?: string;
  /** Integer minor units of the platform currency (REQ-071); never a float. */
  basePriceMinor?: number;
  /** Whole minutes (REQ-226); at least 1. */
  baseDurationMinutes?: number;
}

export interface ServiceDeltaInput {
  name?: string;
  /**
   * Signed integer delta (minor units) relative to the parent service base.
   * The app validates that base + delta stays >= 0.
   */
  priceDeltaMinor?: number;
  /** Signed integer minute delta; base + delta must stay >= 1. */
  durationDeltaMinutes?: number;
  /**
   * Child availability flag (same lifecycle pattern as the service): when
   * false the child is kept for history/appointment reference and hidden from
   * the public catalog (REQ-079/080) — no dedicated endpoints needed.
   */
  isActive?: boolean;
}

const MAX_NAME = 120;

function bad(field: string, message: string): never {
  throw new ValidationException([{ field, message }]);
}

interface IntOptions {
  required?: boolean;
}

/** Read a JSON integer (rejects floats/strings/booleans). Absent → undefined. */
function readInt(
  payload: Record<string, unknown>,
  field: string,
  opts: IntOptions = {},
): number | undefined {
  const raw = payload[field];
  if (raw === undefined || raw === null) {
    if (opts.required) bad(field, 'This field is required.');
    return undefined;
  }
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    bad(field, 'Must be a whole number.');
  }
  return raw;
}

/**
 * Money in integer minor units (REQ-071). Non-negative, whole-number only —
 * floats are rejected outright so no silent rounding can occur anywhere.
 */
function readPriceMinor(
  payload: Record<string, unknown>,
  field: string,
  opts: IntOptions = {},
): number | undefined {
  const value = readInt(payload, field, opts);
  if (value !== undefined && value < 0) bad(field, 'Must not be negative.');
  return value;
}

function readDurationMinutes(
  payload: Record<string, unknown>,
  field: string,
  opts: IntOptions = {},
): number | undefined {
  const value = readInt(payload, field, opts);
  if (value !== undefined && value < 1) bad(field, 'Must be at least 1 minute.');
  return value;
}

/**
 * Add-on duration delta: like the price delta, non-negative (REQ-073 AC1).
 * A delta of 0 (a service-extending add-on without extra time) is valid, so
 * unlike a positive base duration the lower bound is 0, not 1.
 */
function readAddOnDeltaMinutes(
  payload: Record<string, unknown>,
  field: string,
  opts: IntOptions = {},
): number | undefined {
  const value = readInt(payload, field, opts);
  if (value !== undefined && value < 0) bad(field, 'Must not be negative.');
  return value;
}

function readName(payload: Record<string, unknown>, required: boolean): string | undefined {
  return readString(payload, 'name', { required, max: MAX_NAME });
}

/** Parse a service create/update body. `requireBase` is true for create. */
export function parseServiceInput(body: unknown, requireBase: boolean): ServiceInput {
  const payload = bodyObject(body);
  const name = readName(payload, requireBase);
  if (requireBase && !name) bad('name', 'Service name is required.');
  return {
    name,
    basePriceMinor: readPriceMinor(payload, 'basePriceMinor', { required: requireBase }),
    baseDurationMinutes: readDurationMinutes(payload, 'baseDurationMinutes', {
      required: requireBase,
    }),
  };
}

/** Variations carry SIGNED deltas relative to the service base (REQ-072). */
export function parseVariationInput(
  body: unknown,
  opts: { requireAll: boolean },
): ServiceDeltaInput {
  const payload = bodyObject(body);
  const name = readName(payload, opts.requireAll);
  if (opts.requireAll && !name) bad('name', 'Variation name is required.');
  return {
    name,
    priceDeltaMinor: readInt(payload, 'priceDeltaMinor', { required: opts.requireAll }),
    durationDeltaMinutes: readInt(payload, 'durationDeltaMinutes', { required: opts.requireAll }),
    isActive: readBoolean(payload, 'isActive'),
  };
}

/** Add-ons add non-negative deltas (REQ-073 AC1). */
export function parseAddOnInput(body: unknown, opts: { requireAll: boolean }): ServiceDeltaInput {
  const payload = bodyObject(body);
  const name = readName(payload, opts.requireAll);
  if (opts.requireAll && !name) bad('name', 'Add-on name is required.');
  const isActive = readBoolean(payload, 'isActive');
  return {
    name,
    priceDeltaMinor: readPriceMinor(payload, 'priceDeltaMinor', { required: opts.requireAll }),
    durationDeltaMinutes: readAddOnDeltaMinutes(payload, 'durationDeltaMinutes', {
      required: opts.requireAll,
    }),
    isActive,
  };
}

/**
 * Read an optional boolean (strict: must be `true`/`false`). Absent → undefined.
 */
function readBoolean(payload: Record<string, unknown>, field: string): boolean | undefined {
  const raw = payload[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') bad(field, 'Must be true or false.');
  return raw;
}
