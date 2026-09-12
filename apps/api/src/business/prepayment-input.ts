import { ValidationException } from '../common/http/app-error';
import { bodyObject } from '../iam/validation';

/**
 * Prepayment configuration (REQ-110/111, Prompt 21).
 *
 * `enabled: true` followed by exactly one of:
 *  - `type: 'PERCENTAGE'`, `percentage: 1..100`
 *  - `type: 'FIXED'`, `fixedMinor: positive integer (minor units)`
 *
 * Mixing both forms is rejected (REQ-111 AC1) so a booking never sees an
 * ambiguous derivation. Values are snapshotted onto `payment.prepaid_minor`
 * at booking creation; later config changes do NOT alter existing bookings.
 */
export interface PrepaymentConfigInput {
  enabled: boolean;
  type?: 'PERCENTAGE' | 'FIXED';
  percentage?: number;
  fixedMinor?: bigint;
}

export function parsePrepaymentConfigInput(body: unknown): PrepaymentConfigInput {
  const payload = bodyObject(body);

  const enabledRaw = payload['enabled'];
  if (typeof enabledRaw !== 'boolean') {
    throw new ValidationException([{ field: 'enabled', message: 'This field is required.' }]);
  }
  if (!enabledRaw) return { enabled: false };

  const typeRaw = payload['type'];
  if (typeRaw !== 'PERCENTAGE' && typeRaw !== 'FIXED') {
    throw new ValidationException([{ field: 'type', message: 'Must be "PERCENTAGE" or "FIXED".' }]);
  }

  if (typeRaw === 'PERCENTAGE') {
    const percentage = readInt(payload, 'percentage');
    if (percentage === undefined || percentage < 1 || percentage > 100) {
      throw new ValidationException([
        { field: 'percentage', message: 'Percentage must be between 1 and 100.' },
      ]);
    }
    if (
      'fixedMinor' in payload &&
      payload['fixedMinor'] !== null &&
      payload['fixedMinor'] !== undefined
    ) {
      throw new ValidationException([
        { field: 'fixedMinor', message: 'Percentage and fixed amount cannot be combined.' },
      ]);
    }
    return { enabled: true, type: 'PERCENTAGE', percentage };
  }

  const fixedMinor = readBigInt(payload, 'fixedMinor');
  if (fixedMinor === undefined || fixedMinor <= 0n) {
    throw new ValidationException([
      { field: 'fixedMinor', message: 'Fixed prepayment must be a positive amount.' },
    ]);
  }
  if (
    'percentage' in payload &&
    payload['percentage'] !== null &&
    payload['percentage'] !== undefined
  ) {
    throw new ValidationException([
      { field: 'percentage', message: 'Fixed amount and percentage cannot be combined.' },
    ]);
  }
  return { enabled: true, type: 'FIXED', fixedMinor };
}

function readInt(payload: Record<string, unknown>, field: string): number | undefined {
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || !Number.isFinite(raw)) {
    throw new ValidationException([{ field, message: 'Must be a whole number.' }]);
  }
  return raw;
}

function readBigInt(payload: Record<string, unknown>, field: string): bigint | undefined {
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || !Number.isFinite(raw)) {
      throw new ValidationException([{ field, message: 'Must be a whole number.' }]);
    }
    return BigInt(raw);
  }
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw.trim())) {
      throw new ValidationException([{ field, message: 'Must be a whole number.' }]);
    }
    return BigInt(raw.trim());
  }
  throw new ValidationException([{ field, message: 'Must be a whole number.' }]);
}

export interface PrepaymentConfigDto {
  enabled: boolean;
  type: 'PERCENTAGE' | 'FIXED' | null;
  percentage: number | null;
  fixedMinor: number | null;
}
