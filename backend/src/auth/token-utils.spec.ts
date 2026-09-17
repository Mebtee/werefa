import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, sha256hex, generateRecoveryCode } from './token-utils';

describe('generateOpaqueToken', () => {
  it('produces a 64-char hex string', () => {
    const token = generateOpaqueToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it('produces different tokens on successive calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('sha256hex', () => {
  it('produces a 64-char lowercase hex digest', () => {
    const digest = sha256hex('hello');
    expect(digest).toHaveLength(64);
    expect(digest).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('is deterministic', () => {
    expect(sha256hex('test')).toBe(sha256hex('test'));
  });
});

describe('generateRecoveryCode', () => {
  it('produces the correct length string of digits', () => {
    const code = generateRecoveryCode(6);
    expect(code).toHaveLength(6);
    expect(/^\d{6}$/.test(code)).toBe(true);
  });

  it('produces different codes on successive calls (probabilistic)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode(6)));
    expect(codes.size).toBeGreaterThan(1);
  });
});
