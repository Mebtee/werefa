import {
  BUSINESS_CATEGORIES,
  PUBLIC_SLUG_PATTERN,
  RESERVED_SLUGS,
  type BusinessCategory,
} from '@werefa/shared';
import { ValidationException } from '../common/http/app-error';
import { bodyObject, readString, type BodyPayload } from '../iam/validation';

export interface BusinessProfileInput {
  name: string;
  publicSlug?: string;
  category: BusinessCategory;
  description?: string;
  phone?: string;
  contactEmail?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googleMapsLink?: string;
  openStreetMapLink?: string;
}

export interface PauseBusinessInput {
  /** ISO timestamp for the scheduled automatic resume (REQ-144); undefined = indefinite. */
  until?: Date;
  /** Optional pause message shown on the public page (REQ-148). */
  message?: string;
}

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;
const MAX_PHONE = 40;
const MAX_LINK = 512;
const MAX_MESSAGE = 300;
const MAX_SLUG = 80;

const URL_RE = /^https?:\/\/.+/i;

function bad(field: string, message: string): never {
  throw new ValidationException([{ field, message }]);
}

/**
 * Parse + validate the business profile fields common to create/update.
 * `opts.requireName` is true for create; update allows partials.
 */
export function parseBusinessProfile(
  body: unknown,
  opts: { requireName: boolean },
): BusinessProfileInput {
  const payload = bodyObject(body);

  const name = readString(payload, 'name', { required: opts.requireName, max: MAX_NAME });
  if (opts.requireName && !name) bad('name', 'Business name is required.');

  const rawSlug = readString(payload, 'publicSlug', { max: MAX_SLUG });
  let publicSlug = rawSlug ? rawSlug.toLowerCase() : undefined;
  if (publicSlug !== undefined && !PUBLIC_SLUG_PATTERN.test(publicSlug)) {
    bad('publicSlug', 'Public slug may contain lowercase letters, digits and single hyphens only.');
  }
  if (publicSlug !== undefined && RESERVED_SLUGS.has(publicSlug)) {
    bad('publicSlug', 'This public slug is reserved and cannot be used.');
  }
  if (publicSlug !== undefined && publicSlug.startsWith('b/')) {
    bad('publicSlug', 'This public slug is reserved and cannot be used.');
  }

  const category = normalizeCategory(payload.category);

  const description = readString(payload, 'description', { max: MAX_DESCRIPTION });
  const phone = readString(payload, 'phone', { max: MAX_PHONE });
  const contactEmail = readString(payload, 'contactEmail', { email: true, max: 255 });
  const address = readString(payload, 'address', { max: 255 });

  const latitude = readOptionalNumber(payload, 'latitude');
  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    bad('latitude', 'Latitude must be between -90 and 90.');
  }
  const longitude = readOptionalNumber(payload, 'longitude');
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    bad('longitude', 'Longitude must be between -180 and 180.');
  }

  const googleMapsLink = readString(payload, 'googleMapsLink', { max: MAX_LINK });
  if (googleMapsLink !== undefined && !URL_RE.test(googleMapsLink)) {
    bad('googleMapsLink', 'Must be a valid http(s) URL.');
  }
  const openStreetMapLink = readString(payload, 'openStreetMapLink', { max: MAX_LINK });
  if (openStreetMapLink !== undefined && !URL_RE.test(openStreetMapLink)) {
    bad('openStreetMapLink', 'Must be a valid http(s) URL.');
  }

  return {
    name: name ?? '',
    publicSlug,
    category,
    description,
    phone,
    contactEmail: contactEmail ?? undefined,
    address,
    latitude,
    longitude,
    googleMapsLink,
    openStreetMapLink,
  };
}

export function parsePauseInput(body: unknown): PauseBusinessInput {
  const payload = bodyObject(body);
  const untilRaw = readString(payload, 'until', {});
  let until: Date | undefined;
  if (untilRaw !== undefined) {
    until = new Date(untilRaw);
    if (Number.isNaN(until.getTime())) bad('until', 'Must be a valid ISO date/time.');
    if (until.getTime() <= Date.now()) {
      bad('until', 'The automatic resume time must be in the future.');
    }
  }
  const message = readString(payload, 'message', { max: MAX_MESSAGE });
  return { until, message };
}

/** Normalize a raw category to the canonical allowlist value or reject. */
export function normalizeCategory(raw: unknown): BusinessCategory {
  if (raw === undefined || raw === null || raw === '') {
    return 'Other' as BusinessCategory; // REQ-215 default; AC1 of REQ-003 keeps it generic
  }
  if (typeof raw !== 'string') bad('category', 'Must be a string.');
  const match = BUSINESS_CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  if (!match) {
    bad('category', `Must be one of: ${BUSINESS_CATEGORIES.join(', ')}.`);
  }
  return match;
}

function readOptionalNumber(payload: BodyPayload, field: string): number | undefined {
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    bad(field, 'Must be a number.');
  }
  return raw;
}
