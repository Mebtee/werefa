import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { toUserMessage } from '@/api/errors'
import {
  approveSubscriptionProof,
  listSubscriptionProofs,
  rejectSubscriptionProof,
} from '@/api/admin'
import type { AdminSubscriptionProofView } from '@/api/types'

/**
 * Admin subscription proof review queue (Prompt 52; REQ-137/138).
 *
 * Lists pending payment proofs with their owning business + owner and lets an
 * Admin / Super Admin approve (activates a 30-day period) or reject with a
 * mandatory reason that is sent to the owner (N15). Backend-gated
 * `requireAdminOrSuperAdmin`; this page is a UX shell only.
 */
export function SubscriptionReviewPage() {
  const [rows, setRows] = useState<AdminSubscriptionProofView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setRows(await listSubscriptionProofs('PENDING'))
    } catch (error) {
      setLoadError(toUserMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
            ).toLocaleDateString()}.`
          : `Rejected — the owner was notified (N15).`,
      )
      setRejectReasons((current) => {
        const next = { ...current }
        delete next[proofId]
        return next
      })
      await refresh()
    } catch (error) {
      setActionError(toUserMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-root">
      <h1 className="page-title">Subscription review queue</h1>
      <p className="page-subtitle">
        Approve a payment proof to activate/extend a 30-day period; reject with a reason that goes
        to the owner (REQ-137/138).
      </p>

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

      {loading ? (
        <p className="telegram-panel__note">Loading pending proofs…</p>
      ) : rows.length === 0 ? (
        <p className="telegram-panel__note">No pending proofs.</p>
      ) : (
        <ul className="proof-queue">
          {rows.map((row) => (
            <li key={row.id} className="card card--padded proof-queue__row">
              <div className="proof-queue__meta">
                <p className="dashboard-name">{row.businessName}</p>
                <p className="field__hint">
                  Owner: {row.ownerEmail} · submitted {new Date(row.requestedAt).toLocaleString()}
                </p>
              </div>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}