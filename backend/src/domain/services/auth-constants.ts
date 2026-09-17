/**
 * Auth constants (Prompt 43; spec §20 / REQ-193).
 *
 * The 5-attempt / 15-minute lockout values are specified by the canonical
 * specification and must not be changed.
 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 15;
export const MAX_ACTIVE_ADMINS = 2;
export const SECURITY_HISTORY_RETENTION_MONTHS = 12;