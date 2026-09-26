import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { toUserMessage } from '@/api/errors'
import {
  getOwnerSubscription,
  submitSubscriptionProof,
  type PendingProofFile,
} from '@/api/subscription'
import type { OwnerSubscriptionView, SubscriptionProofView } from '@/api/types'
import {
  SUBSCRIPTION_STATUS_CHIP,
  SUBSCRIPTION_STATUS_LABEL,
} from '@/features/owner-portal/lib/labels'
import { isoDate, subscriptionBanner } from '@/features/owner-portal/lib/subscriptionPresentation'

interface SubscriptionCardProps {
  businessId: string
}

type Phase = 'loading' | 'ready' | 'error'

const PROOF_MAX_BYTES = 5 * 1024 * 1024
const PROOF_MIME_TYPES = new Set([
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])
const PROOF_ACCEPT = Array.from(PROOF_MIME_TYPES).join(',')

function newSubmissionKey(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `sub-${rand}`
}

function fileSignature(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result))
      else reject(new Error('The selected file could not be read.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('The selected file could not be read.'))
    reader.readAsArrayBuffer(file)
  })
}

const PROOF_CHIP: Record<SubscriptionProofView['reviewState'], string> = {
  PENDING: 'booking-chip--active',
  APPROVED: 'booking-chip--confirmed',
  REJECTED: 'booking-chip--rejected',
}

function ProofChip({ reviewState }: { reviewState: SubscriptionProofView['reviewState'] }) {
  return (
    <span className={`booking-chip ${PROOF_CHIP[reviewState]}`} data-testid="proof-review-state">
      {reviewState}
    </span>
  )
}

export function SubscriptionCard({ businessId }: SubscriptionCardProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [subscription, setSubscription] = useState<OwnerSubscriptionView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitNotice, setSubmitNotice] = useState<string | null>(null)
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attemptFileRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setPhase('loading')
    setLoadError(null)
    try {
      const view = await getOwnerSubscription(businessId)
      if (requestIdRef.current !== requestId) return
      setSubscription(view)
      setPhase('ready')
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      setLoadError(toUserMessage(error))
      setPhase('error')
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
    return () => {
      requestIdRef.current += 1
    }
  }, [refresh])

  const chooseFile = (file: File | null) => {
    setSubmitNotice(null)
    if (!file) {
      setSelectedFile(null)
      return
    }
    if (file.size > PROOF_MAX_BYTES) {
      setSelectedFile(null)
      setSubmitError('Payment proof must be 5 MB or smaller.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (!PROOF_MIME_TYPES.has(file.type)) {
      setSelectedFile(null)
      setSubmitError('Choose a BMP, GIF, JPEG, PNG, WebP, or PDF file.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const signature = fileSignature(file)
    if (attemptFileRef.current && attemptFileRef.current !== signature) {
      setSubmissionKey(newSubmissionKey())
    }
    attemptFileRef.current = signature
    setSubmitError(null)
    setSelectedFile(file)
  }

  const banner = subscription ? subscriptionBanner(subscription) : null

  const handleUpload = async () => {
    setSubmitError(null)
    setSubmitNotice(null)
    if (!selectedFile) {
      setSubmitError('Choose a payment proof first.')
      return
    }
    if (selectedFile.size > PROOF_MAX_BYTES || !PROOF_MIME_TYPES.has(selectedFile.type)) {
      chooseFile(null)
      setSubmitError('Choose a supported payment proof file that is 5 MB or smaller.')
      return
    }

    setSubmitting(true)
    try {
      const file: PendingProofFile = {
        bytes: await readFileBytes(selectedFile),
        contentType: selectedFile.type,
        filename: selectedFile.name,
      }
      const proof = await submitSubscriptionProof(businessId, submissionKey, file)
      setSubmitNotice(
        proof.reviewState === 'APPROVED'
          ? 'This proof was already approved.'
          : 'Payment proof received. The accounts team will review it.',
      )
      setSubscription((current) =>
        current ? { ...current, proofs: [proof, ...current.proofs] } : current,
      )
      setSelectedFile(null)
      attemptFileRef.current = null
      setSubmissionKey(newSubmissionKey())
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      setSubmitError(toUserMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="card card--padded subscription-card" aria-labelledby="subscription-title">
      <h2 className="card__title" id="subscription-title">
        Subscription
      </h2>
      <p className="card__subtitle">Current status and payment proof history for this business.</p>

      {phase === 'loading' ? (
        <p className="telegram-panel__note">Loading subscription…</p>
      ) : phase === 'error' ? (
        <div>
          <p className="telegram-panel__note">{loadError}</p>
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : subscription ? (
        <div className="subscription-panel">
          <p className="subscription-status">
            <span
              className={`booking-chip ${SUBSCRIPTION_STATUS_CHIP[subscription.status]}`}
              data-testid="subscription-status-chip"
            >
              {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
            </span>
          </p>

          {banner && (
            <Alert tone={banner.tone} title={banner.title}>
              {banner.text}
            </Alert>
          )}

          <p className="subscription-panel__note">
            Bookings {subscription.bookingsEnabled ? 'are open' : 'are closed'} on your public page.
          </p>

          <div className="subscription-upload">
            <p className="field__label">Payment proof</p>
            <p className="field__hint">
              After a manual bank transfer, upload the payment proof for review.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Subscription payment proof"
              accept={PROOF_ACCEPT}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              disabled={submitting}
            />
            <p className="field__hint">BMP, GIF, JPEG, PNG, WebP, or PDF. Maximum 5 MB.</p>
            <Button
              type="button"
              variant="primary"
              loading={submitting}
              disabled={submitting || !selectedFile}
              onClick={() => void handleUpload()}
            >
              Upload proof
            </Button>
          </div>
          {submitError && (
            <p className="field__hint subscription-error" role="alert">
              {submitError}
            </p>
          )}
          {submitNotice && (
            <p className="field__hint" role="status">
              {submitNotice}
            </p>
          )}

          {subscription.proofs.length > 0 ? (
            <ul className="subscription-history" aria-label="Subscription proof history">
              {subscription.proofs.map((proof) => (
                <li key={proof.id} className="subscription-history__row">
                  <div>
                    <ProofChip reviewState={proof.reviewState} />
                    <span className="subscription-history__date">
                      Submitted {isoDate(proof.requestedAt)}
                    </span>
                  </div>
                  {proof.approvedUntil && (
                    <span className="subscription-history__date">
                      Approved through {isoDate(proof.approvedUntil)}
                    </span>
                  )}
                  {proof.rejectionReason && (
                    <span className="subscription-history__reason" data-testid="proof-rejection-reason">
                      Review note: {proof.rejectionReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="field__hint">No payment proofs have been submitted.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
