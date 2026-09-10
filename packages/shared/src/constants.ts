export const API_VERSION = 'v1' as const;
export const API_PREFIX = '/api/v1' as const;

export const COOKIE_SESSION = 'wrf.sid' as const;
export const DEFAULT_SESSION_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days in ms

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Business type categories (REQ-215, refined by OQ-PUB-001): exactly "Salon &
 * Barber" and "Other", validated at the application layer against this
 * allowlist. The set can grow later without a schema/enum migration (REQ-003/004).
 */
export const BUSINESS_CATEGORIES = ['Salon & Barber', 'Other'] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

/**
 * Reserved public slugs (REQ-048): platform routes and well-known names are
 * never usable as a business public slug. Case-insensitive comparison at the
 * service layer.
 */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'b',
  'book',
  'booking',
  'dashboard',
  'docs',
  'help',
  'home',
  'legal',
  'login',
  'logout',
  'me',
  'privacy',
  'public',
  'qr',
  'register',
  'settings',
  'signin',
  'signup',
  'status',
  'terms',
  'users',
  'www',
]);

export const BUSINESS_ID_LENGTH = 36; // uuid without hyphens (canonical) or 36 with hyphens

/**
 * Canonical role names used in session and JWT payloads.
 * "role" field on `User`; enforced by `RolesGuard`.
 */
export enum Role {
  Owner = 'Owner',
  Admin = 'Admin',
  SuperAdmin = 'SuperAdmin',
}

/**
 * Scope set at request/transaction time to control RLS and repository access.
 * - `OWNER`: active business only
 * - `SUPER_ADMIN`: elevated audited read across all businesses (separate app_superadmin role)
 */
export enum Scope {
  Owner = 'OWNER',
  SuperAdmin = 'SUPER_ADMIN',
}

export type RoleLike = `${Role}` | string;

/** Privilege rank used for role-hierarchy checks (see RolesGuard). */
export const roleRank: Record<RoleLike, number> = {
  [Role.Owner]: 1,
  [Role.Admin]: 2,
  [Role.SuperAdmin]: 3,
};

/**
 * Subscription & billing (Prompt 14, REQ-125..141, doc 15).
 *
 * Platform-wide subscription policy constants (single source of truth). The
 * durations/grace windows are fixed by the master specification; the exact
 * monthly price amount (REQ-125 AC1 — exactly one standard monthly price) is
 * NOT specified by the product spec, so the value is an operator-configured
 * constant maintained here (minor units, money is never float, REQ-071).
 */
export const SUBSCRIPTION_PRICE_MINOR: bigint = 150_000n; // ETB 1,500.00 — placeholder, see report DEC register mapping
export const SUBSCRIPTION_TRIAL_DAYS = 30; // REQ-128 free trial
export const SUBSCRIPTION_TRIAL_GRACE_DAYS = 3; // REQ-129 trial grace
export const SUBSCRIPTION_PAID_DAYS = 30; // REQ-126 30-day paid period per approval
export const SUBSCRIPTION_PAID_GRACE_DAYS = 5; // REQ-131 paid grace
export const SUBSCRIPTION_REMINDER_LEAD_DAYS = 3; // REQ-139/140 default reminder lead
export const SUBSCRIPTION_MAX_PROOF_BYTES = MAX_UPLOAD_BYTES; // reuse upload limit
