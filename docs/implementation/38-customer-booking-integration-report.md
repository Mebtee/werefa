# 38 — Customer Booking Integration Verification & Regression Report (Prompt 55; spec §28–§31, §46; REQ-056, REQ-097, REQ-110, REQ-118–REQ-122, REQ-146–REQ-149, REQ-154, REQ-155, REQ-181, REQ-206, REQ-208, REQ-209, REQ-215, REQ-216)

> **Nature of this pass.** The customer-facing booking flow (wizard steps, date/time picker, deposit,
> payment receipt, done/Telegram link, status page) was already **fully wired to the real backend** in
> the working tree: every production component and hook calls typed API clients on the real routes and
> **no production module imports `@/mock/*`** for the booking flow. Prompt 55 was therefore executed as
> a **verification + gap-coverage pass**, not a rebuild: audit the real wiring end to end, close the
> remaining behavioural gaps with regression tests (public page states, booking conflict & idempotency,
> Customer Telegram connect states), run the full frontend + backend regression gate, and document the
> verified behaviour and its deliberate limits.

## 1. Objective

Verify and harden the customer booking integration against the real backend (spec §28–§31): a customer
pick a business, services, an available time, and a payment method; pay any required deposit; submit a
receipt/reference and land on the done step — all over the real API surface with no production mock
fallback (REQ-097, REQ-110, REQ-118–REQ-122, REQ-154). Cover the remaining behavioural edges with
deterministic tests: invalid/paused/deactivated/expired-subscription business pages, the recoverable
slot-lost race and the idempotent booking replay, and the Customer's Telegram connect states
(REQ-146–REQ-149, REQ-181, REQ-206, REQ-215, REQ-216). Then run the full regression gate and document
the results.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (re-hashed with `sha256sum` at
the end; unchanged).

## 4. Existing real customer-booking integration audited

Audited before changing anything:

- **Public business page + wizard:** `features/public-booking/PublicBookingPage.tsx`,
  `components/BookingWizard.tsx`, and the step components (`ServicesStep`, `DateTimeStep`,
  `ReviewStep`, `PaymentStep`, `DoneStep`, `ServicesReadOnly`) all source their input from the real API
  clients (`getPublicBusiness`, `getPublicServices`, `getAvailability`, `createCustomerBooking`,
  `publicTelegramDeepLink`). `ServicesReadOnly` renders services straight from `getPublicServices`.
- **Booking state machine:** `state/useBookingFlow.ts` talks to the real `booking.ts` + `availability.ts`
  clients; deposit display reads the backend-computed `requiredPrepaidMinor` from the availability
  projection (REQ-110/111), not a client re-derivation.
- **Business profile source:** `BusinessHero` renders the real public projection through
  `hybridizePublicBusiness`; `business.mapper.ts` overlays real authoritative profile fields
  (name/category/description/address/phone/pause) onto the mock-only UI fields.
- **Booking submission & reference-free handoff:** `booking.ts` `createCustomerBooking` POSTs the
  `{ businessSlug, serviceIds, date, startAt, paymentMethod, paymentSlot: 'onLocOrSlot'… }` payload and
  returns a **view + deletion key** (`VerifyCustomerBookingRequest`); no internal booking id is ever
  exposed to the customer (spec §31). `DoneStep` shows the reference-independent confirmation and the
  Telegram deep link from `telegram.ts`.
- **Customer Telegram connect:** `TelegramConnectCard` calls `publicTelegramDeepLink` (non-blocking;
  a failure never aborts the freshly confirmed booking).
- **Customer status page:** `BookingStatusPage` uses the real `getCustomerBookingsByPhone` +
  `getCustomerBooking` router. (The spec §46 item 2 “past-time rule” is a documented backend gap; the
  front-end mapper applies the presentation rule already — see §16.)
- **Backend gates (authoritative, not re-implemented here):** `backend/src/domain/services/booking.service.ts`
  rejects a booking for a **deactivated**, **paused**, or **subscription-expired** business with the
  standard error envelope (`BUSINESS_PAUSED` / `SUBSCRIPTION_EXPIRED`); `availability.service.ts`
  returns zero slots for paused/deactivated/expired so the date strip cannot offer booked times.
- **Public projection state flags:** the public business projection carries `isDeactivated` and
  `isPaused`; `hybridizePublicBusiness` maps `isPaused` into the UI `pause` state (the UI model has no
  `deactivated` field — the mock's subscription status was removed in Prompt 52).

## 5. Gaps identified

The real integration was in place; the missing pieces were **regression coverage** and two test-harness
realities:

1. **No coverage for the public page states** derived from backend gates (invalid slug; paused;
   deactivated; subscription-expired) — the wizard's degraded affordances were untested.
2. **No coverage for booking conflict (slot lost in a race) or idempotent replay** (REQ-121/122).
3. **No coverage for the Customer Telegram connect states** (already-connected phone; connect-call
   failure).
4. The test double could not model those states deterministically (it had no pause/deactivation seed,
   no visit-window pinning for races, and did not model backend branding metadata).
5. The full-gate run surfaced **two pre-existing regressions** that are within this slice's
   neighbourhood and were fixed here: the public page had stopped mapping the backend's `branding`
   projection (so the uploaded logo/cover no longer rendered — a regression from the real-API
   refactor), and two `availability.mapper` tests were midnight-flaky (a `now + 60 min` slot crossing
   local midnight was misread as today-past).

Behaviour decisions taken (production behaviour **unchanged**; tests now document it):
- **Invalid slug** → “Business not found” error state with a link back to the demo business.
- **Paused business** → `ServicesReadOnly` + hero unavailability notice, owner pause message, and
  reopening date where set (REQ-146/147/148); no wizard.
- **Deactivated business** (REQ-216, spec line 917: the page is always visible, bookings are gated) →
  page renders, wizard is present, but availability returns zero slots so every date chip is disabled.
- **Subscription-expired** → identical page-visible/wizard-blocked behaviour (the expiry is gated at
  booking creation, `SUBSCRIPTION_EXPIRED`).
- These three are asserted **without** asserting the `.alert__title` heading role: the `Alert` component
  renders its title as `div.alert__title` (not a heading), so tests use the visible text.

## 6. Files changed

| File | Change |
| --- | --- |
| `frontend/src/test/businessApi.ts` | Extend the test double: `BusinessApiSeedState` (`isPaused`, `pauseMessage`, `reopenAt`, `isDeactivated`, `bookingsClosed`, `telegramCustomerConnectedPhone`), `BusinessApiStubOptions` (`seed`, `raceStart: { date, time }`, `failPublicTelegramConnect`). Public availability returns zero slots when `bookingsClosed \|\| isPaused`; the create-booking route returns `409 BUSINESS_PAUSED` when `bookingsClosed`, uses `raceStart` (else the wall-clock `mockRaceSlot`); the Telegram connect route returns `500 SERVER_ERROR` under `failPublicTelegramConnect`. `publicViewOf`/`publicViewFromStore` now surface the store's uploaded branding through the real `branding` projection (models the backend's “media URLs once file storage lands” contract). |
| `frontend/src/features/public-booking/BookingFlow.test.tsx` | New suites (8 tests): “public business page states (Prompt 55)” (invalid slug; paused read-only + notice + reopening; deactivated visible-but-unbookable; expired-subscription visible-but-unbookable); “booking conflict & idempotency (Prompt 55)” (slot-lost recoverable state, nothing persisted; replay with a fixed `submissionKey` persists exactly one booking); “Customer Telegram connect states (Prompt 55)” (already-connected phone; connect-call failure degrades gracefully without touching the booking). Harness now installs the stub with `installStub(options)`; deterministic race via `freeWindowSlot()` + pinned `raceStart`. Store-count assertions are delta-based (the mock store is a shared singleton). |
| `frontend/src/api/business.mapper.ts` | `hybridizePublicBusiness` now maps `view.branding.logoUrl`/`coverUrl` into `logo`/`coverPhoto` (falling back to the mock page's values, then `null`). No behaviour change for current real backends (branding is always `null` there); it repairs the public rendering of owner-uploaded branding once the backend projects media URLs. |
| `frontend/src/api/types.ts` | Widen `PublicBusinessView.branding` to `{ logoUrl: string \| null; coverUrl: string \| null }` (matches the backend's documented media-URL contract / Swagger example; was over-constrained to literal `null`). |
| `frontend/src/api/availability.mapper.test.ts` | Pin the clock (`vi.setSystemTime`) to a local midday in the two today-relative tests so the ±1 h slots can never cross midnight — removes a midnight-only flake (the tests previously failed only when run after ~23:00 local). |
| `docs/implementation/38-customer-booking-integration-report.md` | This report. |

Uncommitted work from earlier prompts (Prompts 51–54 admin/business-registration files, `public-booking/*`
real-API wiring, `api/booking.ts`/`availability.ts`/`telegram.ts`/`business.ts` clients) is untouched by
this pass.

## 7. Public page states model (REQ-208/209/215/216)

The public page is the single source of product truth for booking availability: **the page is always
visible** for any validly-slugged business (spec line 917 — REQ-216), and bookings are gated at
creation by the backend (deactivated → `BUSINESS_PAUSED` guard, paused → `BUSINESS_PAUSED`,
subscription-expired → `SUBSCRIPTION_EXPIRED`). The client therefore cannot wedge a customer out of the
page; it can only refuse times. For a paused business the UX explicitly swaps the wizard for
`ServicesReadOnly` plus the hero unavailability notice, owner message, and reopening date (REQ-146–149),
which is the business's choice to stop taking bookings while keeping its catalogue public. For
deactivated or subscription-expired businesses the wizard stays rendered but every date chip is
disabled because `getAvailability` returns zero slots — the deterministic UI consequence of the same
service gate that refuses creation. Invalid slugs surface the dedicated “Business not found” state with
a recovery path to the demo business.

## 8. Booking conflict & idempotency model (REQ-121/122, §46)

Creation is a a single POST with the customer's chosen slot. When two shoppers race for the last free
slot, the loser receives the real `409`/`SLOT_UNAVAILABLE` and the wizard enters the recoverable
“That time just got taken” state with `Choose another time` / `Change services` actions; the failed
attempt persists nothing. Replays under the **same `submissionKey`** are idempotent: re-posting with a
pinned key yields the original confirmation view and creates only one booking row. The Deterministic
Race test uses a computed free day in the seeded window plus a pinned `raceStart` so it is immune to the
wall clock and to the salon's Monday closure. There is deliberately **no client-side slot lock or
expiry timer** (no TTL war between client and server); the server remains authoritative under
concurrency. The front-end mapper does apply the presentation rule that today's already-started slots
are not offered (spec §46 item 2’s backend gap is documented in §16).

## 9. Customer Telegram connect states (REQ-056, REQ-155, REQ-181)

`TelegramConnectCard` appears on `DoneStep` for unconnected customers and fetches a one-time deep link
from the real `publicTelegramDeepLink` route. An **already-connected** phone renders the connected state
with no link. A **failed** connect call is handled as non-blocking: the confirmation stays intact, a
graceful notice is shown, and the booking is untouched. Both states are now regression-covered.

## 10. Security / authorization

No new surface was added. Every request in the audited flow is authorized by the backend (HttpOnly
cookie for owner/admin routes; booking and Telegram routes are business-scoped and do not require runner
identity). The customer is only ever given the view + deletion-key projection — never an internal
booking id. No all-numeric account enumeration vector is introduced by the phone-based status lookup
beyond the documented `VERIFY` codes. The brand-new stub options only ever **simulate** backend error
paths in tests; production code paths do not branch on them.

## 11. Mock code in production paths

**None.** The audited booking flow (`PublicBookingPage`, `BookingWizard`, all steps, `useBookingFlow`,
`BusinessHero`, `TelegramConnectCard`, `BookingStatusPage`) calls the real typed clients only; no
production import under `src/features/public-booking/**` or the booking/availability/telegram/business
API modules touches `@/mock/*`. The test double (`src/test/businessApi.ts`) remains test-only. The two
known owner-portal files that still import `@/mock` (`state/useOwnedBusiness.ts`,
`features/owner-portal/pages/BusinessProfilePage.tsx`) are owner-side, outside this slice, and are
recorded as noted-limitation in §16.

## 12. Tests added / strengthened

- `BookingFlow.test.tsx` (+8): invalid-slug recovery; paused read-only page (notice, message, reopening
  date, no wizard); deactivated page visible with all date chips disabled; subscription-expired page
  visible but unbookable; slot-lost recoverable conflict with nothing persisted; idempotent replay for
  a fixed submission key (exactly one persisted booking); already-connected Telegram phone;
  connect-failure graceful degradation.
- `availability.mapper.test.ts` (2 tests re-hardened): midnight-flake elimination via pinned clock.
- Owner-logout/status regression restored via the `branding` mapping repair (the owner-portal branding
  test now asserts the uploaded logo/cover render on the public page through the real public
  client + `branding` projection again).

## 13. DB results

`npm run test:db` (real PostgreSQL 16, `RUN_DB_TESTS=true`): **346 passed / 22 files**, run **twice**
consecutively with identical results (no residue; the backend gate is idempotent). No backend source was
changed in this pass.

## 14. Frontend results

`npx vitest run`: **475 passed / 40 files** (461/38 at the previous checkpoint; +14 tests, +2 files,
including this pass's new suites and the earlier uncommitted customer-flow no-mock exposure tests).
`npm run typecheck`, `npm run lint` (`eslint .`), `npm run build`: PASS.

## 15. Browser-QA results or documented harness limitation

Not run. The repository has **no Playwright/Cypress/Puppeteer harness** (consistent with reports
#28–#38). No large browser framework was added for this prompt. Deterministic seam-level tests (real
route tree + guards + stubbed `fetch` round-tripping real wire contracts) were used instead; the
customer-facing pages are not mechanically browser-tested.

## 16. Known limitations / deferred work

- **No client-side slot lock / TTL.** The server stays authoritative under race; a slot is only
  consumed at create time. The spec §46 item 2 backend past-time rule is still deferred; the front-end
  already drops today's started slots (presentation rule in `availability.mapper.ts`).
- **Owner-portal `@/mock` imports** remain in `state/useOwnedBusiness.ts` and
  `features/owner-portal/pages/BusinessProfilePage.tsx` (owner-side; not in the booking flow; the
  analogous customer/admin flows are mock-free and covered by the `*NoMock` seam tests).
- **`branding` media URLs** are always `null` from the real backend until the file-storage service
  (Prompt 28) lands; the frontend now maps them when present, so uploaded branding will render on the
  public page without further changes. Owner upload remains an owner-side UX on the seam.
- **No browser harness** for the customer flow (see §15).
- Deferred/unchanged (Prompt 38 Item 6 dropped for good, agreed with the user): no phone normalization,
  no second scheduler.

## 17. Confirmation that no unresolved product decision was silently resolved

None. This pass exercised the already-chosen behaviours (paused = read-only page, deactivated/expired =
wizard-blocked-by-no-slots — both derived from the authoritative backend gates) and did not pick any
pending §46 UX. The spec item for the backend "past-time rule" was not re-implemented.

## 18. Confirmation that the specification was not modified

The canonical specification was read-only throughout; the final full SHA-256 equals the checkpoint
`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`. No secret or debug logging was
introduced in the changed files.

## 19. Confirmation that no commit was made

No `git add`/`commit`/`amend`/`push`/`reset` was run. Git history is untouched (`HEAD` still
`18b15bf`); all Prompts 51–55 changes remain uncommitted in the working tree.

---

## Regression gate summary

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `npm test` (no DB) | **178 passed / 224 skipped** (34 files: 26 passed, 8 skipped) |
| Backend | `npm run test:db` | **346 passed / 22 files** (run twice, identical) |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS (`--max-warnings=0`) |
| Backend | `npm run build` | PASS |
| Frontend | `npx vitest run` | **475 passed / 40 files** |
| Frontend | `npm run typecheck` | PASS |
| Frontend | `npm run lint` | PASS (`eslint .`) |
| Frontend | `npm run build` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged (`5494658e5…ff00b`) |

## Close

- Task type: **verification + regression-gap closure** over the already-real customer booking
  integration; no backend change; one production repair (branding mapping) restoring a regression from
  the real-API refactor.
- Gap closed: deterministic coverage for public page states (invalid/paused/deactivated/expired),
  slot-lost conflict + idempotent replay, and Customer Telegram connect states; a fully simulatable
  backend test double; a midnight-flake fix in the availability mapper tests.
- Production behaviour unchanged; the three page states are documented and enforced by the authoritative
  backend gates; no client-side booking lock.
- Deferred (unchanged): backend past-time rule (§46 item 2), owner portal `@/mock` leftovers, real file
  storage for brand media, browser harness.
- **NO COMMIT MADE.**