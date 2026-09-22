# 31 — Owner Payment-Proof Review UI Integration Report (Prompt 51; REQ-114/115/118)

## 1. Scope

The **owner-facing payment-proof review surface** of the booking detail page is now served by the
real backend instead of `mockOwnerApi`. In this slice the owner can, for one booking:

- read the authoritative payment status and proof timeline from
  `GET /api/v1/owner/businesses/:businessId/bookings/:bookingId`;
- **download/view** each proof as an authenticated, tenant-scoped binary stream from
  `GET …/bookings/:bookingId/proofs/:proofId`;
- **Accept** a Payment Pending booking via `POST …/bookings/:bookingId/accept`;
- **Reject** with a required reason via `POST …/bookings/:bookingId/reject` (`{ reason }`);
- see the rejection reason recorded by the backend (read from the booking history);
- have the payment state refresh from the backend projection after every mutation.

The migration is intentionally surgical: only the payment-proof review region and the accept/reject
actions it owns moved to the real API client. Everything else on the page (booking list, chrome,
reschedule/cancel/no-show/release, Telegram, schedule-exception) remains on `mockOwnerApi`.

## 2. Out of scope (unchanged)

- Full owner booking-management migration; the owner bookings **list** read stays mock.
- Reschedule / cancel / No Show / release UI + API migration (kept on `mockOwnerApi` in this slice).
- Subscription/billing, Telegram delivery, external payment providers, PDF reporting.
- Customer payment/booking/status changes (regression-only).
- Prompt 38 Item 6 and unrelated refactors.
- No unresolved product decision was resolved (subscription price, global timezone identity,
  reminder lead-time default, owner booking-report PDF export, owner "modify" scope,
  timezone-abbreviation display rule).

## 3. Backend contract consumed (already built; not modified)

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/v1/owner/businesses/:businessId/bookings/:bookingId` | — | `OwnerBookingDetailView` (booking + payment + history + proofs) |
| POST | `…/bookings/:bookingId/accept` | — | `OwnerBookingDetailView` after `PAYMENT_PENDING → CONFIRMED` |
| POST | `…/bookings/:bookingId/reject` | JSON `{ reason }` | `OwnerBookingDetailView` after `PAYMENT_PENDING → REJECTED` |
| GET | `…/bookings/:bookingId/proofs/:proofId` | — | binary proof stream, `Content-Disposition: attachment` |

`reason` is required (REQ-118); the backend returns `400 VALIDATION_ERROR` without it and
`409 INVALID_TRANSITION`/`PAYMENT_PENDING` when the booking is not reviewable. Proofs are
tenant-guarded and additionally scoped to the owning booking; unknown/cross-tenant ids return 404.
No backend file was changed in this prompt — the endpoints and projections shipped in Prompt 50.

## 4. Wire types (`frontend/src/api/types.ts`)

Added `OwnerPaymentView`, `OwnerBookingComponentView`, `OwnerBookingView`,
`OwnerBookingHistoryView`, `OwnerBookingProofView`, `OwnerBookingDetailView`, and
`OwnerBookingRejectInput`. Field names mirror the backend projections (`bookingId`, `status`,
`payment.status`, `proofs[].proofId/fileName/mimeType/sizeBytes/replaced`, `history[].toStatus/reason`)
so no translation invents data the backend did not send.

## 5. API client (`frontend/src/api/ownerBookings.ts`, new)

- `getOwnerBookingDetail(businessId, bookingId, signal?)`
- `acceptOwnerBooking(businessId, bookingId, signal?)`
- `rejectOwnerBooking(businessId, bookingId, reason, signal?)` → JSON `{ reason }`
- `downloadOwnerBookingProof(businessId, bookingId, proofId, signal?)` → `{ blob, fileName, contentType }`

All paths are owner-scoped by `businessId`, so a proof can never be requested across businesses.
The client only sends ids/values; it never derives prices, durations or statuses.

## 6. Binary download support (`frontend/src/api/http.ts`)

Added `apiDownload(path, options)` plus `fileNameFromContentDisposition` (RFC 5987 `filename*=`
preferred, `filename="…"` fallback). It sends the session cookie, parses a JSON error envelope into
`ApiError` on failure, and returns the raw `Blob` on success. The existing `apiRequest` JSON path is
untouched.

## 7. UI integration (`BookingDetailPage.tsx`)

- New `usePaymentReview(businessId, bookingId)` controller (`state/usePaymentReview.ts`) loads the
  real detail, exposes `review/loading/error/reviewing/actionError`, and implements
  `accept/reject/download`. Mutations refresh the view from the backend projection.
- The **Payment** section now renders the real payment status chip, the real proof timeline
  (filename/size/MIME, a “Replaced” badge, a **Download proof** action), and the real rejection
  reason. The previous “Preview only — no download in this slice” mock card is gone.
- Accept/Reject call the real client. A missing reason is blocked client-side (no request is sent);
  backend validation/conflict errors are surfaced via the shared `toUserMessage` mapping.
- Loading, unavailable and error states are explicit; when the review cannot be loaded the mock
  proof metadata is **not** shown (no mock leakage).

## 8. Payment-status mapping (`features/owner-portal/lib/paymentReview.ts`, new)

Maps the owner wire codes into the UI models while keeping the two backend values separate:
`PAYMENT_PENDING → 'payment-pending'`, `CONFIRMED → 'confirmed'`, etc.; `PENDING/ACCEPTED/REJECTED →
'pending'/'accepted'/'rejected'`. The rejection reason is read from the latest `REJECTED` history
entry — the authoritative place the backend records it — rather than a duplicated field.

## 9. Booking status vs payment status

The review view model carries `bookingStatus` and `paymentStatus` as independent values and never
derives one from the other (REQ-100 vs REQ-101). Gating of the Accept/Reject UI continues to use the
booking state; the payment section reports the payment state. The header booking-state display and
the mock-only sections are unchanged.

## 10. Loading / empty / success

- Load failure → an `Alert` titled “Could not load the payment proof” with a safe message.
- No proofs → “No payment proof was submitted.”; loading → “Loading the payment proof…”.
- Success → the proof timeline renders the backend filename/size/MIME; after accept/reject the
  booking reloads and the review refreshes from the returned projection.

## 11. Error handling & messages

`toUserMessage` maps kinds: network, 401 (global handler), 403 forbidden, 404 not-found, 409
conflict (backend detail shown), 429 rate-limited, 5xx server, and validation detail. Tests cover
500 (safe server message), 409 accept conflict (message shown, booking stays Payment Pending) and
404 (message shown, no mock proof rendered).

## 12. Concurrency / duplicate submission

Accept/Reject buttons use the shared busy flag (`busy || reviewing`) and an entry guard, so a rapid
double click cannot fire two mutations. The backend remains the transaction authority; the UI does
not assume the new state locally — it re-reads the returned projection.

## 13. Test double (`frontend/src/test/businessApi.ts`)

The render-test double now serves the owner booking routes from the shared mock store (so real
client code is exercised): detail projection, accept/reject routed through the store's
`acceptBooking`/`rejectBooking`, and a binary proof response with attachment headers. A new
`failOwnerBookingRequest({ method, path })` option injects 403/404/409/5xx for error-path tests.
`renderAppAt` (in `test/auth.tsx`) now also returns the installed `stub` and accepts `businessApi`
options, so tests can assert the exact requests made.

## 14. Tests added

- `api/ownerBookings.test.ts` (7 cases): detail GET path; cross-tenant 404 → `ApiError`; accept POST
  path; reject POST JSON body; invalid-transition 409 mapping; binary download blob + filename;
  `fileNameFromContentDisposition`.
- `features/owner-portal/PaymentProofReview.test.tsx` (8 cases): proof loads from the real endpoint;
  accept hits the real route and never the mock owner API; reject posts the reason; no request
  without a reason; proof download through the real route (blob saved); 500 safe message; 409
  conflict keeps the booking Payment Pending; 404 shows the safe message with no mock proof leakage.
- `test/ownerProofNoMock.test.ts` (4 source-boundary cases): the client speaks the real owner routes
  and never the mock seam; `http.ts` exposes the authenticated binary download; the controller/mapper
  never import `@/mock/*`; the detail page no longer accept/rejects via `mockOwnerApi` and no longer
  renders the mock proof card.

## 15. No-mock boundary assurance

`PaymentProofReview.test.tsx` asserts against `stub.calls` (the real `/api/v1/owner/...` requests)
and spies on `mockOwnerApi.acceptBooking` to prove the migrated surface does not fall back to the
mock owner API; its 404 case asserts the mock proof filename is not rendered.
`test/ownerProofNoMock.test.ts` adds static source-boundary checks so a future regression that
re-imports the mock seam into the review path fails fast.

## 16. Verification results (final, run locally)

| Layer | Command | Result |
|---|---|---|
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm test` (no DB) | 142 passed / 184 skipped (21 files passed, 6 skipped) |
| Backend | `npm run test:db` (live Postgres) | **273 passed (16 files)** |
| Frontend | `npx vitest run` | **418 passed / 34 files** (parallel + `--fileParallelism=false` serial) |
| Frontend | `npx tsc -b --pretty false` | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` | PASS (`tsc -b && vite build`) |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged — blob `acb32c9b4defc6662fed8883af912ac4ea295021` = `git rev-parse HEAD:` blob |

## 17. Spec integrity

`git hash-object docs/WEREFA-COMPLETE-SPECIFICATION.md` = `acb32c9b4defc6662fed8883af912ac4ea295021`,
identical to the HEAD blob. The canonical specification was not edited.

## 18. Files changed

New: `frontend/src/api/ownerBookings.ts`, `frontend/src/api/ownerBookings.test.ts`,
`frontend/src/features/owner-portal/state/usePaymentReview.ts`,
`frontend/src/features/owner-portal/lib/paymentReview.ts`,
`frontend/src/features/owner-portal/PaymentProofReview.test.tsx`, `frontend/src/test/ownerProofNoMock.test.ts`.
Modified: `frontend/src/api/http.ts`, `frontend/src/api/types.ts`,
`frontend/src/features/owner-portal/pages/BookingDetailPage.tsx`, `frontend/src/test/auth.tsx`,
`frontend/src/test/businessApi.ts`.

## 19. Security review

- Proof download is authenticated (`credentials: 'include'`) and owner-scoped by `businessId`;
  cross-tenant/unknown ids yield 404 (covered by client + backend tests).
- Backend responses set attachment + `nosniff` (Prompt 50); the client stores raw bytes only.
- No secret/credential handling added; no raw backend internals rendered — errors pass through
  `toUserMessage`.

## 20. Requirement traceability

- **REQ-114/115** (owner proof review + download): real detail timeline + streaming download route.
- **REQ-118** (rejection requires a reason): client blocks empty reasons; backend `400` enforced;
  reason read back from history.
- **REQ-100/101** (payment status vs booking state): carried as separate independent values.
- **REQ-121** (idempotency/duplicate submission): entry guard + busy flag prevent double mutations.

## 21. Deferred / known limitations

- **Owner bookings list is still mock.** The real owner endpoints are keyed by the owner booking id
  on the real backend (numeric). Because the list read is not migrated in this prompt, the review
  resolves real bookings only once the route id exists on the backend; the test double bridges the
  mock-store ids for tests/dev. End-to-end owner review against a live backend therefore depends on
  the deferred owner-list migration (mirrors the Prompt 50 deferral).
- Reschedule/cancel/No Show/release and the Telegram/schedule-exception sections remain mock.
- Telegram/notification delivery remains out of scope.

## 22. Unresolved product decisions

None of the listed unresolved decisions were touched or implicitly resolved.

## 23. Browser QA

Not run — no browser/e2e tooling (Playwright/Cypress) exists in this repository. The deterministic
plan is covered at the seam level by `PaymentProofReview.test.tsx`, `ownerBookings.test.ts`, and the
existing owner-portal suite.

## 24. Final status

- Implemented and verified: real owner payment-proof detail read, download/view, accept, reject with
  reason, rejection-reason read-back, payment-state refresh, loading/error/success, auth + tenant
  isolation, and no-mock boundary tests for the migrated surface.
- Backend and frontend command chains are green; the canonical spec is unchanged.
- **No commit was made** (task rule). **Prompt 52 was not started.**
