import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { connectCustomerTelegram, telegramLinkFromView } from '@/api/telegram'
import { isValidPhone } from '@/lib/validation'

/**
 * Customer "connect by phone" Telegram card (Prompt 51; REQ-056).
 *
 * Telegram is strictly optional: the card never blocks or re-routes the booking
 * on success OR failure, and it is only ever shown on the DONE step. Connecting
 * issues a one-time 10-minute deep link from the real backend; the plain code
 * is never exposed — the UI only ever shows the link and its countdown.
 */

interface TelegramConnectCardProps {
  businessSlug: string
  /** The phone that will receive the booking notifications. */
  phone: string
}

type CardPhase =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'ready'; deepLink: string; expiresAtMs: number }
  | { phase: 'connected' }
  | { phase: 'error' }

function formatRemaining(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(totalMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function TelegramConnectCard({ businessSlug, phone }: TelegramConnectCardProps) {
  const [phase, setPhase] = useState<CardPhase>({ phase: 'idle' })
  const [candidate, setCandidate] = useState(phone)
  const [notice, setNotice] = useState<string | null>(null)
  const phoneInputRef = useRef<HTMLInputElement | null>(null)

  const ready = phase.phase === 'ready' ? phase : null
  const [remaining, setRemaining] = useState<number | null>(null)

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

  // A one-time code has a 10-minute lifetime; when it lapses, offer a new link.
  useEffect(() => {
    if (ready && remaining !== null && remaining <= 0) {
      setNotice('That link expired — get a new one to connect to Telegram.')
      setPhase({ phase: 'idle' })
    }
  }, [ready, remaining])

  const handleConnect = async () => {
    const trimmed = candidate.trim()
    if (!trimmed) {
      setNotice('Enter your phone number to connect to Telegram.')
      phoneInputRef.current?.focus()
      return
    }
    if (!isValidPhone(trimmed)) {
      setNotice('Enter a valid phone number to connect to Telegram.')
      phoneInputRef.current?.focus()
      return
    }
    setNotice(null)
    setPhase({ phase: 'connecting' })
    try {
      const view = await connectCustomerTelegram(businessSlug, trimmed)
      const link = telegramLinkFromView(view)
      if (link.state === 'connected') {
        setPhase({ phase: 'connected' })
      } else {
        setPhase({ phase: 'ready', deepLink: link.deepLink, expiresAtMs: link.expiresAtMs })
      }
    } catch {
      setNotice('Could not link Telegram right now — your booking is unaffected. You can try again.')
      setPhase({ phase: 'idle' })
    }
  }

  return (
    <section className="card card--padded" aria-labelledby="telegram-connect-title">
      <div className="telegram-panel">
        <div className="telegram-panel__head">
          <div className="telegram-panel__head-text">
            <h2 className="telegram-panel__title" id="telegram-connect-title">
              Do you use Telegram?
            </h2>
            <p className="telegram-panel__note">
              Werefa can send you updates about this booking there once it is
              confirmed. Linking is optional — it never changes how your booking
              is handled.
            </p>
          </div>
        </div>

        {phase.phase === 'connected' ? (
          <p className="telegram-status" data-connected="true">
            Telegram connected for {candidate.trim()}
          </p>
        ) : phase.phase === 'ready' ? (
          <div className="telegram-panel__inbox">
            <p className="telegram-panel__note">
              Open Telegram to finish connecting this phone number:
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
                Link expires in {formatRemaining(remaining)} — then you can ask
                for a new one.
              </p>
            )}
          </div>
        ) : (
          <div className="telegram-panel__inbox">
            <label className="field__label" htmlFor="telegram-connect-phone">
              Phone number to link
            </label>
            <input
              ref={phoneInputRef}
              id="telegram-connect-phone"
              className="input"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={candidate}
              disabled={phase.phase === 'connecting'}
              onChange={(event) => {
                setCandidate(event.target.value)
                if (notice) setNotice(null)
              }}
              placeholder="e.g. +251 911 223 344"
            />
            <p className="telegram-panel__note">
              Updates go to this number's Telegram account for this business
              only. You stay in control — you can connect or ignore it any time.
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
      </div>
    </section>
  )
}