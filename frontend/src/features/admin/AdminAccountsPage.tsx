import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { toUserMessage } from '@/api/errors'
import {
  createAdmin,
  deactivateAdmin,
  forceLogoutUser,
  listAdmins,
  resetAdminPassword,
} from '@/api/admin'
import type { AdminUserView } from '@/api/types'

const MAX_ACTIVE_ADMINS = 2

/**
 * Admin-account lifecycle (REQ-217/219/220). Super Admin only.
 *
 * The exactly-two-active-Admin cap is enforced by the backend inside an
 * advisory-locked transaction; this page surfaces the count and the server's
 * rejection rather than trusting a client-side rule.
 */
export function AdminAccountsPage() {
  const [admins, setAdmins] = useState<AdminUserView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setAdmins(await listAdmins())
    } catch (error) {
      setLoadError(toUserMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeCount = admins.filter((admin) => !admin.isDeactivated).length

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return
    setCreating(true)
    setActionError(null)
    setNotice(null)
    try {
      const created = await createAdmin({
        email: email.trim(),
        password,
        recoveryEmail: recoveryEmail.trim() || undefined,
      })
      setNotice(`Admin account created (${created.email}).`)
      setEmail('')
      setPassword('')
      setRecoveryEmail('')
      await refresh()
    } catch (error) {
      setActionError(toUserMessage(error))
    } finally {
      setCreating(false)
    }
  }

  async function runRowAction(id: string, action: () => Promise<void>, success: string) {
    setBusyId(id)
    setActionError(null)
    setNotice(null)
    try {
      await action()
      setNotice(success)
      setResetPasswords((current) => {
        const next = { ...current }
        delete next[id]
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
    <div className="admin-accounts">
      <h1 className="page-title">Admin accounts</h1>
      <p className="page-subtitle">
        The platform allows exactly two active Admins. Creating, deactivating and
        resetting passwords is reserved to the Super Admin (REQ-217/219).
      </p>

      {loadError && (
        <Alert tone="danger" title="Could not load admin accounts">
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

      <section className="card card--padded admin-create" aria-label="Create admin">
        <h2 className="admin-card__title">Create an Admin</h2>
        <p className="field__hint">
          {activeCount} of {MAX_ACTIVE_ADMINS} active Admins.
        </p>
        <form className="auth-form" onSubmit={handleCreate} noValidate>
          <Field label="Email">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="email"
                name="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={creating}
                required
              />
            )}
          </Field>
          <Field label="Initial password">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="password"
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={creating}
                required
              />
            )}
          </Field>
          <Field label="Recovery email (optional)">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="email"
                name="recoveryEmail"
                autoComplete="off"
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                disabled={creating}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={creating}>
            Create Admin
          </Button>
        </form>
      </section>

      {loading ? (
        <p className="telegram-panel__note">Loading admin accounts…</p>
      ) : (
        <ul className="proof-queue admin-list">
          {admins.map((admin) => (
            <li key={admin.id} className="card card--padded proof-queue__row">
              <div className="proof-queue__meta">
                <p className="dashboard-name">{admin.email}</p>
                <p className="field__hint">
                  Created {new Date(admin.createdAt).toLocaleDateString()} ·{' '}
                  {admin.isDeactivated ? 'Deactivated' : 'Active'} ·{' '}
                  {admin.activeSessions} active session
                  {admin.activeSessions === 1 ? '' : 's'}
                </p>
              </div>
              <div className="proof-queue__actions">
                <div className="proof-queue__reject">
                  <input
                    type="text"
                    aria-label={`New password for ${admin.email}`}
                    placeholder="New password"
                    value={resetPasswords[admin.id] ?? ''}
                    onChange={(event) =>
                      setResetPasswords((current) => ({
                        ...current,
                        [admin.id]: event.target.value,
                      }))
                    }
                    disabled={busyId !== null || admin.isDeactivated}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    loading={busyId === admin.id}
                    disabled={busyId !== null || admin.isDeactivated || !resetPasswords[admin.id]}
                    onClick={() =>
                      void runRowAction(
                        admin.id,
                        () => resetAdminPassword(admin.id, resetPasswords[admin.id]),
                        `Password reset for ${admin.email}; all their sessions were revoked.`,
                      )
                    }
                  >
                    Reset password
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  loading={busyId === admin.id}
                  disabled={busyId !== null}
                  onClick={() =>
                    void runRowAction(
                      admin.id,
                      () => forceLogoutUser(admin.id),
                      `All sessions for ${admin.email} were revoked.`,
                    )
                  }
                >
                  Force logout
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  loading={busyId === admin.id}
                  disabled={busyId !== null || admin.isDeactivated}
                  onClick={() =>
                    void runRowAction(
                      admin.id,
                      () => deactivateAdmin(admin.id),
                      `${admin.email} was deactivated and their sessions revoked.`,
                    )
                  }
                >
                  Deactivate
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
