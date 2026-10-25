import { useState } from 'react'
import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import type { BusinessDetails, DateString, PauseState } from '@/types/models'
import { pauseOwnedBusiness, resumeOwnedBusiness } from '@/api/business'
import { toUserMessage } from '@/api/errors'
import { Alert } from '@/components/ui/Alert'
import { Field } from '@/components/ui/Field'

interface PauseCardProps {
  /** The real backend id of the owned business (tenant-scoped). */
  businessId: string
  business: BusinessDetails
  onChanged: () => Promise<void>
}

function todayString(): DateString {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/**
 * Pause / resume control (REQ-143…REQ-148).
 *
 * Pausing immediately stops new bookings on the public page (which stays
 * visible and carries the optional pause message). Pausing can be indefinite
 * or scheduled to automatically reopen on a chosen date.
 */
export function PauseCard({ businessId, business, onChanged }: PauseCardProps) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [kind, setKind] = useState<'indefinite' | 'until'>('indefinite')
  const [reopenDate, setReopenDate] = useState<string>('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<{ reopenDate?: string }>({})
  const [saving, setSaving] = useState(false)
  const [flashError, setFlashError] = useState<string | null>(null)
  const [flashSuccess, setFlashSuccess] = useState<string | null>(null)

  const paused = business.pause !== null

  const openEditor = () => {
    const current = business.pause
    setKind(current?.kind === 'until' ? 'until' : 'indefinite')
    setReopenDate(current?.kind === 'until' ? current.reopenDate : '')
    setMessage(current?.message ?? '')
    setErrors({})
    setFlashError(null)
    setMode('edit')
  }

  const applyPause = async (pause: PauseState) => {
    setSaving(true)
    setFlashError(null)
    try {
      if (pause === null) {
        await resumeOwnedBusiness(businessId)
      } else {
        await pauseOwnedBusiness(businessId, {
          pauseMessage: pause.message,
          reopenAt:
            pause.kind === 'until' ? `${pause.reopenDate}T00:00:00.000Z` : undefined,
        })
      }
      setFlashSuccess(
        pause === null
          ? 'Bookings are open again on your public page.'
          : 'Bookings are paused on your public page.',
      )
      setMode('view')
      await onChanged()
    } catch (error) {
      setFlashError(
        toUserMessage(error) === 'Something went wrong. Please try again.'
          ? 'Could not update the pause state. Please try again.'
          : toUserMessage(error),
      )
    } finally {
      setSaving(false)
    }
  }

  const requestSave = () => {
    const nextKind = kind
    if (nextKind === 'until') {
      if (!reopenDate || reopenDate <= todayString()) {
        setErrors({ reopenDate: 'Pick a date in the future for automatic reopening.' })
        return
      }
    }
    setErrors({})
    if (paused) {
      void applyPause(
        nextKind === 'until'
          ? { kind: 'until', reopenDate, message: message.trim() || undefined }
          : { kind: 'indefinite', message: message.trim() || undefined },
      )
    } else {
      setMode('confirm')
    }
  }

  const confirmPause = () => {
    void applyPause(
      kind === 'until'
        ? { kind: 'until', reopenDate, message: message.trim() || undefined }
        : { kind: 'indefinite', message: message.trim() || undefined },
    )
  }

  return (
    <Card
      className="card card--padded"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      aria-labelledby="pause-title"
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
              backgroundColor: paused ? 'rgba(255, 180, 0, 0.16)' : 'rgba(86, 202, 0, 0.16)',
              color: paused ? 'warning.main' : 'success.main',
              fontSize: '1.4rem',
            }}
          >
            <i className={paused ? 'ri-pause-circle-fill' : 'ri-checkbox-circle-fill'} />
          </Box>
        }
        title={
          <Typography
            variant="h6"
            component="h2"
            className="card__title"
            id="pause-title"
            sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}
          >
            Booking status
          </Typography>
        }
        subheader={
          <Typography
            variant="body2"
            className="card__subtitle"
            sx={{ color: 'text.secondary', fontSize: '0.85rem', mt: 0.25 }}
          >
            {paused
              ? business.pause?.kind === 'until'
                ? `Paused until ${business.pause?.reopenDate}`
                : 'Paused indefinitely'
              : 'Open for new bookings'}
          </Typography>
        }
        sx={{ pb: 1 }}
      />

      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
        {flashSuccess && (
          <Box sx={{ mb: 1 }}>
            <Alert tone="success" live="polite">
              {flashSuccess}
            </Alert>
          </Box>
        )}
        {flashError && (
          <Box sx={{ mb: 1 }}>
            <Alert tone="danger">{flashError}</Alert>
          </Box>
        )}

        {mode === 'view' && (
          <Box className="pause-actions" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {paused ? (
              <>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    backgroundColor: 'rgba(255, 180, 0, 0.08)',
                    border: '1px solid rgba(255, 180, 0, 0.25)',
                  }}
                >
                  <Typography className="pause-note" variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5, mb: 0 }}>
                    {business.pause?.message
                      ? `Message to customers: “${business.pause.message}”`
                      : 'No pause message is shown to customers.'}{' '}
                    The public page stays visible but blocks new bookings.
                  </Typography>
                </Box>
                <Box className="pause-actions__row" sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={() => void applyPause(null)}
                    disabled={saving}
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <i className="ri-play-circle-line" />}
                    sx={{
                      backgroundColor: '#56CA00',
                      '&:hover': { backgroundColor: '#4DB600' },
                    }}
                  >
                    Resume bookings now
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    onClick={openEditor}
                    startIcon={<i className="ri-edit-line" />}
                  >
                    Edit pause
                  </Button>
                </Box>
              </>
            ) : (
              <Box>
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={openEditor}
                  startIcon={<i className="ri-pause-circle-line" />}
                  sx={{
                    borderColor: 'rgba(255, 180, 0, 0.5)',
                    color: 'warning.main',
                    '&:hover': {
                      borderColor: 'warning.main',
                      backgroundColor: 'rgba(255, 180, 0, 0.08)',
                    },
                  }}
                >
                  Pause bookings
                </Button>
              </Box>
            )}
          </Box>
        )}

        {(mode === 'edit' || mode === 'confirm') && (
          <form
            className="pause-form"
            onSubmit={(event) => {
              event.preventDefault()
              requestSave()
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <fieldset className="pause-form__group" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="pause-form__legend" style={{ marginBottom: 8, fontWeight: 600 }}>
                  Pause…
                </legend>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Box
                    component="label"
                    className="pause-form__choice"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1.25,
                      px: 2,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: kind === 'indefinite' ? 'primary.main' : 'divider',
                      backgroundColor: kind === 'indefinite' ? 'rgba(140, 87, 255, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="pause-kind"
                      value="indefinite"
                      checked={kind === 'indefinite'}
                      onChange={() => setKind('indefinite')}
                    />
                    <span>Indefinitely</span>
                  </Box>
                  <Box
                    component="label"
                    className="pause-form__choice"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1.25,
                      px: 2,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: kind === 'until' ? 'primary.main' : 'divider',
                      backgroundColor: kind === 'until' ? 'rgba(140, 87, 255, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="pause-kind"
                      value="until"
                      checked={kind === 'until'}
                      onChange={() => setKind('until')}
                    />
                    <span>Until a chosen date</span>
                  </Box>
                </Box>
              </fieldset>

              {kind === 'until' && (
                <div className="pause-form__reopen">
                  <Field label="Reopen date" hint="Bookings reopen automatically on this date." error={errors.reopenDate}>
                    {({ id, ariaDescribedBy }) => (
                      <input
                        id={id}
                        className="input"
                        type="date"
                        value={reopenDate}
                        aria-describedby={ariaDescribedBy}
                        onChange={(event) => setReopenDate(event.target.value)}
                      />
                    )}
                  </Field>
                </div>
              )}

              <Field
                label="Message to customers (optional)"
                hint="Shown on your public page while paused."
              >
                {({ id, ariaDescribedBy }) => (
                  <textarea
                    id={id}
                    className="textarea"
                    rows={3}
                    value={message}
                    maxLength={300}
                    aria-describedby={ariaDescribedBy}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                )}
              </Field>

              {mode === 'confirm' && (
                <Alert tone="warning" title="Pause bookings now?">
                  This immediately stops new bookings on your public page. Existing
                  bookings are not affected, and you can resume at any time.
                </Alert>
              )}

              <Box className="pause-actions__row" sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1 }}>
                {mode === 'confirm' ? (
                  <>
                    <Button
                      variant="contained"
                      color="warning"
                      onClick={confirmPause}
                      disabled={saving}
                      startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
                    >
                      Yes, pause bookings
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      onClick={() => setMode('edit')}
                    >
                      Keep editing
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="contained"
                      color="primary"
                      type="submit"
                      disabled={saving}
                      startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
                      sx={{
                        background: 'linear-gradient(98deg, #8C57FF 0%, #7E4EE6 100%)',
                        boxShadow: '0 4px 14px 0 rgba(140, 87, 255, 0.4)',
                      }}
                    >
                      Save pause
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      type="button"
                      onClick={() => setMode('view')}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </Box>
            </Box>
          </form>
        )}
      </CardContent>
    </Card>
  )
}