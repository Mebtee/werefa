/**
 * Minimal cookie utilities (Prompt 43).
 *
 * Session cookies are httpOnly + SameSite=Lax + Secure (in production) by default.
 * No external cookie-parser dependency: Express core's res.cookie() is used
 * for setting; this module provides a minimal internal parser to read the
 * Cookie header without adding a framework middleware.
 */

export type SessionSameSite = 'lax' | 'strict' | 'none';

/**
 * Parse a raw `Cookie` header string into a name→value map.
 * Handles `name=value; name2=value2` format.  Ignores empty segments,
 * unquoted whitespace around `=`, and cookies without a value.
 */
export function parseCookieHeader(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  const segments = raw.split(';');
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

/**
 * Resolve session cookie options based on the environment.
 * Secure defaults to true only in production; HttpOnly is always true.
 * SameSite defaults to 'lax' for CSRF protection.
 */
export function sessionCookieOptions(
  nodeEnv: string,
  ttlHours: number,
  sameSite: SessionSameSite = 'lax',
): {
  httpOnly: true;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  maxAge: number;
  path: string;
} {
  const normalizedSameSite = sameSite === 'none' ? 'none' : sameSite === 'strict' ? 'strict' : 'lax';

  // Browsers require Secure=true when SameSite=None.
  if (normalizedSameSite === 'none') {
    if (nodeEnv !== 'production') {
      throw new Error('SameSite=None requires Secure=true; only allowed in production.');
    }
    return {
      httpOnly: true as const,
      sameSite: 'none' as const,
      secure: true,
      maxAge: ttlHours * 60 * 60 * 1000,
      path: '/',
    };
  }

  return {
    httpOnly: true as const,
    sameSite: normalizedSameSite,
    secure: nodeEnv === 'production',
    maxAge: ttlHours * 60 * 60 * 1000,
    path: '/',
  };
}
