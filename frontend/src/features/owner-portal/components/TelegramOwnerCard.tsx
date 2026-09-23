import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  connectOwnerTelegram,
  getOwnerTelegramStatus,
  telegramLinkFromView,
} from '@/api/telegram'

/**
 * Owner Telegram card on the Dashboard (Prompt 51; §23.3, REQ-065/066/067/068).
 *
 * Uses the REAL owner endpoints keyed by the tenant business id. It shows the
 * live connection state and, when not connected, issues a one-time 10-minute
 * deep link. There is deliberately NO disconnect action (the backend has no
 * disconnect endpoint — do not invent one).
 */

interface TelegramOwnerCardProps {
  businessId: string
}

type Phase =
  | { phase: 'loading' }
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'ready'; deepLink: string; expiresAtMs: number }
  | { phase: 'connected' }

function formatRemaining(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(totalMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function TelegramOwnerCard({ businessId }: TelegramOwnerCardProps) {
  const [phase, setPhase] = useState<Phase>({ phase: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  const ready = phase.phase === 'ready' ? phase : null

  useEffect(() => {
    if (!ready) {
      setRemaining(null)
      return
    }
    const tick = () => setRemaining(Math.max(0, ready.expiresAtMs - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [ready])

  useEffect(() => {
    if (ready && remaining !== null && remaining <= 0) {
      setNotice('That link expired — get a new one to connect your Telegram.')
      setPhase({ phase: 'idle' })
    }
  }, [ready, remaining])

  const refresh = useCallback(async () => {
    setPhase({ phase: 'loading' })
    setNotice(null)
    try {
      const status = await getOwnerTelegramStatus(businessId)
      setPhase(status.connected ? { phase: 'connected' } : { phase: 'idle' })
    } catch {
      setNotice('Could not load your Telegram connection status right now.')
      setPhase({ phase: 'idle' })
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleConnect = async () => {
    setNotice(null)
    setPhase({ phase: 'connecting' })
    try {
      const view = await connectOwnerTelegram(businessId)
      const link = telegramLinkFromView(view)
      if (link.state === 'connected') {
        setPhase({ phase: 'connected' })
      } else {
        setPhase({ phase: 'ready', deepLink: link.deepLink, expiresAtMs: link.expiresAtMs })
      }
    } catch {
      setNotice('Could not connect Telegram right now. Please try again.')
      setPhase({ phase: 'idle' })
    }
  }

  return (
    <section className="card card--padded" aria-labelledby="dash-telegram-title">
      <h2 className="card__title" id="dash-telegram-title">
        Telegram
      </h2>
      <p className="card__subtitle">
        Deliver new payment-proof notifications to your chat (N09)
      </p>

      {phase.phase === 'loading' ? (
        <p className="telegram-panel__note">Loading your Telegram connection…</p>
      ) : (
        <>
          <p className="telegram-status" data-connected={phase.phase === 'connected' ? 'true' : 'false'}>
            {phase.phase === 'connected' ? 'Telegram connected' : 'Not connected'}
          </p>

          {phase.phase === 'connected' ? (
            <p className="telegram-panel__note">
              New payment proofs arrive in your Telegram with Accept and Reject
              buttons (REQ-067/068). The dashboard remains the primary workbench.
            </p>
          ) : phase.phase === 'ready' ? (
            <div className="telegram-panel__inbox">
              <p className="telegram-panel__note">
                Open Telegram to finish connecting this business:
              </p>
              <a
                className="btn btn--primary"
                href={ready!.deepLink}
                target="_blank"
                rel="noreferrer"
              >
                Open Telegram
              </a>
              {remaining !== null && remaining > 0 && (
                <p className="telegram-panel__note" aria-live="off">
                  Link expires in {formatRemaining(remaining)}.
                </p>
              )}
            </div>
          ) : (
            <div className="telegram-panel__inbox">
              <p className="telegram-panel__note">
                When you connect, a one-time link links your personal Telegram
                chat to this business for proof notifications.
              </p>
              {notice && (
                <p className="field__hint" role="status">
                  {notice}
                </p>
              )}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  loading={phase.phase === 'connecting'}
                  disabled={phase.phase === 'connecting'}
                  onClick={() => void handleConnect()}
                >
                  Connect Telegram
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}