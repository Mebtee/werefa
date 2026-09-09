import type { Response } from 'express';
import type { AppConfig } from '../config/environment';

const SESSION_COOKIE_OPTS = (config: AppConfig) => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax' as const,
  path: '/',
});

/** Set the HttpOnly session cookie (doc 14 §2.4 attributes). */
export function writeSessionCookie(res: Response, token: string, config: AppConfig): void {
  res.cookie(config.sessionCookieName, token, {
    ...SESSION_COOKIE_OPTS(config),
    maxAge: config.sessionTtlMinutes * 60_000,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(config.sessionCookieName, SESSION_COOKIE_OPTS(config));
}
