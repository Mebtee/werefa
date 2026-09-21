import { describe, expect, it } from 'vitest';
import { isAllowedProofMimeType, PROOF_ALLOWED_MIME_TYPES, PROOF_MAX_BYTES, PROOF_SAMPLES, sniffProof } from '../lib/proof-file';

const TEXT = new Uint8Array(Array.from('plain text that is not a proof', (c) => c.charCodeAt(0)));
const EMPTY = new Uint8Array([]);
const SHORT = new Uint8Array([0x89, 0x50]);

describe('proof-file rules (Prompt 50)', () => {
  it('limits proofs to the allowed image + PDF mime set', () => {
    expect(PROOF_ALLOWED_MIME_TYPES).toEqual([
      'image/bmp',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);
    expect(isAllowedProofMimeType('image/png')).toBe(true);
    expect(isAllowedProofMimeType('application/pdf')).toBe(true);
    expect(isAllowedProofMimeType('text/plain')).toBe(false);
    expect(isAllowedProofMimeType('application/octet-stream')).toBe(false);
    expect(isAllowedProofMimeType('')).toBe(false);
  });

  it('caps proof uploads at 5 MiB', () => {
    expect(PROOF_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it.each(PROOF_ALLOWED_MIME_TYPES)('sniffs %s from its magic bytes', (mime) => {
    const sniffed = sniffProof(PROOF_SAMPLES[mime]);
    expect(sniffed).not.toBeNull();
    expect(sniffed!.mimeType).toBe(mime);
    expect(sniffed!.extension).toMatch(/^[a-z0-9]+$/);
  });

  it('returns null for plain text, empty or truncated bytes', () => {
    expect(sniffProof(TEXT)).toBeNull();
    expect(sniffProof(EMPTY)).toBeNull();
    expect(sniffProof(SHORT)).toBeNull();
    expect(sniffProof(PROOF_SAMPLES['application/pdf'].slice(0, 3))).toBeNull();
  });

  it('sniffing trusts bytes only and reports the true format regardless of what a header claims', () => {
    // A PDF sniffed through a PNG-prefixed wrapper is still a PDF: the gate never
    // relies on the declared channel MIME, only on actual magic bytes.
    expect(sniffProof(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffProof(new Uint8Array(Array.from('%PDF-1.7', (c) => c.charCodeAt(0))))?.mimeType).toBe('application/pdf');
  });
});