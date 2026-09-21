import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { ProofFile } from '@/types/models'
import {
  requestResubmissionCode,
  verifyResubmission,
} from '@/api/booking'
import { toUserMessage } from '@/api/errors'
import { formatBytes } from '@/lib/format'
import { validateProofFile } from '@/lib/validation'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

interface ResubmissionPanelProps {
  businessSlug: string
  phone: string
  /** Called after a successful resubmission so the page can refresh status. */
  onDone: () => void
  onClose: () => void
}

type Phase = 'idle' | 'code-requested'

function newSubmissionKey(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `resub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Rejected-booking resubmission (Prompt 50, REQ-230).
 *
 * Honest about code delivery: the code is one-time, expiring and phone-scoped,
 * and is delivered out-of-band, so this panel NEVER claims a code was "sent".
 * It offers a code-request step, then a 6-digit code + fresh-proof step, and
 * reports only what the backend actually confirms.
 */
export function ResubmissionPanel({
  businessSlug,
  phone,
  onDone,
  onClose,
}: ResubmissionPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [requesting, setRequesting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [proof, setProof] = useState<ProofFile | null>(null)
  const [proofError, setProofError] = useState<string | null>(null)
  // One stable key per attempt so a double submit is idempotent server-side.
  const submissionKeyRef = useRef<string | null>(null)

  const requestCode = async () => {
    setRequesting(true)
    setError(null)
    try {
      await requestResubmissionCode({ businessSlug, phone })
      setPhase('code-requested')
    } catch (requestError) {
      setError(toUserMessage(requestError))
    } finally {
      setRequesting(false)
    }
  }

  const handleProofChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      setProof(null)
      return
    }
    const result = validateProofFile(file)
    if (result.ok) {
      setProof(result.proof)
      setProofError(null)
    } else {
      setProof(null)
      setProofError(result.error.message)
      event.target.value = ''
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    let invalid = false
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Enter the 6-digit code.')
      invalid = true
    }
    if (!proof?.file) {
      setProofError('Please attach your new payment proof.')
      invalid = true
    }
    if (invalid || !proof?.file) return

    const key = submissionKeyRef.current ?? newSubmissionKey()
    submissionKeyRef.current = key
    setVerifying(true)
    setError(null)
    try {
      await verifyResubmission(
        { businessSlug, phone, code: code.trim(), submissionKey: key },
        proof.file,
      )
      onDone()
    } catch (submitError) {
      setError(toUserMessage(submitError))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <section className="card card--padded" aria-label="Resubmit payment proof">
      <h2 className="card__title">Resubmit payment proof</h2>
      <p className="card__subtitle">
        A rejected booking can only be resubmitted with a one-time code. Request
        one, then enter the 6-digit code you are given with a fresh proof.
      </p>

      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert tone="danger" title="Could not resubmit">
            {error}
          </Alert>
        </div>
      )}

      {phase === 'idle' ? (
        <div className="booking-actions">
          <Button
            variant="primary"
            onClick={() => void requestCode()}
            loading={requesting}
            disabled={requesting}
          >
            Request a one-time code
          </Button>
          <Button variant="outline" onClick={onClose} disabled={requesting}>
            Cancel
          </Button>
        </div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Alert tone="info" title="Code requested">
            For security the code is delivered separately from this page. If you
            do not have it, contact the business.
          </Alert>

          <Field
            label="One-time code"
            hint="The 6-digit code you were given."
            error={codeError ?? undefined}
          >
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value)
                  if (codeError) setCodeError(null)
                }}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={ariaDescribedBy}
                placeholder="123456"
              />
            )}
          </Field>

          <h3 className="option-group__title">New payment proof</h3>
          {proof ? (
            <div className="proof-preview">
              <span>
                <strong>{proof.fileName}</strong>{' '}
                <span className="line-item__meta">
                  ({formatBytes(proof.sizeBytes)} · {proof.mimeType})
                </span>
              </span>
              <Button type="button" variant="outline" onClick={() => setProof(null)}>
                Replace
              </Button>
            </div>
          ) : (
            <div className="upload-zone">
              <label className="upload-zone__label" htmlFor="resubmit-proof-upload">
                Choose image or PDF
              </label>
              <input
                id="resubmit-proof-upload"
                className="sr-only"
                type="file"
                accept="image/bmp,image/gif,image/jpeg,image/png,image/webp,application/pdf,.pdf"
                onChange={handleProofChange}
              />
              <p className="line-item__meta">Max 5 MB.</p>
            </div>
          )}
          {proofError && (
            <Alert tone="danger" title="Could not use that proof">
              {proofError}
            </Alert>
          )}

          <nav className="wizard__nav" aria-label="Resubmission actions">
            <Button type="button" variant="outline" onClick={onClose} disabled={verifying}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={verifying}
              disabled={verifying}
            >
              Verify & resubmit
            </Button>
          </nav>
        </form>
      )}
    </section>
  )
}
