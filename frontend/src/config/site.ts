/**
 * Frontend site-level static configuration (Prompt 55).
 *
 * These values are presentational constants only — never booking, availability,
 * service, payment or identity data. The backend is the only authority for a
 * business's existence, profile, services, availability and deposits, so this
 * file contains no business, slug, phone, price or schedule values.
 *
 * There is deliberately no demo/home business slug here: the product defines no
 * marketing home page and no demo business (see
 * docs/WEREFA-COMPLETE-SPECIFICATION.md). A business page is reachable only at
 * the real `/p/:slug` the owner configured.
 */

/**
 * How many days (from today, inclusive) the date strip offers. The backend
 * decides what is actually bookable — a window date with no offered slots is
 * simply disabled. This is a UI sizing constant, not an availability engine.
 */
export const BOOKING_WINDOW_DAYS = 14
