import { useEffect, useState } from 'react'
import { useAuth } from '../useAuth'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string
            callback(response: { credential: string }): void
          }): void
          renderButton(
            parent: HTMLElement,
            options: {
              theme?: string
              size?: string
              width?: number
              text?: string
              shape?: string
              logo_alignment?: string
            },
          ): void
          prompt?(): void
        }
      }
    }
  }
}

interface GoogleLoginButtonProps {
  onSuccess?: () => void
  onError?: (err: string) => void
}

export function GoogleLoginButton({ onSuccess, onError }: GoogleLoginButtonProps) {
  const { loginWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  useEffect(() => {
    if (!googleClientId) return

    const handleCredentialResponse = async (response: { credential: string }) => {
      try {
        setLoading(true)
        const ok = await loginWithGoogle(response.credential)
        if (ok) {
          onSuccess?.()
        } else {
          onError?.('Google authentication failed.')
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Google login failed'
        onError?.(message)
      } finally {
        setLoading(false)
      }
    }

    const initializeGoogle = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleCredentialResponse,
        })

        const target = document.getElementById('googleSignInDiv')
        if (target) {
          target.innerHTML = ''
          window.google.accounts.id.renderButton(target, {
            theme: 'filled_black',
            size: 'large',
            width: 340,
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'center',
          })
        }
      }
    }

    if (window.google) {
      initializeGoogle()
    } else {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
      if (existing) {
        initializeGoogle()
        return
      }
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = initializeGoogle
      document.body.appendChild(script)
    }
  }, [googleClientId, loginWithGoogle, onSuccess, onError])

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!googleClientId) {
    return (
      <>
        <button
          type="button"
          className="google-btn-custom"
          onClick={() => setShowConfigModal(true)}
          aria-haspopup="dialog"
        >
          <GoogleIcon />
          <span>Continue with Google <span className="amharic-sub">(በGoogle ይቀጥሉ)</span></span>
        </button>

        {showConfigModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '16px',
            }}
            onClick={() => setShowConfigModal(false)}
          >
            <div
              style={{
                backgroundColor: 'var(--color-surface, #1e1b2e)',
                color: 'var(--color-text, #f1f0f7)',
                borderRadius: '16px',
                border: '1px solid var(--color-border, rgba(255, 255, 255, 0.12))',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                maxWidth: '480px',
                width: '100%',
                padding: '24px',
                position: 'relative',
              }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="google-modal-title"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <GoogleIcon />
                  <h3 id="google-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                    Google Sign-In · የGoogle መግቢያ
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-muted, #94a3b8)',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--color-text-muted, #94a3b8)', marginBottom: '16px' }}>
                Google Sign-In is ready in the codebase! To connect your live Google account, add your Google OAuth Client ID to your environment configuration:
              </p>

              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid var(--color-border, rgba(255, 255, 255, 0.1))',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  wordBreak: 'break-all',
                }}
              >
                <span>VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com</span>
                <button
                  type="button"
                  className="btn btn--sm btn--outline"
                  style={{ flexShrink: 0, fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      'VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com',
                    )
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              <div
                style={{
                  background: 'rgba(124, 92, 252, 0.1)',
                  border: '1px solid rgba(124, 92, 252, 0.25)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '20px',
                  fontSize: '13px',
                  lineHeight: 1.45,
                }}
              >
                <strong>💡 Tip for local development:</strong>
                <p style={{ margin: '4px 0 0 0', color: 'var(--color-text-muted, #cbd5e1)' }}>
                  You don&apos;t need Google to get started! You can register or sign in immediately using the <strong>Email &amp; Password</strong> form below.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ width: '100%' }}
                  onClick={() => setShowConfigModal(false)}
                >
                  Got it, use Email &amp; Password (እሺ፣ በኢሜይል እገባለሁ)
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="google-btn-container">
      {loading ? <p className="google-loading">Connecting with Google…</p> : null}
      <div id="googleSignInDiv" style={{ display: 'flex', justifyContent: 'center', minHeight: '40px' }} />
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}
