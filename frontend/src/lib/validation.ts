import type { CustomerDetails, ProofFile } from '@/types/models'

export interface ValidationResult {
  valid: boolean
  errors: Partial<Record<keyof CustomerDetails, string>>
}

/** Phone shape used on both the booking form and the status lookup (REQ-054). */
export const PHONE_PATTERN = /^\+?[0-9][0-9\s()-]{6,15}$/

export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(phone.trim())
}

/**
 * Normalizes a phone number for comparison: strip every non-digit character
 * (spaces, hyphens, parentheses, the leading "+" in international notation).
 * Formatting differences therefore never prevent a match — two entries whose
 * digits are identical are considered the same number. This is deliberately
 * reversible-safe (digits-only) and not an attempt to canonicalize country
 * codes or leading zeros, which would be guesswork.
 */
export function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** Very basic non-empty check. The backend is the authoritative validator. */
export function validateCustomerDetails(
  customer: CustomerDetails,
): ValidationResult {
  const errors: Partial<Record<keyof CustomerDetails, string>> = {}

  const name = customer.name.trim()
  if (!name) {
    errors.name = 'Please enter your name.'
  } else if (name.length < 2) {
    errors.name = 'Your name looks too short.'
  }

  const phone = customer.phone.trim()
  if (!phone) {
    errors.phone = 'Please enter your phone number. We use it to identify your booking.'
  } else if (!isValidPhone(phone)) {
    errors.phone = 'That phone number does not look valid.'
  }

  const note = customer.note.trim()
  if (note.length > 500) {
    errors.note = 'Please keep your note under 500 characters.'
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export const ACCEPTED_PROOF_MIME = [
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]

/** Payment-proof constraints: bounded size + declared MIME allow-list. */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024

export interface ProofValidationError {
  code: 'not-allowed-type' | 'too-large' | 'empty'
  message: string
}

export function validateProofFile(file: File | undefined | null):
  | { ok: true; proof: ProofFile }
  | { ok: false; error: ProofValidationError } {
  if (!file) {
    return {
      ok: false,
      error: {
        code: 'empty',
        message: 'Please attach your payment proof.',
      },
    }
  }
  if (!ACCEPTED_PROOF_MIME.includes(file.type)) {
    return {
      ok: false,
      error: {
        code: 'not-allowed-type',
        message: 'You can only attach an image or a PDF.',
      },
    }
  }
  if (file.size > MAX_PROOF_BYTES) {
    return {
      ok: false,
      error: {
        code: 'too-large',
        message: 'The proof is too large. Max size is 5 MB.',
      },
    }
  }
  return {
    ok: true,
    proof: {
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      file,
    },
  }
}