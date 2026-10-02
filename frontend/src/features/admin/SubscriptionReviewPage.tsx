import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { toUserMessage } from '@/api/errors'
import {
  approveSubscriptionProof,
  listSubscriptionProofs,
  loadSubscriptionProofFile,
  rejectSubscriptionProof,
} from '@/api/admin'
import type { AdminSubscriptionProofView, SubscriptionReviewState } from '@/api/types'
import { PaymentProofPreview } from '@/components/proof/PaymentProofPreview'

/**
 * Admin subscription proof review (Prompt 52; REQ-137/138).
 *
 * Lists owner payment proofs with their owning business + owner and lets an
 * Admin / Super Admin approve (activates a 30-day period) or reject with a
 * mandatory reason that is sent to the owner (N15). Backend-gated
 * `requireAdminOrSuperAdmin`; this page is a UX shell only.
 *
 * A decision never deletes or duplicates the payment: approval/rejection mutate
 * the same `SubscriptionProof` row, which then leaves the PENDING queue and
 * remains readable under its own state. The three views therefore select the
 * EXISTING `GET /admin/subscription/proofs?state=` query value
 * (`PENDING` | `APPROVED` | `REJECTED`) — no extra endpoint, no client-side
 * fabrication. `PENDING` stays the default and is the only view that offers the
 * decision controls; the decided views are read-only receipts (the proof bytes
 * still come from the same Admin-authorized file route).
 */

const REVIEW_VIEWS: ReadonlyArray<{
  state: SubscriptionReviewState
  label: string
  empty: string
}> = [
  { state: 'PENDING', label: 'Pending review', empty: 'No pending proofs.' },
  { state: 'APPROVED', label: 'Approved', empty: 'No approved proofs.' },
  { state: 'REJECTED', label: 'Rejected', empty: 'No rejected proofs.' },
]

/** Reuses the owner portal's review-state chip classes (SubscriptionCard). */
const REVIEW_CHIP: Record<SubscriptionReviewState, string> = {
  PENDING: 'booking-chip--active',
  APPROVED: 'booking-chip--confirmed',
  REJECTED: 'booking-chip--rejected',
}

function ReviewStateChip({ reviewState }: { reviewState: SubscriptionReviewState }) {
  return (
    <span className={`booking-chip ${REVIEW_CHIP[reviewState]}`} data-testid="proof-review-state">
      {reviewState}
    </span>
  )
}

function shortDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString()
}

export function SubscriptionReviewPage() {
  const [view, setView] = useState<SubscriptionReviewState>('PENDING')
  const [rows, setRows] = useState<AdminSubscriptionProofView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (state: SubscriptionReviewState) => {
    setLoading(true)
    setLoadError(null)
    try {
      setRows(await listSubscriptionProofs(state))
    } catch (error) {
      setLoadError(toUserMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(view)
  }, [view, refresh])

  const runAction = async (proofId: string, action: () => Promise<AdminSubscriptionProofView>) => {
    setBusyId(proofId)
    setActionError(null)
    setNotice(null)
    try {
      const updated = await action()
      setNotice(
        updated.reviewState === 'APPROVED'
          ? `Approved — ${updated.businessName} is active through ${new Date(
              updated.approvedUntil ?? '',
            ).toLocaleDateString()}. The proof is kept and listed under Approved.`
          : `Rejected — the owner was notified (N15). The proof is kept and listed under Rejected.`,
      )
      setRejectReasons((current) => {
        const next = { ...current }
        delete next[proofId]
        return next
      })
      await refresh(view)
    } catch (error) {
      setActionError(toUserMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const activeView = REVIEW_VIEWS.find((candidate) => candidate.state === view) ?? REVIEW_VIEWS[0]
  const decided = view !== 'PENDING'

  return (
    <div className="page-root">
      <h1 className="page-title">Subscription payment proofs</h1>
      <p className="page-subtitle">
        Approve a payment proof to activate/extend a 30-day period; reject with a reason that goes
        to the owner (REQ-137/138). A decision updates the existing proof — it is never deleted —
        so pending work leaves this queue and stays listed under its own status.
      </p>

      <div className="proof-queue__tabs" role="tablist" aria-label="Proof review state">
        {REVIEW_VIEWS.map((candidate) => (
          <button
            key={candidate.state}
            type="button"
            role="tab"
            id={`proof-view-${candidate.state}`}
            aria-selected={candidate.state === view}
            aria-controls="proof-view-panel"
            className="proof-queue__tab"
            onClick={() => setView(candidate.state)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {loadError && (
        <Alert tone="danger" title="Could not load the queue">
          {loadError}
        </Alert>
      )}
      {actionError && (
        <Alert tone="danger" title="The action did not go through">
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" live="polite">
          {notice}
        </Alert>
      )}

      <div id="proof-view-panel" role="tabpanel" aria-labelledby={`proof-view-${view}`}>
        {loading ? (
          <p className="telegram-panel__note">Loading {activeView.label.toLowerCase()} proofs…</p>
        ) : rows.length === 0 ? (
          <p className="telegram-panel__note">{activeView.empty}</p>
        ) : (
          <ul className="proof-queue" aria-label={`${activeView.label} proofs`}>
            {rows.map((row) => (
              <li key={row.id} className="card card--padded proof-queue__row">
                <div className="proof-queue__meta">
                  <p className="dashboard-name">{row.businessName}</p>
                  <ReviewStateChip reviewState={row.reviewState} />
                  <p className="field__hint">
                    Owner: {row.ownerEmail} · submitted {new Date(row.requestedAt).toLocaleString()}
                  </p>
                  {row.approvedUntil && (
                    <p className="field__hint" data-testid="proof-approved-until">
                      Approved through {shortDate(row.approvedUntil)}
                    </p>
                  )}
                  {row.rejectionReason && (
                    <p className="field__hint" data-testid="proof-rejection-reason">
                      Review note: {row.rejectionReason}
                    </p>
                  )}
                </div>
                <PaymentProofPreview
                  loadKey={row.id}
                  load={() => loadSubscriptionProofFile(row.id)}
                  submittedAt={row.requestedAt}
                  title="Payment Receipt / Proof"
                  downloadLabel="Download receipt"
                />
                {decided ? null : (
                  <div className="proof-queue__actions">
                    <Button
                      type="button"
                      variant="primary"
                      loading={busyId === row.id}
                      disabled={busyId !== null}
                      onClick={() => void runAction(row.id, () => approveSubscriptionProof(row.id))}
                    >
                      Approve
                    </Button>
                    <div className="proof-queue__reject">
                      <input
                        type="text"
                        aria-label={`Rejection reason for ${row.businessName}`}
                        placeholder="Rejection reason (required, sent to owner)"
                        value={rejectReasons[row.id] ?? ''}
                        onChange={(event) =>
                          setRejectReasons((current) => ({ ...current, [row.id]: event.target.value }))
                        }
                        disabled={busyId !== null}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        loading={busyId === row.id}
                        disabled={busyId !== null || !rejectReasons[row.id]?.trim()}
                        onClick={() =>
                          void runAction(row.id, () =>
                            rejectSubscriptionProof(row.id, rejectReasons[row.id].trim()),
                          )
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}