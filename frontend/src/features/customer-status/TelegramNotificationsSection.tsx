import { useState } from 'react'
import type { CustomerTelegramNotificationView } from '@/types/models'
import { formatDateLong, formatTimestamp } from '@/lib/time'
import { formatTime } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { NOTIFICATION_TYPE_LABEL } from '@/features/customer-status/lib/notificationLabels'

interface TelegramNotificationsSectionProps {
  connected: boolean
  /** Customer-safe notification events across the customer's bookings, chronological. */
  notifications: readonly CustomerTelegramNotificationView[]
  onToggle: (connected: boolean) => Promise<void>
}

/**
 * Customer Telegram notification experience on the "Check my booking" results.
 *
 * The customer may optionally connect Telegram for their phone + this business
 * (canonical §18). When connected, booking events (proof received, confirmed,
 * rejected with reason, reminders, no-show, cancelled, rescheduled) are shown
 * here exactly as they would be delivered to the customer's Telegram account.
 *
 * This is a mock/demo experience: the toggle is labelled "(demo)" and performs
 * no real Telegram authorization. The status text ("Connected"/"Not connected")
 * is visible on its own — never by color alone. The list renders only the
 * customer-safe view (no booking IDs, no business slug, no phone, no delivery
 * internals).
 */
export function TelegramNotificationsSection({
  connected,
  notifications,
  onToggle,
}: TelegramNotificationsSectionProps) {
  const [busy, setBusy] = useState(false)

  const pageId = 'telegram-notifications-title'

  const handleToggle = async () => {
    setBusy(true)
    try {
      await onToggle(!connected)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="card card--padded telegram-panel"
      aria-labelledby={pageId}
    >
      <div className="telegram-panel__head">
        <div className="telegram-panel__head-text">
          <h2 id={pageId} className="telegram-panel__title">
            Telegram notifications
          </h2>
          <p className="telegram-panel__status">
            <span
              className="telegram-status"
              data-connected={connected ? 'true' : 'false'}
            >
              {connected ? 'Connected' : 'Not connected'}
            </span>
            <span className="sr-only" aria-live="polite">
              {connected
                ? 'Telegram is connected for this phone number.'
                : 'Telegram is not connected for this phone number.'}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleToggle()}
          loading={busy}
          disabled={busy}
          className="telegram-panel__toggle"
        >
          {connected ? 'Disconnect Telegram (demo)' : 'Connect Telegram (demo)'}
        </Button>
      </div>

      <p className="telegram-panel__note">
        {connected
          ? 'Booking updates, reminders and status changes for this phone number appear here as they are delivered to Telegram. This is a development preview — no real Telegram authorization happens.'
          : 'Connect to receive Telegram updates for bookings made with this phone number, such as confirmation, reminders, reschedules, no-shows, cancellations and rejection reasons. This is a development preview — no real Telegram authorization happens.'}
      </p>

      {connected && (
        <div className="telegram-panel__inbox" aria-live="polite">
          <h3 className="telegram-panel__inbox-title">Notification history</h3>
          {notifications.length === 0 ? (
            <p className="telegram-panel__empty">
              No Telegram notifications yet for this phone number.
            </p>
          ) : (
            <ol className="telegram-notices">
              {notifications.map((notice, index) => (
                <li key={`${notice.at}:${notice.type}:${index}`} className="telegram-notice">
                  <p className="telegram-notice__type">
                    {NOTIFICATION_TYPE_LABEL[notice.type]}
                  </p>
                  <p className="telegram-notice__message">{notice.message}</p>
                  {notice.type === 'payment-rejected' &&
                    notice.rejectionReason && (
                      <p className="telegram-notice__reason">
                        Reason: {notice.rejectionReason}
                      </p>
                    )}
                  {notice.type === 'reschedule' &&
                    notice.date &&
                    notice.time && (
                      <p className="telegram-notice__meta">
                        New appointment: {formatDateLong(notice.date)} at{' '}
                        {formatTime(notice.time)}
                      </p>
                    )}
                  <p className="telegram-notice__meta">
                    {formatTimestamp(notice.at)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}