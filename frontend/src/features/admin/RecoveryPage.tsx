import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { toUserMessage } from '@/api/errors'
import { recoveryApi } from '@/api/recovery'
import { useAuth } from '@/features/auth/useAuth'

/**
 * Super Admin emergency recovery (REQ-198–200; spec §20.3).
 *
 * Step 1 requests a one-time code; the request always looks successful so the
 * endpoint cannot enumerate accounts, and the code is delivered only to the
 * Super Admin's separate recovery email (never returned here). Step 2 confirms
 * the code and immediately sets a new password, which revokes every session.
 */
export function RecoveryPage() {
  const { principal, refresh } = useAuth()
  const [email, setEmail] = useState(principal?.email ?? '')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reset, setReset] = useState(false)

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requesting) return
    setRequesting(true)
    setError(null)
    try {
      const message = await recoveryApi.requestCode({ email: email.trim() })
      setRequestMessage(message)
    } catch (requestError) {
      setError(toUserMessage(requestError))
    } finally {
      setRequesting(false)
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (confirming) return
    setConfirming(true)
    setError(null)
    try {
      await recoveryApi.confirmReset({
        email: email.trim(),
        code: code.trim(),
        newPassword,
      })
      setReset(true)
      setCode('')
      setNewPassword('')
      // Every session (including this one) was revoked by the reset.
      await refresh()
    } catch (confirmError) {
      setError(toUserMessage(confirmError))
    } finally {
      setConfirming(false)
    }
  }

  if (reset) {
    return (
      <div className="admin-recovery">
        <h1 className="page-title">Emergency recovery</h1>
        <Alert tone="success" live="polite">
          The password was reset and every session was revoked. Sign in again with
          the new password.
        </Alert>
        <p className="auth-screen__actions">
          <Link to="/owner/login">Back to sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="admin-recovery">
      <h1 className="page-title">Emergency recovery</h1>
      <p className="page-subtitle">
        Applies to the single Super Admin account only. A one-time code is sent to
        the separate recovery email; a valid code immediately permits a new
        password and clears any lockout (REQ-198–200).
      </p>

      {error && (
        <Alert tone="danger" title="Recovery failed">
          {error}
        </Alert>
      )}

      <section className="card card--padded" aria-label="Request a recovery code">
        <h2 className="admin-card__title">1. Request a code</h2>
        <form className="auth-form" onSubmit={handleRequest} noValidate>
          <Field label="Super Admin email" hint="The code is sent to the configured recovery email.">
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={ariaDescribedBy}
                disabled={requesting}
                required
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={requesting}>
            Send recovery code
          </Button>
        </form>
        {requestMessage && (
          <Alert tone="info" live="polite">
            {requestMessage}
          </Alert>
        )}
      </section>

      <section className="card card--padded" aria-label="Confirm the recovery code">
        <h2 className="admin-card__title">2. Confirm and set a new password</h2>
        <form className="auth-form" onSubmit={handleConfirm} noValidate>
          <Field label="Recovery code">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={confirming}
                required
              />
            )}
          </Field>
          <Field label="New password">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="password"
                name="newPassword"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={confirming}
                required
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={confirming}>
            Reset password
          </Button>
        </form>
      </section>
    </div>
  )
}
