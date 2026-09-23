import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { toUserMessage } from '@/api/errors'
import {
  getOwnerSubscription,
  submitSubscriptionProof,
  type PendingProofFile,
} from '@/api/subscription'
import type { SubscriptionProofView, SubscriptionStatusCode } from '@/api/types'
import {
  SUBSCRIPTION_STATUS_CHIP,
  SUBSCRIPTION_STATUS_LABEL,
} from '@/features/owner-portal/lib/labels'

/**
 * Owner subscription card (Prompt 52; spec §17/§27.2, REQ-125…141).
 *
 * Replaces the demo "Subscription active" badge with the REAL owner
 * subscription view keyed by the tenant business id. Renders the status chip,
 * the REQ-141 warning banner when bookings are at risk (grace) or closed
 * (expired), the manual payment-proof upload (REQ-135/136, idempotent by
 * `submissionKey`) and the proof history (REQ-138 rejection reason).
 *
 * No price is ever shown (§46 item 1 unresolved) and no storage artifacts are
 * exposed — only review state and datetimes.
 */

interface SubscriptionCardProps {
  businessId: string
}

type Phase = 'loading' | 'ready' | 'error'

function isoDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : ''
}

function newSubmissionKey(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `sub-${rand}`
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

/** REQ-141 banner per canonical status (bookings keep running during grace). */
function bannerFor(
  status: SubscriptionStatusCode,
  bookingsEnabled: boolean,
  dateText: string,
): { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; text: string } | null {
  if (!bookingsEnabled) {
    return {
      tone: 'danger',
      title: 'New bookings are closed',
      text: 'Your subscription expired. Upload a payment proof to the arefa accounts team and it will be reopened after approval.',
    }
  }
  switch (status) {
    case 'TRIAL':
      return {
        tone: 'info',
        title: 'Free trial',
        text: dateText ? `Your free trial runs until ${dateText}.` : 'Your free trial is running.',
      }
    case 'TRIAL_GRACE':
      return {
        tone: 'warning',
        title: 'Trial grace period',
        text: dateText
          ? `Your trial ended. Bookings continue until ${dateText} — upload a payment proof to stay live (REQ-132).`
          : 'Your trial ended. Bookings continue during the grace period.',
      }
    case 'PAID_GRACE':
      return {
        tone: 'warning',
        title: 'Paid grace period',
        text: dateText
          ? `Your paid period ended. Bookings continue until ${dateText} — upload a payment proof to renew (REQ-132).`
          : 'Your paid period ended. Bookings continue during the grace period.',
      }
    case 'ACTIVE':
      return {
        tone: 'success',
        title: 'Subscription active',
        text: dateText ? `Your paid subscription runs until ${dateText}.` : 'Your subscription is active.',
      }
    default:
      return null
  }
}

export function SubscriptionCard({ businessId }: SubscriptionCardProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [subscription, setSubscription] = useState<{
    status: SubscriptionStatusCode
    bookingsEnabled: boolean
    trialEndsAt: string | null
    trialGraceEndsAt: string | null
    periodEndsAt: string | null
    paidGraceEndsAt: string | null
    proofs: SubscriptionProofView[]
  } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitNotice, setSubmitNotice] = useState<string | null>(null)
  const [submissionKey, setSubmissionKey] = useState<string>(() => newSubmissionKey())

  const refresh = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const view = await getOwnerSubscription(businessId)
      setSubscription(view)
      setPhase('ready')
    } catch (error) {
      setLoadError(toUserMessage(error))
      setPhase('error')
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isWarn = subscription && !subscription.bookingsEnabled
  const banner = subscription
    ? bannerFor(
        subscription.status,
        subscription.bookingsEnabled,
        isoDate(
          subscription.status === 'ACTIVE'
            ? subscription.periodEndsAt
            : subscription.status === 'TRIAL'
              ? subscription.trialEndsAt
              : subscription.status === 'TRIAL_GRACE'
                ? subscription.trialGraceEndsAt
                : subscription.paidGraceEndsAt,
        ),
      )
    : null

  const handleUpload = async () => {
    setSubmitError(null)
    setSubmitNotice(null)
    if (!selectedFile) {
      setSubmitError('Choose a payment proof image or PDF first.')
      return
    }
    const file: PendingProofFile = {
      bytes: new Uint8Array(await selectedFile.arrayBuffer()),
      contentType: selectedFile.type || 'application/octet-stream',
      filename: selectedFile.name,
    }
    setSubmitting(true)
    try {
      const proof = await submitSubscriptionProof(businessId, submissionKey, file)
      setSubmitNotice(
        proof.reviewState === 'APPROVED'
          ? 'Proof already approved.'
          : 'Payment proof received. The team reviews it shortly (REQ-136).',
      )
      setSelectedFile(null)
      setSubmissionKey(newSubmissionKey())
      await refresh()
    } catch (error) {
      setSubmitError(toUserMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="card card--padded" aria-labelledby="dash-subscription-title">
      <h2 className="card__title" id="dash-subscription-title">
        Subscription
      </h2>
      <p className="card__subtitle">Real subscription status for this business (REQ-141)</p>

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

          {!isWarn && (
            <p className="subscription-panel__note">
              Bookings {subscription.bookingsEnabled ? 'are open' : 'are closed'} on your public
              page.
            </p>
          )}

          <div className="subscription-upload">
            <p className="field__label">Upload a payment proof (REQ-135/136)</p>
            <input
              type="file"
              aria-label="Subscription payment proof"
              accept="image/png,image/jpeg,application/pdf"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              disabled={submitting}
            />
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
            <p className="field__hint" role="alert">
              {submitError}
            </p>
          )}
          {submitNotice && (
            <p className="field__hint" role="status">
              {submitNotice}
            </p>
          )}
          <p className="field__hint">
            Re-submitting the same proof is safe — a repeated upload never duplicates (REQ-121).
          </p>

          {subscription.proofs.length > 0 && (
            <ul className="subscription-history" aria-label="Subscription proof history">
              {subscription.proofs.map((proof) => (
                <li key={proof.id} className="subscription-history__row">
                  <ProofChip reviewState={proof.reviewState} />
                  <span className="subscription-history__date">{isoDate(proof.requestedAt)}</span>
                  {proof.rejectionReason && (
                    <span className="subscription-history__reason" data-testid="proof-rejection-reason">
                      {proof.rejectionReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}