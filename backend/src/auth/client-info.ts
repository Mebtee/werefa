import type { Request } from 'express';
import { ClientInfo } from '../domain/services/auth.service';

/**
 * Client context extraction for security events (Prompt 43; REQ-191/192).
 *
 * IP is taken from the left-most X-Forwarded-For entry when present
 * (reverse-proxy convention depending on `trustProxy`) else the socket address.
 * Device/browser are coarse classifications of the User-Agent string — no
 * third-party parser, deterministic and dependency-free.
 */

export function clientInfoFrom(req: Request): ClientInfo {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string' && forwarded.trim() !== ''
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress ?? undefined;

  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  const browser = browserOf(ua);
  const device = deviceOf(ua);

  const info: ClientInfo = {};
  if (ip) info.ip = ip;
  if (device) info.device = device;
  if (browser) info.browser = browser;
  return info;
}

function browserOf(ua: string): string | undefined {
  if (!ua) return undefined;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Other';
}

function deviceOf(ua: string): string | undefined {
  if (!ua) return undefined;
  if (ua.includes('Tablet') || ua.includes('iPad')) return 'Tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'Mobile';
  return 'Desktop';
}