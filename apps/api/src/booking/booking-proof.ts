import { ErrorCodes } from '@werefa/shared';
import { AppException } from '../common/http/app-error';
import { PROOF_MIME_ALLOWLIST, PROOF_TYPES, type ProofFileLike } from './booking-input';

/** Payment proof upload limit (REQ-118 / seam; business media uses 10MB too). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Validate a payment-proof file; throws transport-mapped FILE_* errors. */
export function validateProofFile(file: ProofFileLike | undefined): ProofFileLike {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 400, 'A payment proof file is required.');
  }
  if (!PROOF_MIME_ALLOWLIST.has(file.mimetype)) {
    throw new AppException(ErrorCodes.FILE_TYPE_INVALID, 400, 'Unsupported file type', {
      detail: `Proof must be ${PROOF_TYPES} (received "${file.mimetype}").`,
    });
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppException(ErrorCodes.FILE_TOO_LARGE, 413, 'File too large', {
      detail: `Proof must be ${MAX_UPLOAD_BYTES / 1024 / 1024}MB or smaller.`,
    });
  }
  return { buffer: file.buffer, mimetype: file.mimetype, size: file.buffer.length };
}
