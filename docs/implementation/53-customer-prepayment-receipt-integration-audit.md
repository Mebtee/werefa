# 53 — Customer Prepayment & Receipt Upload: Integration Audit, Root Cause & Fixes

Prompt: **Customer prepayment / receipt upload end-to-end audit (real data only)**
Status: **COMPLETE** — one configuration root cause and three real defects found, all fixed, regression suites added, live flow verified against the real database, gate green
Report date: 2026-09-28
Repository: Werefa (`master`, uncommitted working tree; no commit made)

> The receipt-upload flow was **not** broken in the customer path, and it was
> **not** a mock or demo-data problem. The real database had every business
> configured with **no deposit**, and the current product gave the owner **no way
> to change that** — the configuration half of the feature had been removed in
> the clean reset while the backend contract stayed. Auditing the flow in full
> also surfaced three further genuine defects in the same code path, all fixed
> here. The canonical specification was not modified, no product decision was
> made, no platform-wide percentage or payment instruction was invented, no
> demo/mock runtime data was added, and no §46 item or Prompt 38 Item 6 concern
> was touched.

---

## 1. Summary

| # | Finding | Class | Status |
|---|---------|-------|--------|
| **A** | The owner has **no UI** to configure prepayment. The backend, DTO, projection, DB columns, CHECK constraints and the entire customer receipt flow all exist; the configuration surface does not. | Root cause | **Fixed** — `PrepaymentCard` + real settings client |
| **B** | Switching the deposit between forms (e.g. PERCENTAGE → NONE, or → FIXED) left the previous value in the row, violated the `business_settings_prepayment_mode` CHECK constraint, and returned an opaque **HTTP 500**. | Real defect (REQ-111 AC1) | **Fixed** — triplet written whole; mixing rejected |
| **C** | A booking with **no deposit** was still reported as having been paid by `BANK_TRANSFER` — to the customer and to the owner — because the placeholder column value was projected verbatim. | Real defect (REQ-110) | **Fixed** — method is `null` when nothing is prepaid |
| **D** | The owner booking detail fabricated a `payment-proof-<id>.bin` attachment of 0 bytes for a no-deposit booking, which the download route can never serve. | Real defect | **Fixed** — file-less proof rows are not listed |

**Why the customer never saw a receipt step:** the wizard shows the payment step
only when the backend-disclosed `requiredPrepaidMinor > 0`. In the real database
every business had `prepayment_mode = 'NONE'`, so the correct product behaviour
was "no payment step". The customer code was right; the product was
unreachable.

---

## 2. Finding A — the missing owner configuration surface (root cause)

### 2.1 What the audit traced

The complete real chain, each link verified in source **and** against the live
API on the running stack:

```
PATCH /api/v1/owner/businesses/:id/settings      ← owner chooses NONE / PERCENTAGE / FIXED
        │  business_settings.prepayment_mode / _percent / _fixed_minor
        ▼
POST /api/v1/public/businesses/:slug/availability
        │  availability.service.ts → computePrepaidAmount() → requiredPrepaidMinor
        ▼
GET  /api/v1/public/businesses/:slug             (no prepayment field; not needed)
        │
        ▼
BookingWizard: requiresPayment = (depositMinor ?? 0) > 0
        │  true  → ReviewStep offers "Continue to payment" → PaymentStep
        │  false → ReviewStep offers "Confirm booking" directly
        ▼
POST /api/v1/customer/bookings   multipart: payload (JSON text) + proof (file)
        │  booking.service: if (prepaid > 0n && !proof) throw proofRequired()
        ▼
GET  /api/v1/customer/status     awaiting-verification
        │
        ▼
Owner: GET booking detail → download proof → accept / reject
        │  reject → POST /customer/resubmission/request-code → /resubmission/verify
        ▼
accept → CONFIRMED
```

Every link in that chain is real. There is no mock import on the runtime path,
`PaymentStep` posts to the real endpoint, and the resubmission routes are real
(owner Telegram, not an owner portal screen). `PaymentStep` even renders the
approved set only: Bank Transfer and Telebirr / mobile money.

### 2.2 The actual gap

The customer side was complete; the **owner** side had no way to turn the
requirement on. `PrepaymentCard` existed in the historical Prompt 13 report and
was removed during the clean reset (`4cb5cb1`), while
`UpdateBusinessSettingsPayload` (`prepaymentMode`, `prepaymentPercent`,
`prepaymentFixedMinor`), `BusinessService.updateSettings`, the owner projection
and the database all remained. The feature was half-wired: the switch existed,
the button did not.

Live state that proved it (`tame-hair-studio`, business
`63101fa0-2ad0-4e48-90c5-702f86e4c1f0`):

```
settings: {"mode":"NONE","pct":null,"fixed":null,"interval":60}
POST /public/businesses/tame-hair-studio/availability
  → requiredPrepaidMinor: 0, computedTotalPriceMinor: 20000, slots: 8
```

### 2.3 The fix

- `frontend/src/api/types.ts` — `UpdateBusinessSettingsInput` now carries
  `prepaymentMode`, `prepaymentPercent`, `prepaymentFixedMinor`.
- `frontend/src/api/business.ts` — new `updateOwnerBusinessSettings(businessId, input)`
  posting to the real `PATCH /owner/businesses/:id/settings`.
- `frontend/src/api/schedule.ts` — `updateOwnerScheduleInterval` now delegates to
  that one client instead of duplicating the settings call.
- `frontend/src/api/business.mapper.ts` — `prepaymentFromView` maps the real
  owner projection into the UI model; `prepaymentToSettings` serialises it back.
  A mode whose companion value is missing degrades to "no deposit" rather than
  inventing a value.
- `frontend/src/features/owner-portal/components/PrepaymentCard.tsx` — the owner
  surface: three modes, live summary of what the customer will see, range
  validation before anything is sent, save/discard, honest error surfacing.
- `frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx` — hosts the card.

No default percentage, no default amount, no payment-instruction field. The card
writes only what the owner picks, and only to the route the backend already
enforces.

---

## 3. Finding B — switching deposit forms returned HTTP 500

### 3.1 The database was already the authority

`business_settings` carries the REQ-111 invariant as a CHECK constraint:

```sql
CONSTRAINT business_settings_prepayment_mode CHECK (
  ("prepayment_mode" = 'NONE'       AND "prepayment_percent" IS NULL     AND "prepayment_fixed_minor" IS NULL)
  OR ("prepayment_mode" = 'PERCENTAGE' AND "prepayment_percent" IS NOT NULL AND "prepayment_fixed_minor" IS NULL)
  OR ("prepayment_mode" = 'FIXED'     AND "prepayment_percent" IS NULL     AND "prepayment_fixed_minor" IS NOT NULL)
);
```

### 3.2 The service wrote a partial triplet

`BusinessService.updateSettings` spread the request straight into the
repository. A client that sends the new mode and its value — but does not repeat
the now-irrelevant field — leaves the old value in place:

| Request | Resulting row | Outcome |
|---|---|---|
| `{mode: PERCENTAGE, percent: 30}` | `PERCENTAGE / 30 / null` | ok |
| `{mode: FIXED, fixed: 5000}` from PERCENTAGE | `FIXED / 30 / 5000` | **CHECK violation** |
| `{mode: NONE}` from PERCENTAGE | `NONE / 30 / null` | **CHECK violation** |
| `{mode: NONE, fixed: null}` from FIXED | `NONE / null / null` | ok (this is why the old test passed) |

The violation escaped as a raw Prisma error, and the global exception filter
correctly refused to leak it — so the owner saw
`500 {"code":"INTERNAL_ERROR","detail":"An unexpected error occurred."}` for
something they had asked for correctly. The pre-existing test only ever moved
FIXED → NONE *with an explicit null*, which is exactly the one transition that
never tripped the constraint, so the bug was invisible to the suite.

### 3.3 The fix

`updateSettings` now builds the patch itself and writes the triplet **whole**:
the value for the chosen mode plus an explicit `null` for the field that does not
apply. A request that carries a value for a mode it did not select is rejected
outright (REQ-111 AC1: "accepts one of the two forms and rejects mixing") rather
than silently reinterpreted. The booking-interval-only update is untouched, so
an interval edit still never writes prepayment columns.

Live confirmation on the real database (`tame-hair-studio`):

```
PERCENTAGE 25        → 200 {"mode":"PERCENTAGE","pct":25,"fixed":null}
PERCENTAGE 25 → NONE → 200 {"mode":"NONE","pct":null,"fixed":null}      (was 500)
availability         → requiredPrepaidMinor: 0
NONE → FIXED 7500    → 200 {"mode":"FIXED","pct":null,"fixed":7500}
FIXED 7500 → PCT 25  → 200 {"mode":"PERCENTAGE","pct":25,"fixed":null}
mixed payload        → 400 fields.prepaymentFixedMinor "Choose a percentage or a fixed amount, not both."
```

---

## 4. Finding C — a no-deposit booking claimed a payment method

`payment.method` is a non-nullable enum with no `NONE` member, so the booking
service stored the caller's choice or fell back to `BANK_TRANSFER`
(`booking.service.ts`, `input.paymentMethod ?? 'BANK_TRANSFER'`). Both
projections then reported it verbatim:

```ts
paymentMethod: booking.payment?.method ?? PaymentMethod.BANK_TRANSFER,   // customer
method: booking.payment.method,                                          // owner
```

So a booking where the customer paid **nothing**, chose **no** method and
attached **no** receipt was reported to the customer and shown to the owner as
**"Bank transfer"**. The canonical spec states plainly that the platform has no
universal prepayment amount and that the per-business configuration applies
(BR-15 / REQ-110); reporting a payment that did not happen contradicts it.

### The fix

Both projections now report the method only when something was actually
prepaid; otherwise the field is `null`:

- `customerBookingProjection` → `paymentMethod: prepaidMinor > 0n ? method : null`
- `ownerBookingProjection` → `method: prepaidMinor > 0n ? method : null`
- `frontend/src/api/types.ts` → `paymentMethod: string | null`
- `frontend/src/features/owner-portal/pages/BookingDetailPage.tsx` → renders
  **"No payment required"** instead of an empty cell.

The stored placeholder column is left alone: making it nullable is a schema
migration with a far wider blast radius than this defect warrants, and the value
is now never surfaced. That is recorded as a limitation in §9.

---

## 5. Finding D — a fabricated proof attachment for no-deposit bookings

`createBooking` unconditionally nests a `payment_proof` row, even when no file
was uploaded (`fileObjectId: null`). The owner-facing timeline listed it, and
the projection turned a file-less row into a plausible-looking attachment:

```ts
fileName: p.file ? proofFileName(p.id, p.file.mimeType) : `payment-proof-${p.id.slice(0, 8)}.bin`,
mimeType: p.file?.mimeType ?? '',
sizeBytes: p.file ? Number(p.file.sizeBytes) : 0,
```

The owner therefore saw a `payment-proof-191a37a6.bin` of 0 bytes on a booking
where the customer had uploaded nothing — and clicking it hit the download
route, which correctly refuses a proof with no file
(`if (!proof?.file) throw businessNotFound`). The stored row is a submission
record, not a proof; the fix filters the owner-visible timeline to rows that
carry a real file:

```ts
where: { paymentId, fileObjectId: { not: null } }
```

The row itself is still created (it is the payment's submission record and the
accept/reject flow does not depend on it), so no other behaviour moves.

---

## 6. Live verification (real database, real HTTP)

The dev backend on `:3000` runs without `AUTH_TEST_ENABLED` and the real owner
password is not available (and was **not** reset). A second instance of the
**same build** was therefore started on `:3001` with test auth enabled against
the **same development database**, driven over real HTTP, then stopped. No
fixture, seed or fabricated business was used: the real business, the real
service and the real slots were used throughout.

| # | Step | Result |
|---|------|--------|
| 1 | Baseline availability, deposit `NONE` | `requiredPrepaidMinor: 0`, total `20000`, 8 slots |
| 2 | Owner `PATCH` `PERCENTAGE 25` | `200 {"mode":"PERCENTAGE","pct":25,"fixed":null}` |
| 3 | Availability re-read | `requiredPrepaidMinor: 5000` (25 % of 20000) — disclosed before the customer books |
| 4 | Booking **without** a proof | `400` `fields.proof: "A proof file is required."` |
| 5 | Mixed payload | `400` `fields.prepaymentFixedMinor: "…not both."` |
| 6 | Mode switches `PCT→NONE→FIXED→PCT` | all `200`, every column cleared correctly (was a 500) |
| 7 | Booking **with** a real 71-byte PNG receipt | `201 {"status":"awaiting-verification","prepaidMinor":5000,"paymentMethod":"BANK_TRANSFER"}` |
| 8 | Owner list + detail | `PAYMENT_PENDING`, `prepaidMinor 5000`, one proof `image/png`, 71 bytes |
| 9 | Owner downloads the proof | `200 image/png`, `Content-Disposition: attachment`, bytes **byte-identical** to the upload |
| 10 | Owner rejects the proof | `200`, booking `REJECTED` with the reason recorded |
| 11 | Customer requests a resubmission code | `200 {"expiresAt":…}` — the code itself is never returned |
| 12 | Restore `NONE`, book with **no** deposit and **no** proof | `201 {"prepaidMinor":0,"paymentMethod":null}` |
| 13 | Owner detail for that booking | `{"method":null,"prepaidMinor":0}`, `proofs: []` — no fabricated attachment |
| 14 | Final state | `{"mode":"NONE","pct":null,"fixed":null,"interval":60}`, `requiredPrepaidMinor: 0` |

Step 11 is the one live link that could not be completed: the resubmission code
is delivered out of band (Telegram) and is stored only as a hash, so it cannot be
recovered for a live round-trip. That path is covered by the real-DB HTTP suite
(`customer rejection + one-time-code resubmission returns the booking to
awaiting-verification`), not by guesswork.

**Database restoration:** both audit bookings were cancelled through the real
owner endpoint (freeing the slots), the deposit configuration was returned to
`NONE`, `requiredPrepaidMinor` is back to `0`, and the temporary receipt files
and the `:3001` process were removed. The dev database is back to the state it
was in before the audit apart from the two cancelled audit bookings and their
status history.

---

## 7. Regression tests

### 7.1 Frontend — `frontend/src/test/customerPrepayment.test.tsx` (new, 11 tests)

- Real wire mapping for all three modes, including a mode whose companion value
  is absent (degrades to "no deposit", never invents one).
- Round-trip back to the settings payload for all three modes.
- The owner save really is `PATCH /owner/businesses/:id/settings` and the owner
  view reports the deposit back.
- An out-of-range percentage never becomes a network call.
- The client never asks for both forms at once (REQ-111 AC1), asserted against
  the wire.
- **CASE A** — a configured deposit makes the receipt step required: review
  offers "Continue to payment", no "Confirm booking", the proof input is
  present.
- **CASE B** — no configured deposit never forces a receipt: "Confirm booking"
  is offered, no "Continue to payment", no deposit notice.
- The payment amount comes from the backend's own `requiredPrepaidMinor`, not
  from anything the client computes.
- A no-deposit booking is submitted with no payment method and no proof.
- A real backend 500 on submit is an honest error, never a fake success.
- Source guards: the flow derives `requiresPayment` from the disclosed amount
  and contains no percentage literal; the payment step names no gateway and no
  bank/wallet details.

### 7.2 Frontend — `frontend/src/features/owner-portal/PrepaymentConfig.test.tsx` (new, 5 tests)

- The panel shows the real backend configuration, not a hard-coded default.
- An empty or out-of-range percentage is refused before anything leaves the
  browser, and the valid value reaches the settings route.
- A fixed amount is stored in **minor units** (`75.50` → `7550`) and the deposit
  can be cleared again.
- A fixed amount of `0` is stored honestly and the summary says so, because the
  backend accepts `@Min(0)` — the card matches the real contract instead of
  inventing a stricter rule.
- The panel names no payment method, account number, bank or wallet.

### 7.3 Backend — `backend/src/api/http-api.db.spec.ts` (6 new tests, real HTTP + real Postgres)

- The owner view reports the configured deposit back, so the panel can render
  real data.
- **A percentage deposit is computed from the real booking total and enforced**:
  availability discloses `floor(total × 30 / 100)`, the same booking is refused
  without a proof and accepted with one, landing in `awaiting-verification`.
- **Switching between the two forms always clears the value that no longer
  applies** — PERCENTAGE → FIXED → PERCENTAGE → NONE, asserting the stored row
  after each step. This is the direct regression test for the 500.
- Mixing is rejected (both directions) and a value sent with `NONE` is rejected;
  nothing is written.
- An out-of-range percentage is rejected and nothing is stored.
- **A business with no deposit books directly and never asks for a receipt**:
  plain JSON booking, no multipart, `prepaidMinor 0`, `paymentMethod: null` for
  the customer, `method: null` and `proofs: []` for the owner, no proof carrying
  a file, and the ordinary owner accept still confirms the booking.

One pre-existing assertion was corrected rather than worked around: the
customer-safe-payload test asserted `paymentMethod === 'BANK_TRANSFER'` for a
booking that required no deposit — the exact false claim fixed in §4. It now
asserts `prepaidMinor 0` and `paymentMethod null`.

### 7.4 Test counts

| Suite | Before | After |
|---|---|---|
| Backend `npm test` | 199 passed, 255 skipped | **199 passed, 261 skipped** |
| Backend `npm run test:db` | 396 passed | **402 passed** |
| Frontend `npm test` | 522 passed | **538 passed** |

The backend DB suite was run **twice against the same database**; both runs were
identical and green, confirming the suite is re-runnable and order-independent.

---

## 8. Gates

All required gates, in order, from a clean run:

| Gate | Command | Result |
|---|---|---|
| Backend tests | `npm --prefix backend test` | **PASS** — 30 files, 199 passed / 261 skipped |
| Backend DB tests (run 1) | `npm --prefix backend run test:db` | **PASS** — 29 files, 402 passed |
| Backend DB tests (run 2, same DB) | `npm --prefix backend run test:db` | **PASS** — 29 files, 402 passed |
| Backend typecheck | `npm --prefix backend run typecheck` | **PASS** |
| Backend lint | `npm --prefix backend run lint` | **PASS** — `--max-warnings=0` |
| Backend build | `npm --prefix backend run build` | **PASS** |
| Frontend tests | `npm --prefix frontend test` | **PASS** — 49 files, 538 passed |
| Frontend typecheck | `npm --prefix frontend run typecheck` | **PASS** |
| Frontend lint | `npm --prefix frontend run lint` | **PASS** |
| Frontend build | `npm --prefix frontend run build` | **PASS** |
| Acceptance | `npm run acceptance` | **ACCEPTANCE GATE: PASS** (10/10) |
| Acceptance static | `npm run acceptance:static` | **ACCEPTANCE GATE: PASS** (13/13) |

Canonical specification hash, re-verified by the static gate and unchanged:

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b
```

---

## 9. Scope discipline and limitations

**Not touched:** the canonical specification; §46 clarifications; Prompt 38
Item 6; the booking state machine; the resubmission protocol; the payment
instruction surface (there is no legitimate field for it, so none was invented);
the owner's Telegram flow. No platform-wide percentage or amount was introduced.
No demo business, fixture or runtime mock was added — the only new mock-module
code is test-only state (`frontend/src/mock/store.ts` `savePrepayment`) and the
test HTTP double, and `npm run acceptance:static` ("Mock / test provider safety")
stays green.

**Limitations, stated rather than hidden:**

1. **Live resubmission could not be completed.** The one-time code is delivered
   out of band and stored only as a hash. Covered by the real-DB HTTP suite
   instead.
2. **`payment.method` remains a non-nullable enum** with a `BANK_TRANSFER`
   placeholder for no-deposit bookings. The value is now never projected, but
   the column is still not honest at rest. Making it nullable is a migration
   with a much wider blast radius than this defect warrants, and it is a schema
   decision rather than a bug fix, so it is left for a deliberate decision.
3. **A file-less `payment_proof` row is still written** for no-deposit bookings
   (it is the payment's submission record, and the accept/reject flow does not
   depend on it). It is no longer visible anywhere.
4. **Owner authentication for the live run** used a second instance with
   `AUTH_TEST_ENABLED` on the same database, because the real owner password is
   not available. The real password was not reset and the dev server on `:3000`
   was left running untouched.
5. **Browser verification** of the new card was done through the component and
   routing tests rather than by driving a real browser; the live HTTP evidence in
   §6 covers the API contract those tests assert.

---

## 10. Files changed

**Backend (4 files)**

| File | Change |
|---|---|
| `backend/src/domain/services/business.service.ts` | `updateSettings` writes the prepayment triplet whole and rejects mixing (Finding B) |
| `backend/src/api/dto/projections.ts` | Customer and owner payment method is `null` when nothing is prepaid (Finding C) |
| `backend/src/domain/repositories/prisma-booking.repository.ts` | Owner proof timeline lists only proofs that carry a file (Finding D) |
| `backend/src/api/http-api.db.spec.ts` | 6 new real-DB tests; 1 assertion corrected to the honest value |

**Frontend (9 modified, 3 new)**

| File | Change |
|---|---|
| `frontend/src/api/types.ts` | Settings input carries the prepayment fields; `paymentMethod: string \| null` |
| `frontend/src/api/business.ts` | `updateOwnerBusinessSettings` on the real route |
| `frontend/src/api/schedule.ts` | Interval client delegates to the shared settings client |
| `frontend/src/api/business.mapper.ts` | `prepaymentFromView` / `prepaymentToSettings` |
| `frontend/src/features/owner-portal/components/PrepaymentCard.tsx` | **New** — owner deposit configuration |
| `frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx` | Hosts the card |
| `frontend/src/features/owner-portal/pages/BookingDetailPage.tsx` | "No payment required" instead of a false method |
| `frontend/src/test/customerPrepayment.test.tsx` | **New** — 11 customer-flow / no-mock tests |
| `frontend/src/features/owner-portal/PrepaymentConfig.test.tsx` | **New** — 5 owner-card tests |
| `frontend/src/test/businessApi.ts` | Test double mirrors the real validation, normalisation and rejection |
| `frontend/src/mock/store.ts` | Test-only `savePrepayment` state helper |

`git status` shows 12 modified and 3 new files on an uncommitted `master`; no
commit was made and no second worktree was created.
