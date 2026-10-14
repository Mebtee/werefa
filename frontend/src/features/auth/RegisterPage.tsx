import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { useAuth } from './useAuth'
import { GoogleLoginButton } from './components/GoogleLoginButton'

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
 * step) and signs the owner straight in.
 */
export function RegisterPage() {
  const { status, error, register } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'authenticated') {
      // Auto-login on registration success → straight to the owner portal
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
            <h1 className="auth-brand__sub">
              Create an owner account <span className="amharic-sub">(አካውንት ይክፈቱ)</span>
            </h1>
          </div>
        </div>

        {error && !busy ? (
          <Alert tone="danger" title="Registration failed">
            {error}
          </Alert>
        ) : null}

        {googleError ? (
          <Alert tone="danger" title="Google sign in error">
            {googleError}
          </Alert>
        ) : null}

        <GoogleLoginButton onError={(err) => setGoogleError(err)} />

        <div className="auth-divider">or register with email • ወይም በኢሜይል ይመዝገቡ</div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Field
            label="Email"
            hint="ኢሜይል አድራሻ"
            error={fieldErrors.email}
          >
            {({ id, ariaDescribedBy }) => (
              <input
                id={id}
                className="input"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="owner@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={ariaDescribedBy}
                aria-invalid={Boolean(fieldErrors.email) || undefined}
                disabled={busy}
                autoFocus
              />
            )}
          </Field>

          <Field
            label="Password"
            hint="የይለፍ ቃል (ቢያንስ 8 ፊደላት)"
            error={fieldErrors.password}
          >
            {({ id, ariaDescribedBy }) => (
              <div className="password-input-wrapper">
                <input
                  id={id}
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={Boolean(fieldErrors.password) || undefined}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </Field>

          <Field
            label={
              <>
                Confirm password <span className="amharic-sub">(የይለፍ ቃል ያረጋግጡ)</span>
              </>
            }
            error={fieldErrors.confirmPassword}
          >
            {({ id, ariaDescribedBy }) => (
              <div className="password-input-wrapper">
                <input
                  id={id}
                  className="input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={Boolean(fieldErrors.confirmPassword) || undefined}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </Field>

          <Button type="submit" variant="primary" block loading={busy}>
            {busy ? 'Creating account… (በመፍጠር ላይ…)' : 'Create account • አካውንት ይፍጠሩ'}
          </Button>
        </form>

        <p className="auth-form__note">
          Already registered? <Link to="/owner/login">Sign in (ይግቡ)</Link> instead.
        </p>
      </div>
    </div>
  )
}