import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

interface RejectPaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  busy?: boolean
  initialReason?: string
}

const PRESET_REASONS = [
  { label: 'Invalid Reference ID', text: 'Invalid transaction reference code. Please check and provide the correct Telebirr / CBE transaction number.' },
  { label: 'Amount Mismatch', text: 'The deposited amount does not match the required booking deposit amount.' },
  { label: 'Unreadable Slip', text: 'The uploaded screenshot is blurry or unreadable. Please upload a clear receipt.' },
  { label: 'Reused Transaction', text: 'This transaction reference has already been used for another booking.' },
  { label: 'Wrong Account', text: 'The payment was not transferred to our designated business account.' },
]

export function RejectPaymentModal({
  isOpen,
  onClose,
  onConfirm,
  busy = false,
  initialReason = '',
}: RejectPaymentModalProps) {
  const [reason, setReason] = useState(initialReason)

  useEffect(() => {
    if (isOpen) {
      setReason(initialReason)
    }
  }, [isOpen, initialReason])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, busy, onClose])

  if (!isOpen) return null

  const handleSelectPreset = (text: string) => {
    setReason(text)
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim() || busy) return
    onConfirm(reason.trim())
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="reject-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
      >
        <div className="reject-modal-header">
          <div className="reject-modal-icon" aria-hidden="true">
            ⚠️
          </div>
          <div>
            <h2 id="reject-modal-title" className="reject-modal-title">
              Reject Payment Proof • የክፍያ ደረሰኝ ውድቅ ማድረጊያ
            </h2>
            <p className="reject-modal-desc">
              Please provide a clear reason for rejecting this deposit. The customer will see this message and can re-upload a valid proof.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: '6px' }}>
            Quick Reason Presets (ፈጣን ምክንያቶች):
          </span>
          <div className="reason-chips">
            {PRESET_REASONS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`reason-chip ${reason === preset.text ? 'is-active' : ''}`}
                onClick={() => handleSelectPreset(preset.text)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleFormSubmit}>
          <textarea
            className="input"
            rows={4}
            placeholder="Type reason here or pick a preset above (ለምሳሌ፡ የግብይት ቁጥሩ ትክክል አይደለም)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            autoFocus
            style={{ width: '100%', resize: 'vertical' }}
          />

          <div className="reject-modal-footer">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel • ተመለስ
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="btn--danger"
              loading={busy}
              disabled={!reason.trim() || busy}
            >
              Confirm Rejection • ውድቅ አድርግ
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
