import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { AuthLoadingScreen } from './RequireOwner'
import { useAuth } from './useAuth'
import { GoogleLoginButton } from './components/GoogleLoginButton'

/** Basic email shape. The backend remains the authoritative validator. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface LoginFieldErrors {
  email?: string
  password?: string
}

/**
 * Owner sign-in surface with Google Sign-In and bilingual Amharic hints.
 */
export function LoginPage() {
  const { status, principal, error, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)

  const requestedFrom = (location.state as { from?: string } | null)?.from
  const destination =
    requestedFrom && requestedFrom.startsWith('/owner') ? requestedFrom : '/owner'

  useEffect(() => {
    if (status !== 'authenticated' || !principal) return
    if (principal.role === 'OWNER') {
      navigate(destination, { replace: true })
    } else {
      navigate('/admin', { replace: true })
    }
  }, [status, principal, destination, navigate])

  if (status === 'loading') {
    return <AuthLoadingScreen />
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
            <h1 className="auth-brand__sub">
              Owner sign in <span className="amharic-sub">(የንግድ ባለቤት መግቢያ)</span>
            </h1>
          </div>
        </div>

        {error && !busy ? (
          <Alert tone="danger" title="Sign in failed">
            {error}
          </Alert>
        ) : null}

        {googleError ? (
          <Alert tone="danger" title="Google sign in error">
            {googleError}
          </Alert>
        ) : null}

        {!location.pathname.startsWith('/owner') && (
          <>
            <GoogleLoginButton onError={(err) => setGoogleError(err)} />
            <div className="auth-divider">or with email • ወይም በኢሜይል</div>
          </>
        )}

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
            hint="የይለፍ ቃል"
            error={fieldErrors.password}
          >
            {({ id, ariaDescribedBy }) => (
              <div className="password-input-wrapper">
                <input
                  id={id}
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
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

          <Button type="submit" variant="primary" block loading={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="auth-form__note">
          Customers do not sign in. A customer tracks a booking from the link on
          their confirmation.
        </p>
        <p className="auth-form__note">
          New to the scheduler?{' '}
          <Link to="/owner/register">Create an owner account (የንግድ ባለቤት አካውንት ይክፈቱ)</Link> — verified in seconds.
        </p>
      </div>
    </div>
  )
}
