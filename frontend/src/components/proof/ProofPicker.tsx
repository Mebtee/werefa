import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import type { ProofFile } from '@/types/models'
import { formatBytes } from '@/lib/format'
import {
  ACCEPTED_PROOF_MIME,
  MAX_PROOF_BYTES,
  validateProofFile,
} from '@/lib/validation'
import { createObjectUrl, revokeObjectUrl } from '@/lib/download'
import { Button } from '@/components/ui/Button'
import { FileIcon, UploadIcon } from '@/components/ui/icons'

/**
 * Customer-side payment-proof picker, shared by the booking wizard's payment
 * step and the rejected-booking resubmission panel.
 *
 * Everything it renders is real and locally verified: the actual `File` the
 * customer chose, its actual name, byte size and declared MIME type, and — for
 * an actual image — a preview built from that very file through an object URL.
 * The bytes themselves are only ever sent by the caller's real multipart client;
 * this component never uploads anything itself and never fabricates a file name,
 * size or type.
 *
 * Validation is the existing `validateProofFile` rule set (the 5 MB cap plus the
 * MIME allow-list the backend enforces), so the client cannot accept something
 * the real upload endpoint would reject. Object URLs are revoked whenever the
 * file changes or the component unmounts.
 */

export interface ProofPickerProps {
  /** Stable id of the real file input; also its visible label's target. */
  inputId: string
  proof: ProofFile | null
  onChange: (proof: ProofFile | null) => void
  /** Localised helper text under the control. */
  hint?: string
  /** Marks the control busy while the real upload is in flight. */
  busy?: boolean
}

const ACCEPT_ATTRIBUTE = [...ACCEPTED_PROOF_MIME, '.pdf'].join(',')

export function ProofPicker({
  inputId,
  proof,
  onChange,
  hint,
  busy = false,
}: ProofPickerProps) {
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const fallbackHintId = useId()

  const file = proof?.file ?? null
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // A preview only for a real image the customer actually chose. Anything else
  // (a PDF, or an environment without object URLs) gets an honest file chip
  // rather than a broken <img>.
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreviewUrl(null)
      return
    }
    const url = createObjectUrl(file)
    setPreviewUrl(url)
    return () => revokeObjectUrl(url)
  }, [file])

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null
    if (!chosen) {
      onChange(null)
      setError(null)
      return
    }
    const result = validateProofFile(chosen)
    if (result.ok) {
      onChange(result.proof)
      setError(null)
      return
    }
    onChange(null)
    setError(result.error.message)
    // Clear the native input so re-picking the same file fires `change` again.
    event.target.value = ''
  }

  const remove = () => {
    onChange(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const hintText =
    hint ??
    `A screenshot of your transfer, or the PDF receipt. Max ${Math.round(
      MAX_PROOF_BYTES / (1024 * 1024),
    )} MB.`

  // The input stays mounted in both states so "Replace" can reopen the real
  // native file dialog without remounting it.
  const input = (
    <input
      ref={inputRef}
      id={inputId}
      className="sr-only"
      type="file"
      accept={ACCEPT_ATTRIBUTE}
      disabled={busy}
      aria-describedby={[hint ? hintId : fallbackHintId, error ? errorId : null]
        .filter(Boolean)
        .join(' ')}
      aria-invalid={error ? true : undefined}
      onChange={handleChange}
    />
  )

  if (proof && file) {
    return (
      <>
        <div className="proof-preview">
          <span className="proof-preview__thumb">
            {previewUrl ? (
              <img
                className="proof-preview__img"
                src={previewUrl}
                alt={`Preview of the payment proof you selected: ${proof.fileName}`}
              />
            ) : (
              <FileIcon size={26} />
            )}
          </span>
          <span className="proof-preview__body">
            <span className="proof-preview__name">{proof.fileName}</span>
            <span className="proof-preview__meta">
              {formatBytes(proof.sizeBytes)} · {proof.mimeType}
            </span>
            <span className="proof-preview__actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={remove}>
                Remove
              </Button>
            </span>
          </span>
        </div>
        {input}
        <p className="line-item__meta" id={hint ? hintId : fallbackHintId}>
          {hintText}
        </p>
        {error && (
          <p className="field__error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  return (
    <>
      <div className="upload-zone">
        <UploadIcon className="upload-zone__icon" size={26} />
        <label className="upload-zone__label" htmlFor={inputId}>
          Choose image or PDF
        </label>
        {input}
        <p className="line-item__meta" id={hint ? hintId : fallbackHintId}>
          {hintText}
        </p>
      </div>
      {error && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  )
}