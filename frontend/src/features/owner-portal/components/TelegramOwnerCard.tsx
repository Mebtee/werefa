import { useCallback, useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
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
    <Card
      className="card card--padded"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      aria-labelledby="dash-telegram-title"
    >
      <CardHeader
        avatar={
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(38, 165, 228, 0.16)',
              color: '#26A5E4',
              fontSize: '1.4rem',
            }}
          >
            <i className="ri-telegram-fill" />
          </Box>
        }
        title={
          <Typography
            variant="h6"
            component="h2"
            className="card__title"
            id="dash-telegram-title"
            sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}
          >
            Telegram
          </Typography>
        }
        subheader={
          <Typography
            variant="body2"
            className="card__subtitle"
            sx={{ color: 'text.secondary', fontSize: '0.85rem', mt: 0.25 }}
          >
            Deliver new payment-proof notifications to your chat (N09)
          </Typography>
        }
        sx={{ pb: 1 }}
      />

      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
        {phase.phase === 'loading' ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={18} color="primary" />
            <Typography className="telegram-panel__note" variant="body2" sx={{ color: 'text.secondary' }}>
              Loading your Telegram connection…
            </Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Chip
                size="small"
                icon={<i className={phase.phase === 'connected' ? 'ri-checkbox-circle-fill' : 'ri-time-line'} />}
                label={
                  <span
                    className="telegram-status"
                    data-connected={phase.phase === 'connected' ? 'true' : 'false'}
                  >
                    {phase.phase === 'connected' ? 'Telegram connected' : 'Not connected'}
                  </span>
                }
                color={phase.phase === 'connected' ? 'success' : 'default'}
                sx={{
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  height: 28,
                  backgroundColor:
                    phase.phase === 'connected'
                      ? 'rgba(86, 202, 0, 0.16)'
                      : 'rgba(231, 227, 252, 0.08)',
                  color: phase.phase === 'connected' ? 'success.light' : 'text.secondary',
                  border: '1px solid',
                  borderColor:
                    phase.phase === 'connected'
                      ? 'rgba(86, 202, 0, 0.3)'
                      : 'divider',
                  '& .telegram-status::before': { display: 'none' },
                }}
              />
            </Box>

            {phase.phase === 'connected' ? (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  backgroundColor: 'rgba(86, 202, 0, 0.06)',
                  border: '1px solid rgba(86, 202, 0, 0.2)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                }}
              >
                <Box sx={{ color: 'success.main', fontSize: '1.25rem', mt: 0.25 }}>
                  <i className="ri-shield-check-line" />
                </Box>
                <Typography
                  className="telegram-panel__note"
                  variant="body2"
                  sx={{ color: 'text.secondary', lineHeight: 1.5 }}
                >
                  New payment proofs arrive in your Telegram with Accept and Reject
                  buttons (REQ-067/068). The dashboard remains the primary workbench.
                </Typography>
              </Box>
            ) : phase.phase === 'ready' ? (
              <Box className="telegram-panel__inbox" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography className="telegram-panel__note" variant="body2" sx={{ color: 'text.secondary' }}>
                  Open Telegram to finish connecting this business:
                </Typography>
                <Box sx={{ my: 0.5 }}>
                  <Button
                    component="a"
                    className="btn btn--primary"
                    href={ready!.deepLink}
                    target="_blank"
                    rel="noreferrer"
                    variant="contained"
                    color="primary"
                    startIcon={<i className="ri-telegram-fill" />}
                    sx={{
                      background: 'linear-gradient(98deg, #8C57FF 0%, #7E4EE6 100%)',
                      boxShadow: '0 4px 14px 0 rgba(140, 87, 255, 0.4)',
                    }}
                  >
                    Open Telegram
                  </Button>
                </Box>
                {remaining !== null && remaining > 0 && (
                  <Typography
                    className="telegram-panel__note"
                    variant="caption"
                    sx={{
                      color: 'warning.main',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                    }}
                    aria-live="off"
                  >
                    <i className="ri-time-line" /> Link expires in {formatRemaining(remaining)}.
                  </Typography>
                )}
              </Box>
            ) : (
              <Box className="telegram-panel__inbox" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography
                  className="telegram-panel__note"
                  variant="body2"
                  sx={{ color: 'text.secondary', lineHeight: 1.5 }}
                >
                  When you connect, a one-time link links your personal Telegram
                  chat to this business for proof notifications.
                </Typography>
                {notice && (
                  <Typography
                    className="field__hint"
                    role="status"
                    variant="body2"
                    sx={{ color: 'error.main', fontWeight: 500 }}
                  >
                    {notice}
                  </Typography>
                )}
                <Box sx={{ mt: 0.5 }}>
                  <Button
                    type="button"
                    variant="contained"
                    color="primary"
                    disabled={phase.phase === 'connecting'}
                    onClick={() => void handleConnect()}
                    startIcon={
                      phase.phase === 'connecting' ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <i className="ri-telegram-fill" />
                      )
                    }
                    sx={{
                      background: 'linear-gradient(98deg, #8C57FF 0%, #7E4EE6 100%)',
                      boxShadow: '0 4px 14px 0 rgba(140, 87, 255, 0.4)',
                    }}
                  >
                    Connect Telegram
                  </Button>
                </Box>
              </Box>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}