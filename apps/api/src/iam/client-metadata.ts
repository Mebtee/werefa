import { createHash } from 'node:crypto';

export interface ClientMetadata {
  /** Normalized device class stored on sessions + security events (REQ-192). */
  device: string;
  /** Normalized browser stored on sessions + security events (REQ-192). */
  browser: string;
  /** Stable per (user-agent, ip) opaque fingerprint for device recognition. */
  fingerprint: string;
}

/**
 * Derive device/browser from the User-Agent header. Deterministic and safe;
 * an absent/unknown UA yields "unknown" labels (never a crash). Client-supplied
 * tuple values are intentionally ignored — the server derives them (doc 14).
 */
export function clientMetadata(ua: string | undefined, ip: string | undefined): ClientMetadata {
  const uaH = (ua ?? '').toLowerCase();
  let device = 'unknown';
  if (uaH.includes('ipad') || /tablet/.test(uaH)) {
    device = 'tablet';
  } else if (/iphone|ipod/.test(uaH) || /android.*mobile/.test(uaH)) {
    device = 'mobile';
  } else if (/windows|mac os x|linux|android/.test(uaH)) {
    device = 'desktop';
  }

  let browser = 'other';
  if (uaH.includes('edg/')) browser = 'edge';
  else if (uaH.includes('chrome')) browser = 'chrome';
  else if (uaH.includes('samsungbrowser')) browser = 'samsung';
  else if (/firefox\//.test(uaH)) browser = 'firefox';
  else if (/safari\//.test(uaH)) browser = 'safari';
  else if (/opr\/|opera/.test(uaH)) browser = 'opera';

  const fingerprint = createHash('sha256')
    .update(`${uaH.trim()}|${ip ?? ''}`, 'utf8')
    .digest('hex');

  return { device, browser, fingerprint };
}
