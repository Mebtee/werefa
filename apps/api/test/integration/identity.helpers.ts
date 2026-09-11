import { hash } from '@node-rs/argon2';
import { expect } from 'vitest';
import { Client } from 'pg';

export const TEST_EMAILS = {
  owner: 'owner@werefa.test',
  owner2: 'pwd-reset-owner@werefa.test',
  admin1: 'admin1@werefa.test',
  admin2: 'admin2@werefa.test',
  sa: 'sa@werefa.test',
} as const;

export const TEST_PASSWORDS = {
  owner: 'OwnerPass-123', // 12 chars
  admin: 'AdminPass-123', // 12 chars
  sa: 'SaPass-12345', // 12 chars
  saRecoveryEmail: 'recovery@werefa.test',
  newPassword: 'NewPass-12345',
  adminNewPassword: 'AdminNew12345',
} as const;

export const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * Resets the identity tables and inserts deterministic accounts for auth
 * integration tests. Runs as the migrator role (owns the tables, BYPASSRLS) —
 * the runtime `app` role is least-privilege and cannot TRUNCATE.
 */
export async function resetIdentityDatabaseAndSeed(migratorUrl: string): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();

  // Identity tables have no RLS (only business/business_owner). TRUNCATE with
  // CASCADE wipes sessions, security_events, reset tokens — clean slate.
  await client.query('TRUNCATE "user" CASCADE');

  const ownerHash = await hash(TEST_PASSWORDS.owner, ARGON_OPTS);
  const adminHash = await hash(TEST_PASSWORDS.admin, ARGON_OPTS);
  const saHash = await hash(TEST_PASSWORDS.sa, ARGON_OPTS);

  const insertUser = `INSERT INTO "user"(email, password_hash, role, is_email_verified, recovery_email) VALUES ($1,$2,$3,true,$4)`;

  await client.query(insertUser, [TEST_EMAILS.owner, ownerHash, 'Owner', null]);
  await client.query(insertUser, [TEST_EMAILS.owner2, ownerHash, 'Owner', null]);
  await client.query(insertUser, [TEST_EMAILS.admin1, adminHash, 'Admin', null]);
  await client.query(insertUser, [TEST_EMAILS.admin2, adminHash, 'Admin', null]);
  await client.query(insertUser, [
    TEST_EMAILS.sa,
    saHash,
    'SuperAdmin',
    TEST_PASSWORDS.saRecoveryEmail,
  ]);

  await client.end();
}

/** Extract the raw session token value from a Set-Cookie header array. */
export function extractSessionToken(setCookie: string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  const sessionCookie = setCookie.find((c) => c.startsWith('wrf.sid='));
  return sessionCookie?.split(';')[0]?.split('=')[1];
}

export function expectEnvelope401(body: unknown): void {
  const b = body as { error: { code: string; title: string } };
  expect(b.error).toBeDefined();
  expect(b.error.code).toBe('UNAUTHENTICATED');
  expect(b.error.title).toBe('Authentication required');
}

export function expectEnvelope423(body: unknown): void {
  const b = body as { error: { code: string } };
  expect(b.error).toBeDefined();
  expect(b.error.code).toBe('ACCOUNT_LOCKED');
}

export function expectEnvelope403(body: unknown, expectedDetail?: string): void {
  const b = body as { error: { code: string; detail?: string | null } };
  expect(b.error).toBeDefined();
  expect(b.error.code).toBe('FORBIDDEN');
  if (expectedDetail !== undefined) {
    expect(b.error.detail).toContain(expectedDetail);
  }
}

export function expectEnvelope409(body: unknown, expectedDetail?: string): void {
  const b = body as { error: { code: string; detail?: string | null } };
  expect(b.error.code).toBe('CONFLICT');
  if (expectedDetail !== undefined) {
    expect(b.error.detail).toContain(expectedDetail);
  }
}
