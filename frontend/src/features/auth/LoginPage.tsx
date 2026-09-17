import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { AuthLoadingScreen } from './RequireOwner'
import { useAuth } from './useAuth'

/** Basic email shape. The backend remains the authoritative validator. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface LoginFieldErrors {
  email?: string
  password?: string
}

function roleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Owner sign-in surface (REQ-024). Email/password only — no social sign-in
 * (REQ-025) and no customer accounts (REQ-040). Credentials are posted to the
 * backend, which owns authentication; the client stores nothing.
 */
export function LoginPage() {
  const { status, principal, error, login, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const requestedFrom = (location.state as { from?: string } | null)?.from
  const destination =
    requestedFrom && requestedFrom.startsWith('/owner') ? requestedFrom : '/owner'

  useEffect(() => {
    if (status === 'authenticated' && principal?.role === 'OWNER') {
      navigate(destination, { replace: true })
    }
  }, [status, principal, destination, navigate])

  if (status === 'loading') {
    return <AuthLoadingScreen />
  }

  if (status === 'authenticated' && principal && principal.role !== 'OWNER') {
    return (
      <div className="auth-screen page-root">
        <div className="auth-screen__inner container">
          <Alert tone="warning" title="Not an owner account">
            You are signed in as a {roleLabel(principal.role)} account, which
            cannot open the owner portal.
          </Alert>
          <p className="auth-screen__actions">
            <Button variant="outline" onClick={() => void logout()}>
              Sign out
            </Button>
          </p>
        </div>
      </div>
    )
  }

  const busy = submitting || status === 'authenticating'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const nextErrors: LoginFieldErrors = {}
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      nextErrors.email = 'Enter your email address.'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address.'
    }
    if (!password) {
      nextErrors.password = 'Enter your password.'
    }

    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    await login({ email: trimmedEmail, password })
    setSubmitting(false)
  }

  return (
    <div className="auth-screen page-root">
      <div className="auth-screen__card card">
        <div className="auth-brand">
          <span className="auth-brand__mark" aria-hidden="true">
            W
          </span>
          <div>
            <div className="auth-brand__name">Werefa</div>
            <h1 className="auth-brand__sub">Owner sign in</h1>
          </div>
        </div>

        {error && !busy ? (
          <Alert tone="danger" title="Sign in failed">
            {error}
          </Alert>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Field label="Email" error={fieldErrors.email}>
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
                aria-invalid={Boolean(fieldErrors.email) || undefined}
                disabled={busy}
                autoFocus
              />
            )}
          </Field>

          <Field label="Password" error={fieldErrors.password}>
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={Boolean(fieldErrors.password) || undefined}
                disabled={busy}
              />
            )}
          </Field>

          <Button type="submit" variant="primary" block loading={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="auth-form__note">
          Customers do not sign in. A customer tracks a booking from the link on
          their confirmation.
        </p>
      </div>
    </div>
  )
}
