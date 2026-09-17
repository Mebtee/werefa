import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './password-hash';

describe('Argon2PasswordHasher', () => {
  it('hashes a password and verifies it correctly', async () => {
    const hash = await Argon2PasswordHasher.hash('correct-horse-battery-staple');
    expect(hash).toBeTruthy();
    expect(hash.length).toBeGreaterThan(20);
    await expect(Argon2PasswordHasher.verify(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await Argon2PasswordHasher.hash('real-password');
    await expect(Argon2PasswordHasher.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false when given a malformed hash string', async () => {
    await expect(Argon2PasswordHasher.verify('not-a-valid-hash', 'candidate')).resolves.toBe(false);
  });
});
