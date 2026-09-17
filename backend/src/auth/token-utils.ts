import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque token generation and hashing (Prompt 43).
 *
 * Session tokens and recovery codes are generated as random bytes, stored in
 * the database only as their sha-256 hex digests. The raw token/code is sent
 * to the client (in a cookie or response body) and never persisted.
 */

/** Generate a cryptographically random opaque token (32 bytes → 64 hex chars). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** Compute the sha-256 hex digest of a token or code (for DB storage). */
export function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a numeric recovery code of the specified length.
 * Produces zero-padded digits (e.g. length 6 → "000000" to "999999").
 */
export function generateRecoveryCode(length: number): string {
  const max = 10 ** length;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return String(n).padStart(length, '0');
}
