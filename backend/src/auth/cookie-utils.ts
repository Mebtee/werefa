/**
 * Minimal cookie utilities (Prompt 43).
 *
 * Session cookies are httpOnly + SameSite=Lax + Secure (in production).
 * No external cookie-parser dependency: Express core's res.cookie() is used
 * for setting; this module provides a minimal internal parser to read the
 * Cookie header without adding a framework middleware.
 */

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
 * Secure=true only in production; SameSite=Lax for CSRF protection on
 * cross-origin navigations; HttpOnly prevents JS access.
 */
export function sessionCookieOptions(nodeEnv: string, ttlHours: number) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: nodeEnv === 'production',
    maxAge: ttlHours * 60 * 60 * 1000,
    path: '/',
  };
}
