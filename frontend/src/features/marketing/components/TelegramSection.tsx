import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'
import { ChatIcon, CheckCircleIcon } from './icons'

const POINTS = [
  'Customers can connect Telegram to receive booking-related notifications.',
  'Owners can connect Telegram for supported management and notification workflows.',
  'Telegram is optional — booking still works when it is not connected.',
] as const

/**
 * Telegram section. Telegram is optional and only active when the platform's
 * Telegram integration is configured and connected, so the copy never claims it
 * is universally available. No bot token, webhook or connection detail appears
 * here — only a static illustrative visual.
 */
export function TelegramSection() {
  return (
    <section className="mkt-section mkt-telegram" id="telegram" aria-labelledby="mkt-telegram-title">
      <div className="mkt-container mkt-telegram__inner">
        <Reveal className="mkt-telegram__copy">
          <SectionHeading
            id="mkt-telegram-title"
            eyebrow="Notifications"
            title="Stay in the loop with Telegram — when you want to"
            lead="When the Telegram channel is configured and connected, customers and owners can receive booking updates through Telegram."
          />

          <ul className="mkt-telegram__list">
            {POINTS.map((point) => (
              <li className="mkt-telegram__item" key={point}>
                <CheckCircleIcon className="mkt-telegram__check" />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <p className="mkt-telegram__note">
            Telegram availability depends on the platform's Telegram integration
            being configured for your deployment. Your booking link works either
            way.
          </p>
        </Reveal>

        <Reveal className="mkt-telegram__visual" delay={80}>
          <div className="mkt-illustrative-tag">Illustrative preview</div>
          <div className="mkt-telegram__card">
            <div className="mkt-telegram__card-head">
              <span className="mkt-telegram__avatar" aria-hidden="true">
                <ChatIcon />
              </span>
              <span>Telegram · booking updates</span>
            </div>
            <ul className="mkt-telegram__thread">
              <li className="mkt-telegram__bubble mkt-telegram__bubble--in">
                New booking request received
              </li>
              <li className="mkt-telegram__bubble mkt-telegram__bubble--in">
                Payment proof uploaded — ready for review
              </li>
              <li className="mkt-telegram__bubble mkt-telegram__bubble--out">
                Booking confirmed
              </li>
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
