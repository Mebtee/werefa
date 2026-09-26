/**
 * Frontend site-level static configuration (Prompt 55).
 *
 * These values are presentational / navigation defaults only — never booking,
 * availability, service or payment data. The backend is the only authority for
 * a business's existence, profile, services, availability and deposits; this
 * file deliberately lives OUTSIDE `@/mock/*` so production routes never import
 * the in-memory demo seam.
 */

/** The demo/home business the generic `/` redirect and not-found links point to. */
export const SITE_HOME_SLUG = 'addis-beauty-lounge'

/**
 * How many days (from today, inclusive) the date strip offers. The backend
 * decides what is actually bookable — a window date with no offered slots is
 * simply disabled. This is a UI sizing constant, not an availability engine.
 */
export const BOOKING_WINDOW_DAYS = 14

/** Fallback presentational deposit instructions when a business is not paying.
 *  Used only inside the payment step when the backend reports a deposit due;
 *  the deposit AMOUNT itself always comes from the backend availability view.
 */
export const PAYMENT_METHOD_FALLBACK = [
  {
    id: 'bank-transfer' as const,
    label: 'Bank transfer',
    steps: ['Transfer the deposit to the business bank account, then attach your proof of payment.'],
  },
  {
    id: 'telebirr' as const,
    label: 'Telebirr (mobile money)',
    steps: ['Send the deposit to the business via Telebirr, then attach your proof of payment.'],
  },
]