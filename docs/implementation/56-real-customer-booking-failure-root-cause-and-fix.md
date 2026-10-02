# Implementation 56 — Real customer booking failure: root cause and fix

Date: 2026-10-01
Scope: `/p/tame-hair-studio` real customer booking failing at final submission ("Something went wrong" / "Booking not sent" / "Your booking request could not be sent. Please try again.")

---

## 1. RESULT

**PASS.**

The failure was reproduced against the real running stack (Vite :5173 + NestJS :3000 + Postgres `werefa-db-dev` :5433), traced end-to-end, and fixed with the smallest demonstrated change. Real-browser verification of the fixed flow passed 14/14 checks (including a real 201 `awaiting-verification` booking through the real backend). All gates pass. No commit made.

## 2. EXACT ROOT CAUSE

Two stacked frontend defects — the backend behaved correctly throughout:

1. **Client-side phone validation did not match the backend contract.**
   `frontend/src/lib/validation.ts` used `PHONE_PATTERN = /^\+?[0-9][0-9\s()-]{6,15}$/`, which accepts any 7–16 character digit string with separators (e.g. `09112233445`, `+25191122334`, `091122334`). The backend's `CreateBookingPayload.customerPhone` is `@IsPhoneNumber('ET')` (libphonenumber), which rejects those. A customer who typed a wrong-length (but plausible-looking) Ethiopian number passed the `CustomerStep` gate, reached review/payment, completed the whole payment + proof upload flow, submitted — and the real backend answered **400 `VALIDATION_ERROR` with `fields.customerPhone = "customerPhone must be a valid phone number"`**. The failure surfaced only at the very last step, after the customer had done everything right from their point of view.

2. **The submit error path collapsed every non-conflict failure into an opaque generic state.**
   `useBookingFlow.submit()` caught the `ApiError` and, for anything that was not `SLOT_UNAVAILABLE`, set `{ status: 'error' }` with no message; `DoneStep` rendered the fixed copy "Booking not sent / Your booking request could not be sent. Please try again." The backend's honest, safe field error was discarded, even though `toUserMessage`/`toFieldErrors` already existed in `frontend/src/api/errors.ts` for exactly this purpose.

Evidence of defect 1 in the production log: the real browser generated 13 `POST /api/v1/customer/bookings` calls in `.run/backend.log`, several answered **400 VALIDATION_ERROR, response content-length exactly 135 bytes** — the unique byte-length of `{"error":{"code":"VALIDATION_ERROR","title":"Invalid request","fields":{"customerPhone":"customerPhone must be a valid phone number"}}}`. Probes confirmed every other 400 body differs in length.

## 3. REPRODUCTION

- URL: `http://localhost:5173/p/tame-hair-studio`
- Flow: select real service "hair cut" (id `21834f42-602e-4a09-8894-4469f6162bb6`) → pick a real available date/time (e.g. 2026-10-02 12:00) → enter name + a wrong-length phone such as `09112233445` → review → payment (deposit ETB 100.00) → attach proof → **Confirm & send**.
- Request: `POST http://localhost:3000/api/v1/customer/bookings` (multipart: `payload` text + `proof` file), `X-Request-Id` present.
- Status: **400**
- Body: `{"error":{"code":"VALIDATION_ERROR","title":"Invalid request","fields":{"customerPhone":"customerPhone must be a valid phone number"}}}`
- Before the fix the UI showed only: "Something went wrong" / "Booking not sent" / "Your booking request could not be sent. Please try again."
- Reproduced both by direct HTTP probes with exactly this phone shape and by headless-Chrome runs of the real UI (13 browser POSTs in the backend log, several 400s).

## 4. BACKEND FINDING

The backend is correct and was not modified:

- DTO (`backend/src/api/dto/payloads.ts`): `customerPhone` carries `@IsPhoneNumber('ET')`.
- Probes against the real backend: `+251911223344`, `0911223344`, `251911223344`, `+251 91 122 3344`, `0911-223-344`, `911223344` all pass validation (they proceed to slot handling); `09112233445`, `+25191122334`, `091122334` are rejected 400 `customerPhone`. This is the authoritative ET rule.
- With a valid phone and valid proof, the real endpoint returns **201 `awaiting-verification`** with `prepaidMinor: 10000` — the full real lifecycle works.
- Missing proof with a FIXED deposit correctly answers 400 `fields.proof = "A proof file is required."` (REQ-117/118 rule, not a bug).
- No 500/INTERNAL_ERROR anywhere in the log; only 400s (validation), 401s (unauthenticated probes) and 409s (genuine slot conflicts) occurred.

## 5. FRONTEND FINDING

- `frontend/src/lib/validation.ts` — loose `PHONE_PATTERN` (defect 1 above). Also used by `BookingStatusPage` and `TelegramConnectCard` for the same REQ-054 purpose.
- `frontend/src/features/public-booking/state/useBookingFlow.ts` `submit()` — catch-all `setResult({ status: 'error' })` discarding the `ApiError` (defect 2 above).
- `frontend/src/features/public-booking/components/steps/DoneStep.tsx` — rendered the fixed generic copy for `status === 'error'`.
- Everything else in the request path was verified correct: base URL resolution (`resolveApiBaseUrl`), endpoint `POST /customer/bookings`, multipart contract (`payload` JSON text + `proof` file), `Content-Type` left to the FormData boundary, `X-Request-Id` header, idempotency `submissionKey` (stable per wizard session, regenerated on reset), `startAt` built as `new Date(\`${date}T${time}:00\`).toISOString()` (the system's single fixed timezone; no rollover), payment method mapping `telebirr → TELEBIRR_MOBILE_MONEY`, else `BANK_TRANSFER`, proof only attached when a deposit is due.

## 6. DATABASE FINDING

Real database state for `tame-hair-studio` (id `63101fa0-2ad0-4e48-90c5-702f86e4c1f0`, category `SALON_AND_BARBER`) is internally consistent; nothing to fix:

- Business active, not deactivated, not paused; active schedule version exists.
- Service "hair cut": active, belongs to the business, `base_price_minor 20000`, duration 39 min (valid, above the 15-minute floor).
- `business_settings`: `booking_interval 60`, **`prepayment_mode FIXED`, `prepayment_fixed_minor 10000`**, percent null (tuple valid), drives `requiredPrepaidMinor 10000` / "Deposit required ETB 100.00".
- Subscription: TRIAL, ends 2026-10-27, grace to 2026-10-30 → booking allowed.
- `POST /api/v1/public/businesses/tame-hair-studio/availability` answers 200 with `computedTotalPriceMinor 20000`, `requiredPrepaidMinor 10000` and 8 real slots.
- No fake business/service/booking data was seeded anywhere.

## 7. FIX IMPLEMENTED

Smallest change that addresses the demonstrated defects; no API, DTO, backend, or workflow change:

1. `frontend/src/lib/validation.ts` — `PHONE_PATTERN` is now `/^(?:\+251|251|0)?[1-9]\d{8}$/` applied after stripping spaces/hyphens/parentheses: the ET national number is 9 digits starting non-zero, optionally prefixed `+251` / `251` / `0`. This matches every probe result the real backend accepted/rejected. `normalizePhoneForMatch` is unchanged (digits-only matching behavior preserved).
2. `frontend/src/types/models.ts` — `SubmitResult`'s error variant became `{ status: 'error'; message: string }` so a failure carries a real, safe message.
3. `frontend/src/features/public-booking/state/useBookingFlow.ts` — new `submitFailureMessage(error)` maps a validation `ApiError`'s booking fields (`customerPhone`, `customerName`, `proof`, `startAt`/`selections`) to actionable customer-facing copy and otherwise delegates to the existing `toUserMessage` (never raw internals). `submit()` now sets `{ status: 'error', message }` for non-conflict failures.
4. `frontend/src/features/public-booking/components/steps/DoneStep.tsx` — the danger alert now renders `result.message` instead of the fixed generic sentence.

## 8. WHY THE FIX IS SAFE

- Client-side only; the backend's `@IsPhoneNumber('ET')` remains authoritative and untouched — the client check is a courtesy gate, not a trust boundary.
- The new pattern is strictly derived from the backend's observed accept/reject behavior (every probe result) — no valid form was removed: `+2519…`, `2519…`, `09…`, bare `9…`, with separators, all still pass, as do all existing test phones in the repo.
- No validation or authorization was weakened; the booking API, its contract, and the prepayment workflow are unchanged. Slot conflict handling (`SLOT_UNAVAILABLE` → "That time just got taken") is preserved first in the catch chain.
- Error messages remain safe by construction: only curated sentences; backend field text, codes, stack traces, SQL, paths, tokens are never rendered (asserted by a test).
- The demo/mock path is untouched; no fixtures added to runtime code.

## 9. PREPAYMENT BEHAVIOR VERIFIED

This business has **prepayment_mode FIXED, 10000 minor (ETB 100.00)**; percent is null, so the settings tuple is consistent. The canonical flow was verified end-to-end on the real system and is unchanged:

availability discloses `requiredPrepaidMinor 10000` → review shows "Deposit required ETB 100.00" → payment step requires method + proof (client guard stays on the payment step with "Choose a payment method. Attach your payment proof." when missing) → booking POST with proof → **201 PAYMENT_PENDING (customer label `awaiting-verification`)** → owner review. Prepayment NONE businesses would skip the proof requirement per the existing `requiresPayment = (depositMinor ?? 0) > 0` logic; nothing about that was altered.

## 10. CONCURRENCY / IDEMPOTENCY VERIFIED

Unmodified and re-verified:

- Per-business PostgreSQL advisory lock, in-transaction availability recheck, exact slot identity protection, bounded retry, and the 409 `SLOT_UNAVAILABLE` conflict response are all intact (backend DB suites pass, including the concurrency specs).
- Real-browser check: submitting against a genuinely taken slot yields the honest "That time just got taken" recoverable state — never a fake success.
- Idempotency: `submissionKey` is generated once per wizard session (`crypto.randomUUID`), retried submits reuse it, and it is regenerated only on reset. The double's first-wins replay semantics and the backend REQ-121 behavior are covered by "replays the original booking for a repeated submission key" (passing). A legitimate first submission cannot collide: keys are UUIDs scoped by the backend to business + payload signature.

## 11. TEST RESULTS

| Gate | Result |
| --- | --- |
| Backend `npm test` | PASS — 199 passed / 264 skipped (463) |
| DB run 1 `npm run test:db` | PASS — 405 passed (29 files) |
| DB run 2 `npm run test:db` | PASS — 405 passed (29 files) |
| Frontend `npm test` | PASS — 550 passed / 50 files (546 before + 4 new: 2 ET-pattern parity tests in `validation.test.ts`, 2 flow regression tests in `BookingFlow.test.tsx`) |
| Backend typecheck / lint / build | PASS / PASS / PASS |
| Frontend typecheck / lint / build | PASS / PASS / PASS |
| `npm run acceptance` | PASS — full gate incl. spec hash + all release gates |
| `npm run acceptance:static` | PASS — spec SHA `5494…ff00b`, inventory 232 (A=214 B=12 C=3 D=3) |

Regression tests (fail before, pass after):

- `frontend/src/lib/validation.test.ts` — `isValidPhone (ET parity with the backend)`: accepts exactly the six forms the real backend accepts (`+251911223344`, `0911223344`, `251911223344`, `+251 91 122 3344`, `0911-223-344`, `911223344`) and rejects exactly what it rejects (`09112233445`, `+25191122334`, `091122334`, `not-a-phone`). Before the fix the reject-case assertions fail against the old loose pattern.
- `frontend/src/features/public-booking/BookingFlow.test.tsx` — "rejects a wrong-length phone on the details step instead of failing the submit": typing `09112233445` keeps the customer on **Your details** with an inline field error and asserts **no `/customer/bookings` request is sent at all** (failed before the fix: the wizard advanced and the submit later 400'd). "surfaces the real safe reason when the backend rejects the booking": forces a real-shaped 400 `customerPhone` VALIDATION_ERROR from the double and asserts the done step shows the honest phone message, the old generic sentence is gone, and no internals (`customerPhone` field key) leak.
- To make the second test meaningful, the test double (`frontend/src/test/businessApi.ts`) now enforces backend phone parity (`isValidEtPhone` — same shape, 400 `fields.customerPhone = "customerPhone must be a valid phone number"`) and gained a `failCustomerBookingRequest` option modeled on the existing `failOwnerBookingRequest`.

## 12. BROWSER QA

Ad-hoc headless-Chrome (playwright-core + system Chrome) against the real running stack, after the fix — 14/14 checks passed:

- Wrong-length phone `09112233445` is blocked on **Your details** with the inline message; **zero** booking POSTs leave the client.
- Valid ET forms `+251911223344`, `0911223344`, `251911223344` all advance to review.
- Full real submit with `+251911778899` + bank transfer + PNG proof reached the real backend: **POST /api/v1/customer/bookings → 201**, "Booking request received" (payment-pending disposition).
- The payment-step client guard (no method/proof → stays with "Choose a payment method. Attach your payment proof.") still works.
- Earlier (pre-fix) real-browser reproduction had also confirmed the UI defect chain end-to-end, including a 409 conflict rendered honestly.

Temporary driver scripts and screenshots were deleted after verification.

## 13. SPEC SHA

Verified before implementation and re-verified after:

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` — unchanged.

`docs/WEREFA-COMPLETE-SPECIFICATION.md` was not modified; no approved behavior, §46 decision, blocked/deferred requirement, or Prompt 38 Item 6 was touched.

## 14. MOCK / DEMO AUDIT

- No mock/demo booking path added; the fix lives entirely in the real flow's validation and error mapping.
- No fake success: the created state still comes only from a real 201 projection (`createdResultFromView`); conflicts still surface as conflicts.
- The only test-double change is stricter (parity with the real backend's phone rejection), plus a scoped forced-error hook for tests.
- Runtime code contains no new fixtures; acceptance's "Mock / test provider safety" and "Forbidden-regression guards" gates pass.

## 15. WORKING TREE

Uncommitted (as required). Task 55's changes are preserved intact; task 56 adds/changes:

- `frontend/src/lib/validation.ts` — ET phone pattern (root-cause fix).
- `frontend/src/lib/validation.test.ts` — ET parity tests.
- `frontend/src/types/models.ts` — `SubmitResult` error variant carries `message`.
- `frontend/src/features/public-booking/state/useBookingFlow.ts` — honest failure mapping.
- `frontend/src/features/public-booking/components/steps/DoneStep.tsx` — renders the real safe message.
- `frontend/src/features/public-booking/BookingFlow.test.tsx` — two regression tests.
- `frontend/src/test/businessApi.ts` — double phone parity + `failCustomerBookingRequest` option.

Pre-existing from task 55 (untouched): `backend/src/api/admin/subscription.controller.ts`, `backend/src/api/http-subscription.db.spec.ts`, `backend/src/domain/services/subscription-billing.service.ts`, `frontend/src/api/admin.ts`, `frontend/src/features/admin/SubscriptionReviewPage.tsx`, `frontend/src/features/owner-portal/PaymentProofReview.test.tsx`, `frontend/src/features/owner-portal/lib/paymentReview.ts`, `frontend/src/features/owner-portal/pages/BookingDetailPage.tsx`, `frontend/src/features/owner-portal/state/usePaymentReview.ts`, `frontend/src/lib/download.ts`, `frontend/src/styles/components.css`, `frontend/src/components/proof/` (new), `frontend/src/features/admin/subscriptionProofPreview.test.tsx` (new), `docs/implementation/55-real-payment-proof-preview-inspection.md` (new).

Scratch artifacts removed: `frontend/.e2e-investigate.mjs`, `frontend/.e2e-verify-fix.mjs`, screenshots (`frontend/.e2e-*.png`, `frontend/frontend/`, `.run/*.png`), `.run/backend.clean.log`. `.run/backend.log` / `.run/frontend.log` remain (dev-server logs, gitignored).

## 16. REPORT PATH

`docs/implementation/56-real-customer-booking-failure-root-cause-and-fix.md`

## 17. UNRESOLVED ITEMS

Genuine blockers: none for this task.

Related existing deferred/blocked work (unchanged, not silently resolved):

- REQ-094/095/139 remain blocked and REQ-025/034/115 deferred per §46 — untouched.
- Prompt 38 Item 6 untouched.
- Minor investigation limitation (transparency only): the exact browser 400 body was inferred from the unique 135-byte response length + log metadata rather than a captured request body (`request.postData()` returns null for multipart in this Playwright setup). The root cause is independently corroborated: direct HTTP probes prove `09112233445`-shape phones are exactly what the backend rejects with that 135-byte body, and the fix eliminates the failure class — the post-fix browser run submits with a valid phone and gets 201.
- Server-side enforcement note (no action taken): the backend remains authoritative; a hostile client could still post an invalid phone and get the same 400. That is correct behavior, not a defect.
