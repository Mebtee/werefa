import { ValidationException } from '../common/http/app-error';
import { bodyObject, readString } from '../iam/validation';
import type { PaymentMethod } from '@prisma/client';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['BANK_TRANSFER', 'TELEBIRR_MOBILE_MONEY'];

export interface ServiceLineInput {
  serviceId: string;
  variationId?: string;
  addOnIds: string[];
}

export interface CreateBookingInput {
  customerName: string;
  customerPhone: string;
  note: string | null;
  startAt: Date;
  paymentMethod: PaymentMethod;
  services: ServiceLineInput[];
  submissionKey: string;
}

export interface AvailabilityInput {
  startAt: Date;
  services: ServiceLineInput[];
}

export interface RescheduleInput {
  newStartAt: Date;
}

export interface RejectInput {
  reason: string;
}

export interface RequestCodeInput {
  phone: string;
}

export interface ResubmitInput {
  phone: string;
  code: string;
  paymentMethod: PaymentMethod;
}

function bad(field: string, message: string): never {
  throw new ValidationException([{ field, message }]);
}

function requiredString(payload: Record<string, unknown>, field: string, max = 200): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) bad(field, 'This field is required.');
  if (value.trim().length > max) bad(field, `Must be at most ${max} characters.`);
  return value.trim();
}

const PHONE_RE = /^\+?[0-9\s()-]{7,20}$/;

function readPhone(payload: Record<string, unknown>, field: string): string {
  const value = requiredString(payload, field, 20);
  if (!PHONE_RE.test(value)) bad(field, 'Enter a valid phone number.');
  return value;
}

/** Whole-minute ISO datetime (REQ-226). Rejects non-zero seconds sub-steps. */
function readWholeMinuteDate(payload: Record<string, unknown>, field: string): Date {
  const raw = payload[field];
  if (typeof raw !== 'string' || !raw.trim()) bad(field, 'This field is required.');
  const value = new Date(raw.trim());
  if (Number.isNaN(value.getTime())) bad(field, 'Must be a valid date-time.');
  if (value.getSeconds() !== 0 || value.getMilliseconds() !== 0) {
    bad(field, 'Time must be to the minute (seconds not supported).');
  }
  return value;
}

function readPaymentMethod(
  payload: Record<string, unknown>,
  field = 'paymentMethod',
): PaymentMethod {
  const raw = payload[field];
  if (typeof raw !== 'string') bad(field, 'This field is required.');
  if (!(PAYMENT_METHODS as readonly string[]).includes(raw)) {
    bad(field, 'Unsupported payment method.');
  }
  return raw as PaymentMethod;
}

function defaultServices(payload: Record<string, unknown>, field = 'services'): ServiceLineInput[] {
  let raw = payload[field];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      bad(field, 'Must be a valid services list.');
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) bad(field, 'At least one service is required.');
  return raw.map((entry, index) => parseServiceLine(entry, `${field}[${index}]`));
}

function parseServiceLine(raw: unknown, field: string): ServiceLineInput {
  const entry = bodyObject(raw, field);
  const serviceId = entry['serviceId'];
  if (typeof serviceId !== 'string' || !serviceId.trim()) {
    bad(field, 'serviceId is required for every selected service.');
  }
  const variationIdRaw = entry['variationId'];
  let variationId: string | undefined;
  if (variationIdRaw !== undefined && variationIdRaw !== null) {
    if (typeof variationIdRaw !== 'string' || !variationIdRaw.trim()) {
      bad(field, 'variationId must be a string.');
    }
    variationId = variationIdRaw.trim();
  }
  const addOnsRaw = entry['addOnIds'];
  let addOnIds: string[] = [];
  if (addOnsRaw !== undefined && addOnsRaw !== null) {
    if (!Array.isArray(addOnsRaw)) bad(field, 'addOnIds must be an array.');
    addOnIds = addOnsRaw.map((id) => {
      if (typeof id !== 'string' || !id.trim()) bad(field, 'addOnIds must contain strings.');
      return id.trim();
    });
  }
  return { serviceId: serviceId.trim(), variationId, addOnIds };
}

export function parseCreateBookingInput(body: unknown): CreateBookingInput {
  const payload = bodyObject(body);
  const submissionKey = payload['submissionKey'];
  if (typeof submissionKey !== 'string' || !submissionKey.trim()) {
    bad('submissionKey', 'This field is required.');
  }
  const noteRaw = payload['note'];
  let note: string | null = null;
  if (noteRaw !== undefined && noteRaw !== null) {
    if (typeof noteRaw !== 'string') bad('note', 'Must be a string.');
    note = noteRaw.trim() ? noteRaw.trim().slice(0, 1000) : null;
  }
  return {
    customerName: requiredString(payload, 'customerName', 120),
    customerPhone: readPhone(payload, 'customerPhone'),
    note,
    startAt: readWholeMinuteDate(payload, 'startAt'),
    paymentMethod: readPaymentMethod(payload),
    services: defaultServices(payload),
    submissionKey: submissionKey.trim(),
  };
}

export function parseAvailabilityInput(body: unknown): AvailabilityInput {
  const payload = bodyObject(body);
  return { startAt: readWholeMinuteDate(payload, 'startAt'), services: defaultServices(payload) };
}

export function parseRescheduleInput(body: unknown): RescheduleInput {
  const payload = bodyObject(body);
  return { newStartAt: readWholeMinuteDate(payload, 'newStartAt') };
}

export function parseRejectInput(body: unknown): RejectInput {
  const payload = bodyObject(body);
  const reason = readString(payload, 'reason', { required: true, max: 500 });
  if (!reason) bad('reason', 'A rejection reason is required (REQ-068/124).');
  return { reason };
}

export function parseResubmitInput(body: unknown): ResubmitInput {
  const payload = bodyObject(body);
  return {
    phone: readPhone(payload, 'phone'),
    code: requiredString(payload, 'code', 20),
    paymentMethod: readPaymentMethod(payload),
  };
}

export function parseRequestCodeInput(body: unknown): RequestCodeInput {
  const payload = bodyObject(body);
  return { phone: readPhone(payload, 'phone') };
}

export const PROOF_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
]);

/** Proof files accept image + PDF only (REQ-118). */
export const PROOF_TYPES = 'PNG, JPEG or PDF';

/** Either `{file, ...}` after multer, or `{file:{...}}` shaped by a raw body. */
export interface ProofFileLike {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
