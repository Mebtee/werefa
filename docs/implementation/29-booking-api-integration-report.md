# 29 — Booking API Integration Report (Prompt 49; REQ-053/058/070/074/109/121)

## Scope

Customer booking creation and status lookup become real API paths end to end. The backend
adds `POST /api/v1/customer/bookings` (multi-service `selections` + a client `submissionKey`
for idempotency) and `GET /api/v1/customer/status?slug=…&phone=…` (customer-safe status
projection). Booking **submission** no longer runs through `@/mock/api.ts`; the wizard sends
only selections and the preferred start instant, and the backend derives duration/price and
snapshots every component (REQ-070/074). Proof upload stays client-side display-only — it is
not transmitted on the wire. File upload/porch/owner-subscription and Telegram notifications
remain out of scope (documented deferrals). The status page is migrated to the real customer
status endpoint and intentionally renders the **honest real-status card** (date/time + state
only) — no customer name, line items, payment internals, or Telegram panel, matching the
REQ-109 projection.

## Verification results (final, run locally)

| Layer | Command | Result |
|---|---|---|
| Backend | `npm run build` | PASS |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm test` (no DB) | 127 passed / 178 skipped (DB suites self-skip w/o `RUN_DB_TESTS`) |
| Backend | `npm run db:up && npm run db:provision && npm run test:db` | **252 passed (14 files)** — live Postgres, 4 consecutive clean runs incl. the concurrency cases |
| Frontend | `npx vitest run` | **384 passed / 30 files, exit 0** (3 consecutive clean full runs at close) |
| Frontend | `npx tsc -b --pretty false` | PASS |
| Frontend | `npm run lint` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged — working tree hash `acb32c9b…` equals `git show HEAD:` hash |

## What changed

### Backend
- `payloads.ts` — `CreateBookingSelectionBody` (`serviceId` UUID, optional `variationId` UUID,
  optional `addOnIds` UUID[] `@ArrayMaxSize(5)`); `CreateBookingPayload` `selections` is now
  `@ArrayMinSize(1)`/`@ArrayMaxSize(8)`, `@ValidateNested({ each: true })` + `@Type`
  (replaces the singular `services[]`).
- `customer.controller.ts` — maps each wire selection (`variationId` singular → backend
  `variationIds`).
- `booking.service.ts` — `createBooking` rewritten: `validateCombinations` resolves the
  business + active catalog and snapshots every component; idempotent `submissionKey` fast-path
  pre-check outside the tx, re-checked **inside** the `withBusinessAdvisoryLock` tx; a replayed
  key whose request is materially different (different `startAt` or component signature in
  catalog order) → `idempotencyConflict` 409 CONFLICT (same-key concurrent requests both 201);
  P2002 on `submission_key` re-reads the winner in tx → idempotent 201. New helpers:
  `idempotentRef`, `resolveIdempotent`, `bookingDiffers`, `componentSignature` and a
  `ComponentSnapshot` type.
- `payment.repository.port.ts` + `prisma-payment.repository.ts` — `findBySubmissionKey` gains
  an optional `tx` handle so the in-tx re-check is consistent with the advisory lock.
- `http-api.db.spec.ts` — `CREATE_BODY` switched to the `selections` shape (`selection()`
  helper). New cases: multi-service booking (Deep Clean + Deluxe at 2026-11-21T09:00 →
  totals 20500, end 10:55, owner list/detail cross-check), same-key + different request →
  409 CONFLICT, malformed bodies → 400 VALIDATION_ERROR envelope, cross-tenant service → 400
  VALIDATION_ERROR, POST-availability unknown service uncovered an existing-test regression
  (restored the accidentally-deleted test). New `describe` for real-Postgres concurrency
  (REQ-121): same key → [201, 201] same `bookingId`; different keys same slot → [201, 409]
  `SLOT_UNAVAILABLE` (first wins).
- `domain-services.db.spec.ts` — `makeBooking` updated to the `selections` shape.
- Mid-work correction: `CustomerBookingView` carries no `bookingId` — DB assertions resolve the
  created id from the owner list/detail instead; arithmetic verified at 20500 / 10:55 AM.

### Frontend
- `api/types.ts` — `CreateCustomerBookingSelectionInput`, `CreateCustomerBookingInput`,
  `CustomerBookingView`, `CustomerStatusEntryView`, `CustomerStatusView`.
- `api/booking.ts` (new) — `createCustomerBooking(payload, signal?)` → `POST /customer/bookings`;
  `getCustomerBookingStatus(slug, phone, signal?)` → `GET /customer/status` with `slug`/`phone`
  query params.
- `api/booking.mapper.ts` (new) — `bookingStateFromWire` (status → `ClientBookingState`),
  `createdResultFromView` (create → `SubmitResult`; `awaiting-verification` →
  `{ status: 'created', disposition: 'payment-pending' }`), `statusEntriesFromView` (wire
  `{ startAt, endAt, status }` → `CustomerBookingStatusEntry[]`).
- `types/models.ts` — `CustomerBookingStatusEntry { startAt, endAt, bookingState }`.
- `useBookingFlow.ts` — submit now takes **no arguments**: it builds wire `selections`
  (`variationId ?? undefined`, `addOnIds` only when non-empty), `startAt = new Date(
  \`${date}T${time}:00\`).toISOString()`, `paymentMethod` mapped
  (`bank-transfer→BANK_TRANSFER`, `telebirr→TELEBIRR_MOBILE_MONEY`). One stable `submissionKey`
  per wizard session (`useRef` + `crypto.randomUUID()` fallback via `newSubmissionKey()`),
  regenerated only on `reset()`. Network/validation errors → `{ status: 'error' }`;
  `SLOT_UNAVAILABLE` → `{ status: 'unavailable' }`. `BookingDraft`, `mockApi`, and the
  now-unused `Service` catalog param are gone.
- `BookingWizard.tsx` — `flow.submit()` called on Continue-to-payment, service-review Continue
  and the confirm button (mechanical call-site change; `duration` still used for copy/deposit).
- `BookingStatusPage.tsx` — rewritten for the real path: loads the business via
  `getPublicBusiness` + `hybridizePublicBusiness` (mock `getBusinessPage` fallback for the
  hybrid demo), status via `getCustomerBookingStatus` + `statusEntriesFromView`, lookup phases
  idle/loading/results/error, phone validation, count summary, and a footer honest about the
  preview build. Telegram panel and rich-card fields removed.
- `BookingStatusCard.tsx` — honest card: `Booking on {formatDateTime(startAt)}` + one state
  chip (`BOOKING_STATE_LABEL`) + a plain-language explanation.
- `PublicBookingPage.tsx` — footer now says booking requests are stored by the real backing
  service.
- `test/businessApi.ts` — `POST /customer/bookings`: envelope + service gating against the
  business's active catalog (`computeAppointmentTotals`), derived duration/price, first-wins
  via `getOccupiedBlocks`/`computeAvailableTimes` + `mockRaceSlot`, and an `idempotentKeys`
  replay map (same key + same slug/start/signature → replay identical response; different →
  CONFLICT). `GET /customer/status`: 404 on unknown slug, newest-first entries
  (`startAt`/`endAt`/`status`; `payment-pending` → wire `awaiting-verification`).
- Tests: `BookingStatus.test.tsx` rewritten for the honest card (date/time + state only; no
  name/services/payment/Telegram on the page; newest-first order; cross-business separation;
  no-match retry; count; query routed to the real endpoint with encoded phone). `BookingFlow
  .test.tsx` gained a boundary assertion on the exact wire request (`selections[0].serviceId`,
  `startAt`/`submissionKey` strings, `businessSlug='addis-beauty-lounge'`,
  `customerName='Selam Tesfaye'`, `customerPhone='+251911123456'`,
  `paymentMethod='BANK_TRANSFER'`). New `api/booking.test.ts` (client contract: method, URL,
  `credentials: 'include'`, CONFLICT → conflict ApiError, query encoding; mapper statuses and
  order). `servicesNoMock.test.ts` now asserts the hook submits through `@/api/booking` with
  no `@/mock`.

## Seam audit

- **HTTP+DB seam (http-api.db.spec.ts, RUN_DB_TESTS-gated)** — 252/252 across 14 files on
  live Postgres, including real concurrency: the submission-key idempotency ([201, 201] with
  one booking) and slot first-wins ([201, 409]). Cross-tenant service injection, malformed
  bodies and same-key-different-request all assert the wire envelope.
- **Backend domain** — `booking.service` reuses `validateCombinations` for backend-truth
  duration/price (client sends no computed numbers).
- **Frontend fetch seam** — wizard and status page go through `api/booking.ts` only;
  `test/businessApi.ts` implements the same wire contract (including the idempotency replay
  map) for render tests, and still reads the shared mock store so the seeded/live-store
  lifecycle tests keep working.
- **Remaining mock seams (documented)** — proof file upload is display-only (never sent);
  Telegram notifications and the owner subscription remain out of scope.

## Req trace

- REQ-121 (idempotent submission): `submissionKey` pre-check + in-tx re-check, differing
  request → 409 CONFLICT, concurrent same key → single booking; enforced in unit + DB tests.
- REQ-070/074 (multi-service, server-derived totals, snapshots): `selections` wire payload,
  `validateCombinations`, component snapshots.
- REQ-053/058/109 (customer-safe status, phone-scoped, newest-first, no internal ids/payment
  details exposed): status endpoint + honest status card.

## Notes / knowns

- **Honest status card (user decision):** the status page shows real state (date/time + one
  chip). Customer name, line items, payment chip, rejection reason and the Telegram panel are
  intentionally not rendered there; `TelegramNotificationsSection` and its mock affordances
  remain in the repo for a future prompt.
- **Submission-key design:** keys are never server-issued; a same-key request that is
  materially different (different `startAt` or component set/signature) is a customer error →
  CONFLICT, not a silent replay.
- **Browser QA not run** — no Playwright/Cypress tooling exists in this repo; the deterministic
  browser-QA plan is preserved and covered at the seam level by `BookingFlow.test.tsx` and
  `BookingStatus.test.tsx`.
- No commit was made (task rule: do not commit without explicit request). Working tree carries
  the accumulated prompts #25–#49 working set only.

## Close

- Repo status = expected working set only (Spec/architecture docs unchanged — spec tree hash
  `acb32c9b…` identical to HEAD; stray `backend/nul` artifact removed). NO commit made.
- Green command chain (all local, exit 0):
  backend `npm run build && npm run typecheck && npm run lint && npm test` and
  `npm run db:up && npm run db:provision && npm run test:db` (×4 consecutive, 252 passed);
  frontend `npx vitest run` (×3 consecutive, 384 passed) `&& npx tsc -b --pretty false &&
  npm run lint`.