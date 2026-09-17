import { describe, expect, it } from 'vitest';
import { parseCookieHeader, sessionCookieOptions } from './cookie-utils';

describe('parseCookieHeader', () => {
  it('returns empty object for undefined input', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it('parses a single cookie', () => {
    expect(parseCookieHeader('werefa_session=abc123')).toEqual({ werefa_session: 'abc123' });
  });

  it('parses multiple cookies separated by semicolons', () => {
    const result = parseCookieHeader('werefa_session=abc; other=xyz');
    expect(result).toEqual({ werefa_session: 'abc', other: 'xyz' });
  });

  it('trims whitespace around keys and values', () => {
    expect(parseCookieHeader(' werefa_session = abc ')).toEqual({ werefa_session: 'abc' });
  });

  it('ignores empty segments and segments without =', () => {
    expect(parseCookieHeader('; ; werefa_session=abc; ;')).toEqual({ werefa_session: 'abc' });
  });

  it('handles value containing = signs', () => {
    expect(parseCookieHeader('werefa_session=a=b=c')).toEqual({ werefa_session: 'a=b=c' });
  });
});

describe('sessionCookieOptions', () => {
  it('sets secure to true in production', () => {
    const opts = sessionCookieOptions('production', 12);
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.maxAge).toBe(12 * 60 * 60 * 1000);
  });

  it('sets secure to false in development', () => {
    const opts = sessionCookieOptions('development', 1);
    expect(opts.secure).toBe(false);
  });
});
