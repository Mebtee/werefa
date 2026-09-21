/**
 * Payment-proof file rules (Prompt 50; REQ-118, spec §31).
 *
 * The canonical contract limits proof uploads to images + PDF. The controller's
 * multer `fileFilter` is only a cheap declared-MIME first screen; the OFFICIAL
 * validation is magic-byte sniffing here, performed by the application service
 * BEFORE any slot claim is processed (a bad file must never lock a slot).
 */

export const PROOF_ALLOWED_MIME_TYPES = [
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type ProofMimeType = (typeof PROOF_ALLOWED_MIME_TYPES)[number];

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export function isAllowedProofMimeType(value: string): value is ProofMimeType {
  return (PROOF_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export interface SniffedProof {
  mimeType: ProofMimeType;
  extension: string;
}

const MAGIC_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAGIC_JPEG = [0xff, 0xd8, 0xff];
const MAGIC_GIF_ASCII = 0x47; // 'G'
const MAGIC_BMP_ASCII = 0x42; // 'B'
const MAGIC_PDF_ASCII = 0x25; // '%'

const EXTENSION: Record<ProofMimeType, string> = {
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Sniff a proof's true format from its magic bytes. Returns null when the bytes
 * match no allowed type. A declared MIME (browser header) is never trusted.
 */
export function sniffProof(bytes: Uint8Array): SniffedProof | null {
  const has = (prefix: number[], offset = 0): boolean => {
    if (bytes.length < offset + prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (bytes[offset + i] !== prefix[i]) return false;
    }
    return true;
  };

  if (has(MAGIC_PNG)) return { mimeType: 'image/png', extension: EXTENSION['image/png'] };
  if (has(MAGIC_JPEG)) return { mimeType: 'image/jpeg', extension: EXTENSION['image/jpeg'] };
  if (bytes.length >= 6 && bytes[0] === MAGIC_GIF_ASCII && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { mimeType: 'image/gif', extension: EXTENSION['image/gif'] };
  }
  if (bytes.length >= 2 && bytes[0] === MAGIC_BMP_ASCII && bytes[1] === 0x4d) {
    return { mimeType: 'image/bmp', extension: EXTENSION['image/bmp'] };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46 && // 'F'
    bytes[8] === 0x57 && // 'W'
    bytes[9] === 0x45 && // 'E'
    bytes[10] === 0x42 && // 'B'
    bytes[11] === 0x50 //   'P'
  ) {
    return { mimeType: 'image/webp', extension: EXTENSION['image/webp'] };
  }
  if (bytes.length >= 4 && bytes[0] === MAGIC_PDF_ASCII && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { mimeType: 'application/pdf', extension: EXTENSION['application/pdf'] };
  }
  return null;
}

/**
 * Smallest valid sample for each allowed type, used by tests and the reference
 * stub to produce deterministic proof bytes. Each sample optionally starts with
 * a wrong declared header so the authoritative gate (sniffing) is exercised.
 */
export const PROOF_SAMPLES: Record<ProofMimeType, Uint8Array> = {
  'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  'image/jpeg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  'image/gif': new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]),
  'image/bmp': new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00]),
  'image/webp': new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
  'application/pdf': new Uint8Array(Array.from('%PDF-1.4\n', (c) => c.charCodeAt(0))),
};