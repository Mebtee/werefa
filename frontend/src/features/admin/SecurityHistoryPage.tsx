import { useCallback, useEffect, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { toUserMessage } from '@/api/errors'
import { authApi } from '@/api/auth'
import { deleteSecurityHistory, listPlatformSecurityHistory } from '@/api/admin'
import { useAuth } from '@/features/auth/useAuth'
import type { SecurityEventView } from '@/api/types'

function formatEventType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Security/activity history (REQ-201/202/203/205/206).
 *
 * An Admin sees only their own history (`GET /auth/security`, REQ-202). The
 * Super Admin sees the platform-wide history (`GET /admin/security-history`,
 * REQ-203) and may delete records older than a chosen instant; the backend
 * audits the deletion itself (REQ-206). Retention is one year (REQ-204).
 */
export function SecurityHistoryPage() {
  const { principal } = useAuth()
  const isSuperAdmin = principal?.role === 'SUPER_ADMIN'

  const [events, setEvents] = useState<SecurityEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [olderThan, setOlderThan] = useState('')
  const [deleting, setDeleting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const rows = isSuperAdmin
        ? await listPlatformSecurityHistory()
        : await authApi.securityHistory()
      setEvents(rows)
    } catch (error) {
      setLoadError(toUserMessage(error))
    } finally {
      setLoading(false)
    }
  }, [isSuperAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleDelete() {
    if (!olderThan || deleting) return
    setDeleting(true)
    setActionError(null)
    setNotice(null)
    try {
      const deleted = await deleteSecurityHistory(new Date(`${olderThan}T00:00:00.000Z`).toISOString())
      setNotice(`Deleted ${deleted} security record${deleted === 1 ? '' : 's'}. The deletion was audited.`)
      setOlderThan('')
      await refresh()
    } catch (error) {
      setActionError(toUserMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="admin-security">
      <h1 className="page-title">Security history</h1>
      <p className="page-subtitle">
        {isSuperAdmin
          ? 'Platform-wide login, lockout, recovery and administrative events (REQ-203).'
          : 'Your own login, lockout and account events (REQ-202).'}
      </p>

      {loadError && (
        <Alert tone="danger" title="Could not load security history">
          {loadError}
        </Alert>
      )}
      {actionError && (
        <Alert tone="danger" title="The deletion did not go through">
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" live="polite">
          {notice}
        </Alert>
      )}

      {isSuperAdmin && (
        <section className="card card--padded admin-delete" aria-label="Delete old security records">
          <h2 className="admin-card__title">Delete old records</h2>
          <p className="field__hint">
            Records are retained for one year (REQ-204). Deletion is a Super Admin
            action and is itself audited (REQ-205/206).
          </p>
          <div className="proof-queue__actions">
            <Field label="Delete records older than">
              {({ id }) => (
                <input
                  id={id}
                  className="input"
                  type="date"
                  value={olderThan}
                  onChange={(event) => setOlderThan(event.target.value)}
                  disabled={deleting}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="outline"
              loading={deleting}
              disabled={deleting || !olderThan}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="telegram-panel__note">Loading security history…</p>
      ) : events.length === 0 ? (
        <p className="telegram-panel__note">No security events recorded.</p>
      ) : (
        <ul className="proof-queue admin-list">
          {events.map((event) => (
            <li key={event.id} className="card card--padded admin-event">
              <div className="proof-queue__meta">
                <p className="dashboard-name">{formatEventType(event.type)}</p>
                <p className="field__hint">
                  {new Date(event.createdAt).toLocaleString()} · {event.result}
                  {event.ip ? ` · ${event.ip}` : ''}
                  {event.device ? ` · ${event.device}` : ''}
                  {event.browser ? ` · ${event.browser}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
