import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Reveal } from './Reveal'
import { SectionHeading } from './SectionHeading'

const FAQS = [
  {
    q: 'What is Werefa?',
    a: 'Werefa is a scheduling and queue management platform for service businesses. You publish your services and working hours, get one public booking link, and manage customer bookings from a business dashboard.',
  },
  {
    q: 'Who can use Werefa?',
    a: 'Business owners who run a service business and take bookings against their time. Werefa is business-agnostic — salons and barbers are one example, not the only one.',
  },
  {
    q: 'Do customers need a Werefa account?',
    a: 'No. Customers book and check their booking status without creating a Werefa account.',
  },
  {
    q: 'How do customers book?',
    a: "Through your business's public link or QR code. They choose a service, pick an available time, enter their details and submit a booking request.",
  },
  {
    q: 'Can I require prepayment?',
    a: 'Yes, when configured by the business owner. You decide whether prepayment is required and how it is configured.',
  },
  {
    q: 'Can customers pay online through Werefa?',
    a: 'Werefa does not process card payments automatically. When prepayment is required, the customer pays directly using the configured method — Bank Transfer or Telebirr / mobile money — and submits proof, which you review before confirming the booking.',
  },
  {
    q: 'Can customers use Telegram?',
    a: "Telegram is optional, and available when the platform's Telegram integration is configured and connected. Bookings work whether or not Telegram is enabled.",
  },
  {
    q: 'Can I pause my business?',
    a: 'Yes. You can temporarily pause new bookings — for example while you are away — and reopen when you are ready.',
  },
  {
    q: 'Can I change my working hours?',
    a: 'Yes, from your schedule controls, subject to the existing schedule behaviour.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — a 30-day free trial. Werefa then runs on a monthly subscription.',
  },
  {
    q: 'How do I start?',
    a: 'Create a business-owner account and configure your business, then share your public booking link.',
  },
] as const

/** Accessible FAQ accordion — native buttons with aria-expanded/aria-controls. */
export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section className="mkt-section" id="faq" aria-labelledby="mkt-faq-title">
      <div className="mkt-container mkt-faq">
        <Reveal className="mkt-faq__intro">
          <SectionHeading
            id="mkt-faq-title"
            eyebrow="FAQ"
            title="Questions, answered"
            lead="The things business owners ask before they start."
          />
        </Reveal>

        <div className="mkt-faq__list">
          {FAQS.map((item, index) => {
            const open = openIndex === index
            const panelId = `mkt-faq-panel-${index}`
            const buttonId = `mkt-faq-button-${index}`
            return (
              <Reveal className={cn('mkt-faq__item', open && 'mkt-faq__item--open')} key={item.q}>
                <h3 className="mkt-faq__question">
                  <button
                    type="button"
                    id={buttonId}
                    className="mkt-faq__trigger"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(open ? null : index)}
                  >
                    <span>{item.q}</span>
                    <span className="mkt-faq__marker" aria-hidden="true" />
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="mkt-faq__answer"
                  hidden={!open}
                >
                  <p>{item.a}</p>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
