import argon2 from 'argon2';

/**
 * Password hashing boundary (Prompt 43; architecture doc 09).
 *
 * All password hashes are argon2id (OWASP recommendation). Hashes are never
 * logged, returned in responses, or serialized in any envelope. The params
 * use the argon2 library defaults (memory=65536 KiB, time=3, parallelism=4,
 * hashLength=32) which meet OWASP 2024 minimum recommendations.
 */

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(storedHash: string, candidate: string): Promise<boolean>;
}

export const Argon2PasswordHasher: PasswordHasher = {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext);
  },

  async verify(storedHash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, candidate);
    } catch {
      return false;
    }
  },
};
