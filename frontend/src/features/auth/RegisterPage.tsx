import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useAuth } from './useAuth'

/** Very light client-side email shape; the backend is the authoritative
 * validator (Prompt 51). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface RegisterFieldErrors {
  email?: string
  password?: string
  confirmPassword?: string
}

/**
 * Owner self-service registration (Prompt 54; REQ-005/009/032). The backend
 * creates the owner account (unverified, isEmailVerified=false — REQ-026/027
 * verification/email-sender is deferred, so there is NO gating/activation
 * step) and signs the owner straight in. This client never shows, drafts, or
 * stores a verification token, and email exists is never leaked (REQ-014/030:
 * the backend answers generically whether registration succeeded).
 */
export function RegisterPage() {
  const { status, error, register } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated') {
      // Auto-login on registration success → straight to the owner portal
      // (REQ-032). No explicit "go verify your email" detour exists yet given
      // the deferred verification slice.
      navigate('/owner', { replace: true })
    }
  }, [status, navigate])

  if (status === 'loading') {
    return null
  }

  const busy = submitting || status === 'authenticating'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const nextErrors: RegisterFieldErrors = {}
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      nextErrors.email = 'Enter your email address.'
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address.'
    }
    if (!password) {
      nextErrors.password = 'Enter a password.'
    } else if (password.length < 8) {
      nextErrors.password = 'Use at least 8 characters.'
    }
    if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match.'
    }

    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    await register({ email: trimmedEmail, password })
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
            <h1>Create an owner account</h1>
          </div>
        </div>

        {error && !busy ? (
          <Alert tone="danger" title="Registration failed">
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
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={Boolean(fieldErrors.password) || undefined}
                disabled={busy}
              />
            )}
          </Field>

          <Field label="Confirm password" error={fieldErrors.confirmPassword}>
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={Boolean(fieldErrors.confirmPassword) || undefined}
                disabled={busy}
              />
            )}
          </Field>

          <Button type="submit" variant="primary" block loading={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="auth-form__note">
          Already registered? <Link to="/owner/login">Sign in</Link> instead.
        </p>
      </div>
    </div>
  )
}