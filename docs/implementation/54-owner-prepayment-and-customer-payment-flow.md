# 54 — Owner Prepayment Configuration & Customer Prepayment Flow: Current-State Audit

Prompt: **Implement the complete real Owner Prepayment Configuration + Customer Prepayment flow**
Status: **COMPLETE** — audited end to end; the feature is **already fully implemented** on the current tree; one genuinely missing regression test was added; all gates green
Report date: 2026-09-30
Repository: Werefa (`master`, one file modified in the working tree; **no commit made**)
Canonical spec SHA-256: `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (**verified, matches the required hash**)

> **Headline finding:** the requested feature does **not** need to be built. The
> prompt anticipated that a historical implementation might have been removed.
> It has not. REQ-110 (prepayment required per the business's configured policy)
> and REQ-111 (percentage **or** fixed, never mixed) are already implemented
> across the real owner UI → real HTTP API → real domain service → real
> PostgreSQL → real customer booking API → real snapshotted payment data, with no
> mock, demo, frontend-only or fabricated prepayment state anywhere in the runtime.
>
> The audit found **one genuine gap**: there was no explicit regression test
> proving the mandatory snapshot semantics (a later configuration or price change
> must never rewrite an existing booking's `prepaid_minor`). That test was added.
> No production code was changed; nothing was invented.

---

## 1. Current-state audit

Each link of the chain was inspected in source and, where possible, exercised
against a real running stack:

```
REAL OWNER UI (PrepaymentCard)  →  REAL HTTP API (PATCH /owner/businesses/:id/settings)
  →  REAL BACKEND SERVICE (BusinessService.updateSettings)
  →  REAL POSTGRESQL (business_settings.prepayment_mode/percent/fixed_minor)
  →  REAL CUSTOMER BOOKING API (BookingService.create → AvailabilityService.requiredPrepaidMinor)
  →  REAL SNAPSHOTTED DATA (payment.prepaid_minor written once, inside the advisory-locked transaction)
```

| Area | Where | State |
|---|---|---|
| A. Business model | `backend/prisma/schema.prisma` (`model Business`) | present |
| B. Payment model | `model Payment` (`prepaidMinor @map("prepaid_minor")`) | present |
| C. `prepaid_minor` field | `Payment.prepaidMinor`, `BigInt`, non-null | present |
| D. Business settings | `model BusinessSettings` (`prepaymentMode`, `prepaymentPercent`, `prepaymentFixedMinor`) | present |
| E. Owner config endpoint | `PATCH /api/v1/owner/businesses/:businessId/settings` | present |
| F. Owner config frontend | `features/owner-portal/components/PrepaymentCard.tsx` | present |
| G. Public availability | `POST /api/v1/public/businesses/:slug/availability` → `requiredPrepaidMinor` | present |
| H. Public booking creation | `POST /api/v1/customer/bookings` (multipart) | present |
| I. Payment method | `PAYMENT_METHOD_IDS` = `BANK_TRANSFER`, `TELEBIRR_MOBILE_MONEY` | present |
| J. Payment proof | multipart proof + `PaymentProof` + storage adapter | present |
| K. Money utilities | integer minor units end-to-end; `BigInt` in domain, `number` on the wire | present |
| L. Tenant guards / isolation | `TenantGuard.requireOwnedBusiness` + `withBusinessAdvisoryLock` | present |
| M. Validation conventions | `UpdateBusinessSettingsPayload` + domain re-validation + error envelope | present |
| N. API DTO conventions | `api/dto/payloads.ts`, `api/dto/projections.ts` | present |
| O. Tests | backend real-DB HTTP suite; frontend owner + customer suites | present |

**Nothing was missing from A–O.** No duplicate abstraction was created.

---

## 2. REQ-110 implementation (prepayment required per configured policy)

**Fully implemented.**

- The single authoritative calculation is
  [`computePrepaidAmount`](../backend/src/domain/lib/prepayment.ts): `NONE` (or
  missing settings) always yields `0n`, so a business that never configured a
  deposit can never force a receipt.
- Public disclosure: `AvailabilityService.requiredPrepaidMinor(businessId, total)`
  reads the **persisted** `business_settings` row and is returned by the public
  availability projection as `requiredPrepaidMinor`, so the customer learns the
  exact amount *before* submitting.
- Enforcement: `BookingService.create` recomputes the same amount server-side and
  `if (prepaid > 0n && !input.proof) throw domainErrors.proofRequired()` —
  proof validation runs **before** any availability claim, so a missing proof
  never locks a slot (spec §31).
- The customer booking response exposes `prepaidMinor` and `paymentMethod`
  (`null` when nothing is prepaid).

## 3. REQ-111 implementation (percentage XOR fixed, never mixed)

**Fully implemented.**

- DB representation: `enum PrepaymentMode { NONE, PERCENTAGE, FIXED }` plus
  `prepaymentPercent Int?` and `prepaymentFixedMinor BigInt?`, guarded by the
  `business_settings_prepayment_mode` CHECK constraint.
- `BusinessService.updateSettings` writes the **triplet whole**:
  - `PERCENTAGE` → requires `prepaymentPercent` in **1–100**; rejects a
    simultaneous fixed value (`"Choose a percentage or a fixed amount, not both."`).
  - `FIXED` → requires a **non-negative** `prepaymentFixedMinor`; rejects a
    simultaneous percentage.
  - `NONE` → rejects **any** accompanying value (`"With no deposit, do not send a
    percentage or a fixed amount."`).
  - Switching modes always **clears** the value that no longer applies.
- Authorization: `TenantGuard.requireOwnedBusiness(ctx, businessId)` — ownership
  is derived from the authenticated actor, **never** from the request body.
- Bounds are the canonical ones (1–100, non-negative fixed). No extra or invented
  restrictions were added.

## 4. Database changes

**None.** The representation already exists in the committed
`20260916123842_init_domain_schema` migration. No new migration was created and no
historical migration was touched. `prisma generate` was not required
(the schema is unchanged).

## 5. API changes

**None.** The owner settings route, DTO
(`UpdateBusinessSettingsPayload`), owner projection
(`prepaymentMode`/`prepaymentPercent`/`prepaymentFixedMinor`) and public
availability projection (`requiredPrepaidMinor`) all already exist and follow the
established conventions and error envelope.

## 6. Owner UI changes

**None.** `PrepaymentCard.tsx` is embedded in the existing owner business profile
page (not a standalone demo page). It loads the real persisted configuration,
offers No deposit / Percentage / Fixed, shows only the applicable input, saves
through the real settings route, and surfaces loading, success and real API
validation errors. It holds **no** `localStorage` state and **no** static config
object.

## 7. Customer UI changes

**None.** `useBookingFlow` holds `depositMinor` sourced **only** from the backend
availability projection; `ReviewStep` and `PaymentStep` render that real value.
Payment-method choices come from `lib/paymentMethods.ts`, which deliberately
carries no account numbers or instructions.

## 8. Prepayment calculation rules

| Mode | Amount | Notes |
|---|---|---|
| `NONE` (or no settings row) | `0n` | never a receipt |
| `PERCENTAGE` | `(totalMinor × percent) / 100n` | integer `BigInt` division — deterministic floor, no floating point |
| `FIXED` | configured `prepaymentFixedMinor` | used verbatim |

Money is integer minor units everywhere; no floating-point money arithmetic is
performed. The amount is derived from the **booking total the backend itself
resolves** from the service catalog snapshot (`catalogService.validateCombinations`),
never from the client.

## 9. Snapshot semantics

Verified by construction and now pinned by a regression test:

- `prepaid = computePrepaidAmount(settings, totalPriceMinor)` is computed once and
  written as `prepayment.paidMinor` via `bookingRepo.createBooking({ prepaidMinor: prepaid, … })`
  **inside** the `withBusinessAdvisoryLock` transaction.
- Nothing recomputes a booking's deposit afterwards. The owner booking projection
  reports `payment.prepaidMinor` verbatim, so the displayed amount is the
  persisted snapshot, never a recalculation from current settings.
- Consequence: changing the configuration (or a service price/duration) affects
  **new** bookings only; existing bookings retain their snapshot.

## 10. Payment-method behaviour

Only the two canonical methods exist (`BANK_TRANSFER`, `TELEBIRR_MOBILE_MONEY`).
No card, Stripe, PayPal, crypto, gateway or custom method is present. The method
is validated server-side; the frontend value is not trusted. When nothing is
prepaid the method projects as `null` (the `payment.method` column keeps its
placeholder enum value at rest but it is never projected — carried from doc 53).

## 11. Payment-proof integration

Unchanged and reused — no second proof system exists. `prepaid > 0` requires a
proof; proof validation runs before the slot claim; MIME allowlist, magic-byte
sniffing, 5 MiB cap, storage safety, tenant scoping, idempotency and
rejected-proof resubmission all remain intact (covered by the existing real-DB
suite). No new payment state (`PARTIALLY_PAID`, `DEPOSIT_PAID`, `REFUNDED`,
`FAILED`) or refund logic was introduced.

## 12. Tenant-isolation verification

Ownership is enforced by `TenantGuard.requireOwnedBusiness` on every owner
settings call, and the public booking path resolves the business from the slug.
The existing real-DB suite covers cross-tenant configuration reads/updates and
rejects foreign services under another business's slug. No shortcut around the
guard or RLS was introduced.

## 13. Concurrency / idempotency verification

Preserved and untouched: per-business PostgreSQL advisory lock, in-transaction
availability re-check, partial unique active slot-lock defence, bounded retry,
submission-key idempotency (including the concurrent same-key replay case) and
atomic booking/payment creation. No external lock, TTL slot expiry or repricing
was added.

## 14. No-mock verification

- `npm run acceptance:static` → **PASS**, including the *Mock / test provider
  safety* guard.
- No runtime prepayment mock, demo deposit, fabricated amount/method, hard-coded
  percentage or fixed amount, `localStorage` prepayment state, or fallback
  configuration exists in the runtime paths audited (`PrepaymentCard`,
  `useBookingFlow`, `ReviewStep`, `PaymentStep`, `api/business.ts`,
  `api/schedule.ts`, `types/models.ts`).
- The customer flow explicitly does **not** invent payment instructions; where
  the business publishes no destination account, it says so
  (`lib/paymentMethods.ts`, `PaymentStep.tsx`).

## 15. Tests and exact counts

**Added in this task (1 test, backend, real DB + real HTTP):**

`backend/src/api/http-api.db.spec.ts` →
`snapshots the deposit per booking: a later configuration or price change never
rewrites an existing booking (REQ-108/110/111)`

It proves, against real PostgreSQL and the real HTTP API:

1. `PERCENTAGE 50` → booking A snapshots `floor(total × 50 / 100)` (in the create
   response **and** in the `payment` row).
2. Owner switches to `FIXED 1234` **and** raises the service price → booking A is
   unchanged in the DB **and** through the owner projection.
3. A new booking B snapshots `1234`; booking A is still unchanged.
4. `NONE` → a new booking C needs no proof and snapshots `0` with a `null` method;
   bookings A and B remain untouched.
5. Cleanup restores `NONE` and the original service price.

**Existing coverage confirmed (not re-written):**

- Backend `http-api.db.spec.ts`: public availability discloses the exact deposit,
  owner view reports the configured deposit, percentage computed from the real
  total and enforced on booking, mode switching clears the stale value, mixing
  rejected, out-of-range percentage rejected, no-deposit booking never asks for a
  receipt, proof required/allowed, proof MIME/size/sniffing, idempotent replays.
- Frontend `features/owner-portal/PrepaymentConfig.test.tsx` (5 cases) and
  `test/customerPrepayment.test.tsx` (11 cases), including *"never falls back to
  mock or demo payment data when the real API fails"* and *"never hard-codes a
  deposit or a payment method"*.
- `features/owner-portal/BookingManagement.test.tsx` asserts the owner-side
  deposit survives a reschedule.

| Suite | Result |
|---|---|
| Backend unit (`npm test`) | **199 passed** \| 262 skipped (461), 30 passed files |
| Backend typecheck | **PASS** |
| Backend lint (`--max-warnings=0`) | **PASS** |
| Backend build (`nest build`) | **PASS** |
| Frontend tests (`npm test`) | **538 passed** (49 files) |
| Frontend typecheck / lint / build | **PASS** / **PASS** / **PASS** |

---

## 16. DB tests run #1

```
Test Files  29 passed (29)
     Tests  403 passed (403)
```

## 17. DB tests run #2

```
Test Files  29 passed (29)
     Tests  403 passed (403)
```

Two consecutive clean runs, no flakes, no order dependence.

## 18. Acceptance result

`npm run acceptance` → **ACCEPTANCE GATE: PASS** — **20/20 checks green**
(11 static invariants + 9 release gates):

`Canonical specification hash` · `Canonical requirement inventory (232)` ·
`Requirement classification baseline` · `Production auth safety` ·
`Frontend API base URL safety` · `Mock / test provider safety` ·
`Environment documentation contract` · `Database release safety` ·
`Worker / outbox safety` · `Secret / logging safety` ·
`Forbidden-regression guards` · `Backend tests` · `Backend DB tests` ·
`Frontend tests` · `Backend typecheck` · `Backend lint` · `Backend build` ·
`Frontend typecheck` · `Frontend lint` · `Frontend build`.

No acceptance check was weakened, skipped or modified.

## 19. Static acceptance result

`npm run acceptance:static` → **PASS** — 11/11 static invariants, including the
canonical hash `5494658e…ff00b` and the mock/test-provider safety guard.

## 20. Browser QA result

**Not run.** The repository contains **no browser QA harness** (only static
screenshots under `frontend/qa-shot/`), and this task forbids installing or
inventing browser automation. Evidence for the flow is real HTTP against a real
app + real PostgreSQL (the DB suite) plus a live read-only check on the running
development stack:

```
POST /api/v1/public/businesses/tame-hair-studio/availability
  → computedTotalPriceMinor: 20000, requiredPrepaidMinor: 0   (business configured NONE)
```

## 21. Remaining limitations

1. **Live mutation was intentionally not performed on the development database.**
   The prompt forbids polluting `werefa_dev` with demo records, so the full
   `PERCENTAGE → FIXED → NONE` booking sequence is proven on the designated test
   database (`werefa_test`) through real HTTP + real PostgreSQL rather than by
   writing bookings into the dev business. The dev-stack check above is read-only.
2. **Pre-transaction read window (pre-existing, unchanged).** `settings` and the
   catalog total are read immediately before the advisory-locked transaction and
   the derived `prepaid` is written inside it. The snapshot is self-consistent
   (`prepaid` derives from the same `totalPriceMinor` that is snapshotted), but a
   configuration change landing in that narrow window would be picked up by the
   incoming booking rather than the in-transaction value. Re-reading inside the
   transaction would be a refactor of the existing booking path and is reported,
   not silently changed.
3. **Payment instructions remain unpublishable.** The canonical model has no
   owner-published bank/mobile-money destination field, so the customer is told
   the amount and the supported methods and is explicitly told the details are
   not published online. Restoring the previously-removed fabricated instructions
   was **not** done. If owner-published payment instructions are a real
   requirement, that is a **separate missing requirement**.
4. **`payment.method` placeholder (carried from doc 53).** The column is a
   non-nullable enum carrying `BANK_TRANSFER` for no-deposit bookings; the value is
   never projected. Making it nullable is a deliberate schema decision, not part
   of this task.
5. **No proof-amount verification exists** in the product, so none was invented;
   the required prepayment amount lives on the booking/payment record, and owner
   approve/reject remains the existing review workflow.

## 22. Spec SHA-256

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Verified **before** any change. The canonical specification was not modified, no
product decision was made, and no §46 item was resolved.

## 23. Files changed

| File | Change |
|---|---|
| `backend/src/api/http-api.db.spec.ts` | **+1 test** — the snapshot-semantics regression test for `prepaid_minor` across configuration and price changes |

**No production file was changed.** No migration, DTO, projection, service, UI or
wire type needed modification, because the feature is already implemented.

## 24. Working-tree status

```
 M backend/src/api/http-api.db.spec.ts
```

One modified file (plus this report). `HEAD` remains
`45ee7c1 docs: report the customer prepayment and receipt integration audit`.

## 25. No commit created

Confirmed: `git commit` was **not** run. No branch, tag, worktree or second agent
was created. The working tree is left uncommitted for review.
