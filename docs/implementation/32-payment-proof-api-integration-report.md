# 32 — Payment Proof API Integration Report (Prompt 50 continuation; REQ-114/115/118/121/123/230)

## Scope

Hardening pass over the Prompt 50 payment-proof/resubmission vertical reported in #30/#31. The
feature was already implemented end to end (real multipart proof uploads, content-based validation,
`PaymentProofStorage` port + filesystem adapter, transactional proof/file linking, owner download,
one-time phone-scoped resubmission codes). This prompt closes the genuine security/idempotency gaps
found by a backend audit and stabilizes a pre-existing concurrency flake, without touching
frontend behavior or the canonical spec.

**Explicit non-scope (unchanged from #30/#31):** owner booking UI stays on `mockOwnerApi`; code
delivery is out of band; S3/MinIO storage deferred; the six unresolved product decisions remain
unresolved.

## Verification results (final, run locally)

| Layer | Command | Result |
|---|---|---|
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm run build` | PASS |
| Backend | `npm test` (no DB) | 147 passed / 190 skipped (22 files passed, 6 skipped) |
| Backend | `npm run test:db` (live PostgreSQL 16) | **281 passed / 16 files** — three consecutive clean runs post-fix, then two more consecutive clean runs after a test-refinement, all green |
| Frontend | `npx vitest run` | **416 passed / 34 files, exit 0** |
| Frontend | `npm run typecheck` (`tsc -b`) | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` (vite) | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged — SHA-256 `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` |

The final DB suite counts include the 5 new domain bis used uniquely renumbered 40–45 to avoid the
`ownerN@example.com` unique-email collisions that initially broke the run (`30-payment-proof…` tests
already used 31–34).

## Findings fixed

| # | Finding (audit) | Fix | Files |
|---|---|---|---|
| 1 | `Math.random()` used for the 6-digit resubmission code — not a CSPRNG, predictable | `randomInt(100000, 1000000)` from `node:crypto` | `resubmission.service.ts` |
| 2 | `request-code` / latest-rejected probe silently 404'd; no security-event trail | `RESUBMISSION_CODE_REQUEST` FAILED (booking missing, phone mismatch, non-REJECTED state) and RATE_LIMITED (active-code cap); `latestRejected` now records the probe failure | `resubmission.service.ts` |
| 3 | Idempotent fast-path on resubmit only checked `businessId`; a replayed key could be answered with a **different booking's** proof/state inside the same business | Fast-path verifies `existing.businessId === biz.id && existing.bookingId === booking.id`; mismatch → `idempotencyConflict` + `RESUBMISSION_PROOF` FAILED event | `resubmission.service.ts` |
| 4 | Idempotent replay of a booking-create key never compared customer identity; a key replayed by a different phone silently returned the original booking | `resolveIdempotent`/`idempotentRef` take `customerPhone`; mismatch → `idempotencyConflict`. Applied to all three idempotent paths (fast-path, in-lock raced, P2002 winner) | `booking.service.ts` |
| 5 | `markUsed` result ignored; a code already claimed concurrently could still proceed (duplicate work) | Claim result checked; `!claimed → resubmissionCodeUsed()` aborts the tx | `resubmission.service.ts` |
| 6 | Orphan proof cleanup keyed on "consumed" — a failed **commit** could leave the staged file, or a commit followed by a post-commit throw could delete a **linked** row's file | Cleanup keyed on `committed` (set only after the tx commits); `RESUBMISSION_PROOF` OK event moved after commit. Same `committed` restructure in booking-create | `resubmission.service.ts`, `booking.service.ts` |
| 7 | Pre-existing flake: a same-key concurrent booking-create could be answered `SLOT_UNAVAILABLE` (409) when the loser's **pre-lock** availability check ran after the winner committed — an REQ-121 idempotency violation on same-key retries | The pre-check failure now re-queries the submission key and returns the winner idempotently before answering 409 | `booking.service.ts` |

Finding 7 also fixes a real retry-safety hole: a client retrying the exact same booking request after
a network failure can no longer be mis-answered with a slot conflict once the first attempt committed.

## What changed

### `backend/src/domain/services/resubmission.service.ts`

- `generateCode()` → `String(randomInt(100000, 1000000))` (CSPRNG, `node:crypto`).
- `requestCode`: emits `RESUBMISSION_CODE_REQUEST` FAILED on booking-not-found, phone-mismatch and
  non-REJECTED state; RATE_LIMITED when `MAX_ACTIVE_CODES` is reached.
- `latestRejected(businessId, phone, eventType?)` records a FAILED event when no rejected booking
  exists (used by `requestCodeForCustomer` and the verify probe).
- Resubmit fast-path: same key for a different business **or a different booking** → conflict +
  `RESUBMISSION_PROOF` FAILED event; same booking/business → unchanged idempotent return.
- Missing/invalid code now records `RESUBMISSION_CODE_CHECK` FAILED (in addition to the existing
  RATE_LIMITED attempt guard).
- `markUsed(tx)` result asserted; failure aborts with `resubmissionCodeUsed()`.
- `consumed` → `committed` flag; staged proof deleted only when the tx did **not** commit;
  `RESUBMISSION_PROOF` OK event fired after commit.

### `backend/src/domain/services/booking.service.ts`

- `resolveIdempotent`/`idempotentRef` gained a `customerPhone` parameter; a replayed key with a
  different customer phone is a conflict.
- Same-key **pre-lock availability miss** now re-checks the key and returns the winner idempotently.
- `consumed` → `committed` flag (staged proof cleanup runs only on non-commit; `afterCommit` moved
  outside the advisory-lock transaction).

### `backend/src/api/http-api.db.spec.ts`

- Removed the `Math.random` spy that fixed the OTP at `100000`. The test now calls the real
  `request-code` endpoint (CSPRNG hash it can't predict), then overwrites the just-issued row's
  `codeHash` with sha256(`123456`) and verifies with `123456` — exactly one active verification row,
  no ordering dependence. `vi` import dropped, `createHash` added.

### `backend/src/domain/domain-services.db.spec.ts`

Five new tests (unique business sequences 40–45):

1. `booking-create replay of a used submission key with a different customer phone is a CONFLICT` —
   idempotentRef phone guard (finding 4).
2. `resubmission probe failures are recorded as security events (no active code, wrong state)` —
   finding 2.
3. `replaying a used resubmission key on a DIFFERENT booking is a CONFLICT and the target stays
   REJECTED` — finding 3 (also asserts no state mutation + `RESUBMISSION_PROOF` FAILED event).
4. `replaying a used resubmission key on the SAME re-rejected booking is an idempotent success (no
   duplicate proof)` — idempotent replay never creates duplicate state on the legitimate
   same-booking retry path.
5. `concurrent same-key resubmissions produce exactly one winning proof (REQ-121)` — advisory-lock
   race: exactly one `fulfilled`, booking ends `PAYMENT_PENDING`, exactly one proof row.

## Storage & security

- **No behavior change to storage boundaries**: proofs remain content-sniffed, ≤ 5 MiB, stored
  behind `PaymentProofStorage` (filesystem adapter), path-safe keys, tenant+booking-scoped downloads.
- **Codes**: now CSPRNG-generated; still sha256-hashed at rest, single-use, expiring, active-count +
  attempt caps, and now with complete security-event coverage on every probe/verify failure path.
- **Idempotency**: a replayed submission key is scoped to (business, booking, customer phone) before
  it can short-circuit; cross-tenant or cross-booking replays are rejected and audited.

## Seam audit

- **HTTP+DB seam (`http-api.db.spec.ts`, RUN_DB_TESTS-gated)** — 281/281 over 16 files on live
  Postgres; the resubmission E2E flow is deterministic without stubbing randomness.
- **Backend domain (`domain-services.db.spec.ts`)** — replay/phone/race/event behavior proven
  against real PostgreSQL under advisory-lock serialization.
- **Frontend** — untouched; the real-API boundary tests from Prompt 50 (`customerProofNoMock.test.ts`,
  `BookingStatus.test.tsx`, `BookingFlow.test.tsx`) still gate the multipart client.

## Req trace

- REQ-121 (idempotent submission): replay scoped to business + booking + customer phone; concurrent
  same-key race yields exactly one winner; the slot-conflict shadow (finding 7) is closed.
- REQ-230 (one-time expiring phone-scoped resubmission code): CSPRNG codes + audited probe/verify
  failures.
- REQ-123 (rejection keeps the slot LOCKED): unchanged — nothing in this pass releases a slot.
- REQ-114/115/118 (owner proof review/download, upload validation): unchanged from #30 — the storage
  and download boundaries are intact.

## Notes / knowns

- **Browser QA not run** — no Playwright/Cypress tooling exists in this repo (consistent with
  reports #28–31); deterministic seam-level coverage is the substitute. The demo-booking cleanup
  (`addis-beauty-lounge`) is moot without a browser run: no demo booking was created.
- No commit was made (task rule). The working tree carries exactly the 4 intended modified files:
  `resubmission.service.ts`, `booking.service.ts`, `http-api.db.spec.ts`, `domain-services.db.spec.ts`.
- Spec unchanged — SHA-256 `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## Close

- Repo status = expected working set only. Canonical spec unchanged. NO commit made.
- Green chain (all local, exit 0): backend `npm run typecheck && npm run lint && npm run build &&
  npm test` (147 passed) and `npm run test:db` (**281 passed**, several consecutive clean runs);
  frontend `npx vitest run` (**416 passed/34 files**) `&& npm run typecheck && npm run lint &&
  npm run build`.