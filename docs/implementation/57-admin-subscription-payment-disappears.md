# 57 — Approved Subscription Payments "Disappearing" From the Admin Page

Prompt: **Investigate and fix the issue where an Admin approves/confirms a business subscription payment, after which the payment disappears from the Admin page and cannot be found**
Status: **COMPLETE** — root cause identified as a missing UI capability over an already-implemented backend view; record was never deleted, never overwritten, and never lost its proof or audit history; frontend-only fix, no product decision, schema change, new endpoint or mock data; all gates green
Report date: 2026-10-02
Repository: Werefa (`master`, uncommitted working tree; **no commit made**)

> The canonical specification was not modified. No §46 decision was resolved. No
> blocked/deferred requirement was touched. No mock, demo or fabricated payment
> or history record was introduced. No business rule was changed or invented. No
> authorization or tenant-isolation boundary was weakened. No payment record was
> deleted. No second payment API or duplicate endpoint was created. No commit was
> created.
>
> The finding is subtle and worth stating up front: **the approved payment was
> never lost.** The database row, its proof bytes and its audit history all
> survived the approval. The queue semantics that hid it were correct. The actual
> defect was that the Admin interface could only ever ask for `state=PENDING`, so
> a decided proof had **no reachable view anywhere in the product** — while the
> backend route that serves it had existed all along.

---

## 1. Summary of the verdict

| Question the brief asked | Answer |
| --- | --- |
| Is the record deleted? | **No.** `SubscriptionProof` is never deleted by any code path (repo-wide search for `subscriptionProof.delete*` returns nothing). |
| Is it overwritten? | **No.** Approval mutates the *same* row in place under a compare-and-set guard; `submissionKey`, `fileObjectId`, `requestedAt`, `createdAt` are all untouched. |
| Is it filtered out of a pending-only query? | **Yes — and correctly so.** The queue is `where: { reviewState: <requested state> }`; a decided proof is no longer `PENDING`. |
| Is the frontend cache stale? | **No.** There is no query library; the page does a manual full refetch after every action, on the correct state. |
| Is there an approved/history view? | **In the API: yes, since the beginning. In the UI: no — that was the defect.** |
| Is the approved proof still securely accessible? | **Yes.** `GET /admin/subscription/proofs/:proofId/file` is state-agnostic and Admin-gated; the bytes and the `FileObject` row survive approval. |
| Is the audit history preserved? | **Yes.** One `SubscriptionStatusHistory` row per approval, plus the decision columns on the proof row itself. |

---

## 2. Reproduction with real data

The development database already contained the exact reported end state — two
real subscription payments that had been approved in the Admin UI by the Super
Admin, leaving an empty pending queue.

```
 review_state |                  id                  | requested  |       approved_until       | has_reviewer |             business_id
--------------+--------------------------------------+-----------+----------------------------+--------------+----------------------------------
 APPROVED     | ac43c888-65ff-4a9d-a6b2-fc7104ab60ae | 2026-09-30 | 2026-10-31 08:37:44.904+00 | t            | 63101fa0-2ad0-4e48-90c5-702f86e4c1f0
 APPROVED     | 48b91ae4-926e-4661-b840-d6fd62883489 | 2026-10-02 | 2026-12-05 08:37:44.904+00 | t            | 63101fa0-2ad0-4e48-90c5-702f86e4c1f0
```

Proof lineage and audit history after approval:

```
 review_state | has_file_row | has_storage_key | size_bytes | mime_type
--------------+--------------+-----------------+------------+-----------
 APPROVED     | t            | t               |     1869817 | image/png
 APPROVED     | t            | t               |     1869817 | image/png

 to_status | actor_type  |                               reason                               | occurred_at
-----------+-------------+----------------------------------------------------------------+-------------
 ACTIVE    | SUPER_ADMIN | Subscription proof approved; period until 2026-12-05T08:37:44.904Z | 2026-10-02
 ACTIVE    | SUPER_ADMIN | Subscription proof approved; period until 2026-10-31T08:37:44.904Z | 2026-10-01
```

Reading of this evidence, in the order the brief asked for it:

1. **Still present in the database but omitted by a query/filter** — the proof
   rows exist, with their `FileObject` row, storage key, byte size and MIME type
   intact.
2. **Correctly removed from a pending-only queue** — expected and desired.
3. **Not deleted, not overwritten** — proven by the surviving lineage columns.
4. **Not merely inaccessible** — there was no Admin-authorized way to *reach*
   the record from the product, because no Admin screen ever requested a state
   other than `PENDING`. This is the defect.

### Reproduction limitation (honest statement)

I did **not** approve an unrelated real payment, and I did not create a
submission to manufacture a fresh pending row. `AUTH_TEST_ENABLED` is `false` in
`backend/.env` (correct for a dev environment and required to stay `false` in
production), and the Super Admin credential is not available to me, so the
authenticated Admin round-trip against the live dev server could not be driven
directly — `GET /api/v1/admin/subscription/proofs?state=APPROVED` returns `401`
without a session, as it should.

The state-changing half of the lifecycle (submit → list pending → approve → list
approved) was therefore reproduced against the **established DB test suite**
(`npm run test:db`), which boots the real Nest application with real Prisma
against the real `werefa_test` PostgreSQL database — the sanctioned fallback in
the brief. The two read-only facts above (the record survives; the audit rows
exist) were taken from the live development database directly. No test timeout
was widened and no test was weakened to accommodate this.

---

## 3. Root cause

**The Admin subscription review page hard-coded the pending queue and offered no
other view, even though the backend route it already calls serves all three
review states.**

The whole chain, traced end to end:

```
Owner submits proof
  └─ POST /owner/businesses/:id/subscription/proof
       SubscriptionBillingService.submitProof            (billing.service.ts:72)
       → LocalProofStorage.store + FileObject + SubscriptionProof(reviewState=PENDING)
Admin list
  └─ GET /admin/subscription/proofs?state=PENDING        (subscription.controller.ts:25)
       listProofsForReview → requireAdminOrSuperAdmin    (billing.service.ts:218-224)
       → PrismaSubscriptionRepository.listProofsByReviewState
            where: { reviewState: state }                (prisma-subscription.repository.ts:200-218)
Admin approves
  └─ POST /admin/subscription/proofs/:id/approve         (subscription.controller.ts:55)
       SubscriptionBillingService.approveProof            (billing.service.ts:135-183)
       → withBusinessAdvisoryLock (one prisma.$transaction + pg_advisory_xact_lock)
          1. reviewProof  → updateMany WHERE id AND businessId AND reviewState='PENDING'
                            SET reviewState=APPROVED, reviewedBy, approvedUntil, rejectionReason=NULL
                            returns false if it was not pending → 409
          2. setPaidBand  → Subscription.periodEndsAt = max(periodEndsAt, paidGraceEndsAt, now) + 30d
                            Subscription.paidGraceEndsAt = periodEndsAt + 5d
          3. subscription.update → status = ACTIVE
          4. appendHistory → one SubscriptionStatusHistory row (fromStatus → ACTIVE, actor, reason)
       → attemptAutoResume (REQ-155/158) outside the transaction
Admin list again
  └─ GET …?state=PENDING   ← the ONLY state the UI ever asks for
```

Two independent things combined:

* **The backend is complete and correct.** The review query is not
  pending-only *by design*; it filters on the caller-supplied `state`, and the
  query DTO explicitly accepts all three values:

  ```ts
  // backend/src/api/dto/payloads.ts:661-665
  export class SubscriptionProofQueueQuery {
    @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'APPROVED', 'REJECTED'] })
    @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
    state: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
  }
  ```

  The frontend client is equally capable: `listSubscriptionProofs(state =
  'PENDING')` (`frontend/src/api/admin.ts:33-42`) is typed over
  `SubscriptionReviewState = 'PENDING' | 'APPROVED' | 'REJECTED'`.

* **The page threw all of that away** with a single literal:

  ```tsx
  // frontend/src/features/admin/SubscriptionReviewPage.tsx:35 (before the fix)
  setRows(await listSubscriptionProofs('PENDING'))
  ```

  with no tab, filter, `select` or any other affordance able to change it. So
  the moment a reviewer clicked **Approve**, the record correctly left the
  queue and the product had no remaining surface from which it could be found —
  which reads to the operator exactly like data loss.

This is a **missing UI capability**, not a query bug, not a stale cache and not a
backend deletion. The `Approved` and `Rejected` views existed in the API contract
and in the data model (`SubscriptionReviewState` in
`backend/prisma/schema.prisma:101-105`) but were never reachable from the
product.

---

## 4. Investigation findings against each expected question

| Question | Finding |
| --- | --- |
| Does the pending queue intentionally filter to submitted/pending proofs? | Yes. `where: { reviewState: state }` with a `PENDING` default. Intentional and preserved. |
| Does approval change the status, and does the UI then stop matching its filter? | Yes to both. Approval sets `APPROVED`; the UI has no filter other than `PENDING`, so the row stops matching. |
| Is there already an approved/history view? | In the API and DB: yes (`state=APPROVED` / `state=REJECTED`). In the Admin UI: no. |
| Does the approval response invalidate/refetch the correct query? | It refetches the *currently selected* state, which was always `PENDING`. With one state that is correct; the defect was the absence of any other state to select. There is no query cache to invalidate (no query library in the repository). |
| Is the approved proof still available through the secure Admin-authorized retrieval path? | Yes. `getProofFileForAdmin` (`billing.service.ts:236-253`) applies `requireAdminOrSuperAdmin`, then reads the `FileObject` and the stored bytes. It does **not** filter on `reviewState`, so it works for a decided proof. Verified in the DB suite for both approved and rejected records. |
| Does the system preserve the payment/proof audit history? | Yes. One `SubscriptionStatusHistory` row per approval, carrying `fromStatus → ACTIVE`, actor type/user and the reason string. The decision columns (`reviewState`, `reviewedBy`, `rejectionReason`, `approvedUntil`) stay on the proof row. **Note:** `SubscriptionStatusHistory` has no `proofId` column and no read API, so it is an append-only audit ledger, not a browsable per-payment history — see §8. |
| Query bug, stale cache, or missing UI capability? | **Missing UI capability.** |

---

## 5. Why no product clarification is required for the fix implemented

This mattered enough to check explicitly, because the brief forbids inventing
behavior. Facts:

* The specification's authorization matrix (§21, line 764) grants **Admin** and
  **Super Admin** "Review subscription proof" (REQ-137). It does **not** mandate
  a separate Admin "approved payments history" view — and it does not forbid one
  either. There is no §46 open item about Admin subscription-payment history
  (§46 lists exactly six items: price, timezone, reminder lead time, owner
  booking-report PDF, owner modify scope, timezone abbreviation display).
* **No new rule was defined by this change.** Every state, status transition,
  retention fact, authorization decision and byte of proof data involved already
  existed in the schema and behind the existing endpoint. The fix selects a
  value that the server was already accepting and validating.

What was deliberately **not** done:

* No `state=all` / "every payment" query was added. The backend supports exactly
  three states and the UI now offers exactly those three — inventing an
  "all states" list would have been a new API surface.
* No retention, expiry, archival, undo/reopen, re-review or bulk-action rule was
  introduced. A decided proof stays decided; a replay is still a server-side
  `409`.
* No pagination, sorting, search, export, Super-Admin-only split or
  platform-wide report was added.
* No new controller method, service method, repository method, DTO, migration or
  database index.

---

## 6. Fix implemented

**Frontend only** (`SubscriptionReviewPage.tsx`, plus two CSS rules), reusing the
existing Admin API exactly as it already exists.

1. **Three review views** — a `role="tablist"` with **Pending review**,
   **Approved** and **Rejected**. Each maps to the pre-existing
   `state` query value. `PENDING` remains the default and the initially selected
   view, so the queue's behavior on load is byte-for-byte unchanged.
2. **Status made obvious** — every row renders a review-state chip reusing the
   owner portal's existing chip classes (`booking-chip--active/--confirmed/
   --rejected`), plus the approved-through date on approved rows and the review
   note on rejected rows. The list also gained an accessible name
   (`aria-label="<view> proofs"`).
3. **Queue semantics preserved** — the Approve button, the rejection-reason input
   and the Reject button render **only** on the pending view. A decided record is
   read-only, which also removes a guaranteed-`409` round trip from the UI.
4. **Whereabouts communicated** — the success notice after a decision now says the
   proof is kept and *listed under Approved* / *listed under Rejected*.
5. **Proof access preserved and extended to decided records** — the existing
   `PaymentProofPreview` still renders in all three views and still loads through
   the Admin-authorized `GET /admin/subscription/proofs/:id/file` route. No public
   URL, no storage path, no new endpoint.
6. **Refetch correctness** — `refresh(state)` now takes the selected state; the
   post-action refetch re-reads the *currently selected* view rather than always
   `PENDING`. Switching tabs re-reads the newly selected view.
7. **Failure handling unchanged** — a failed load renders the existing
   "Could not load the queue" alert with the mapped safe message, renders no
   fabricated row, and leaves the tabs usable.

The list itself is not paginated (as before), so the count of fetched rows is
unchanged from the existing behavior.

---

## 7. Tests added (regression cover for the actual root cause)

### Backend — real DB contract (`backend/src/api/http-subscription.db.spec.ts`)

Two new cases, both running against real PostgreSQL through the real Nest app:

* **`an approved proof is never deleted: the SAME row stays readable under state=APPROVED`**
  1. the row survives with the **same id**, `fileObjectId`, `requestedAt`,
     `createdAt` and `submissionKey` (proof lineage intact);
  2. the row count for the business is unchanged — a decision creates **no
     duplicate**;
  3. it no longer appears under `state=PENDING` (queue semantics);
  4. it **is** served by `state=APPROVED` with the same id, the same
     `approvedUntil`, its business name and owner email, and no `storageKey` in
     the payload;
  5. the receipt bytes are still readable by an Admin (a second Admin account is
     used to prove the route is not per-actor);
  6. one `SubscriptionStatusHistory` row records the approval, carrying the
     approved-until value in its reason;
  7. authorization is unchanged: the owner gets `403` on the decided view and on
     the file route, an anonymous request gets `401`, and an unknown state
     (`?state=PAID`) gets `400`.
* **`a rejected proof is likewise kept and readable under state=REJECTED with its reason`**
  — the reject counterpart: same id, same proof bytes, `rejectionReason`
  recorded, `approvedUntil` null, absent from `PENDING`, present under
  `REJECTED` with its reason, receipt still Admin-readable, owner still `403`.

These tests sit **after** the pre-existing N15 rejection test, which asserts
"exactly one" owner rejection email for its own submission. The new rejection
case was placed after it specifically so that existing assertion keeps its
original meaning rather than being relaxed.

### Frontend (`frontend/src/features/admin/subscriptionReviewStatusViews.test.tsx`)

Six cases over the real route tree and the real Admin API client. The `fetch`
double **mirrors the server**: approve/reject mutate the existing row (same id,
same bytes) and only change which `state` list it appears in — so a test can
prove the record itself is still reachable, not merely that a fixture exists.

1. opens on the pending queue and shows the submitted proof with its decision
   controls — and asks for `PENDING` only (unchanged default);
2. after **Approve**: the notice names the destination, the row leaves the
   pending queue, the refetch stays on `PENDING` (no silent view switch), and the
   **same proof** is then found under **Approved** with its status chip and
   approved-through date;
3. after **Reject**: the proof is findable under **Rejected** with its reason;
4. decided rows are read-only (no Approve/Reject) and the receipt still loads
   over `/admin/subscription/proofs/:id/file` only — never a public or storage URL;
5. a full unmount/remount still finds the decided proof (refreshing the page does
   not lose records);
6. a failed decided-view load is reported honestly, fabricates no row, and leaves
   the views usable.

### Both suites were verified to actually fail on the defect

Not assumed — measured:

* Reverting only the page's state selection to the literal `'PENDING'` makes
  **4 of the 6** frontend tests fail (the 2 that still pass are the ones
  asserting the *unchanged* pending-queue semantics, which is correct).
* Forcing the repository's list query back to a hard-coded
  `where: { reviewState: 'PENDING' }` makes **both** new backend DB tests fail,
  with the rest of the suite unaffected. The repository file was restored
  afterwards and re-verified.

---

## 8. Related observation reported, not fixed (no requirement mandates it)

`SubscriptionStatusHistory` (REQ-154 / REQ-231 "recorded in history") is an
append-only audit ledger with **no `proofId` column and no read API** — nothing in
the product browses it. It is a genuine gap *if* an Admin-facing subscription
history report is ever wanted, but:

* the brief forbids inventing retention/workflow rules, and no approved
  requirement asks for an Admin subscription-payment history report (contrast
  REQ-177/178, which *do* explicitly grant the Super Admin booking status
  history and its PDF export);
* adding it would require a new admin endpoint, a new read model and possibly a
  schema change — i.e. new surface, not a defect fix.

**Recommendation for the Product Owner (not implemented):** decide whether
Admin/Super Admin should have a subscription-payment history report, and if so
whether it should link each approval to its proof. This is a candidate for §46.
It does not block the fix above, and nothing about the fixed flow depends on it.

---

## 9. Gate results (exact)

All commands run from the repository root unless a `workdir` is noted.

| Gate | Command | Result |
| --- | --- | --- |
| Spec hash (pre-change) | `sha256sum docs/WEREFA-COMPLETE-SPECIFICATION.md` | `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` — **matched**, no mismatch reported |
| Backend unit tests | `backend/ npm run test` | **PASS** — 30 files passed, 11 skipped; **199 passed**, 266 skipped (465) |
| Backend DB tests (run 1) | `backend/ npm run test:db` | **PASS** — 29 files, **407 passed / 407** (84.3s) |
| Backend DB tests (run 2, same DB) | `backend/ npm run test:db` | **PASS** — 29 files, **407 passed / 407** (86.0s) |
| Backend DB tests (run 3, same DB) | `backend/ npm run test:db` | **PASS** — 29 files, **407 passed / 407** (85.97s), also via the acceptance gate (89.9s) |
| Backend typecheck | `backend/ npm run typecheck` | **PASS** — no output |
| Backend lint | `backend/ npm run lint` | **PASS** — `--max-warnings=0`, no findings |
| Backend build | `backend/ npm run build` | **PASS** — `nest build`, no errors |
| Frontend tests | `frontend/ npm run test` | **PASS** — 51 files, **556 passed / 556** |
| Frontend typecheck | `frontend/ npm run typecheck` | **PASS** — no output |
| Frontend lint | `frontend/ npm run lint` | **PASS** — no findings |
| Frontend build | `frontend/ npm run build` | **PASS** — built in 3.58s (pre-existing >500 kB chunk warning only) |
| Acceptance (static) | `npm run acceptance:static` | **PASS** — 11/11 checks |
| Acceptance (full) | `npm run acceptance` | **PASS** — 11 static checks + all 9 release gates |

`npm run acceptance` final output:

```
PASS  Canonical specification hash
        5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b
PASS  Canonical requirement inventory            232 requirements (REQ-001 … REQ-232)
PASS  Requirement classification baseline      A=214 B=12 C=3 D=3 total=232
PASS  Production auth safety
PASS  Frontend API base URL safety
PASS  Mock / test provider safety
PASS  Environment documentation contract       37 backend variables documented
PASS  Database release safety                  11 DB-gated spec files
PASS  Worker / outbox safety
PASS  Secret / logging safety
PASS  Forbidden-regression guards              18 guarded requirement ids, none claimed implemented
PASS  Backend tests / Backend DB tests / Frontend tests
PASS  Backend typecheck / lint / build
PASS  Frontend typecheck / lint / build

ACCEPTANCE GATE: PASS
```

No test was weakened, skipped, deleted or given a longer timeout. The DB suite
was run **three** times consecutively against the same `werefa_test` database
(once standalone, twice standalone, once through the gate) with an identical
result each time, confirming the suite is re-runnable against dirty state.

---

## 10. Browser QA availability

**Not available.** The repository has **no browser QA harness** — only static
screenshots under `frontend/qa-shot/` (recorded as a known gap in `README.md`).
No interactive browser verification of the new tabs was performed, and none is
claimed.

What *was* verified against the running development environment: the backend
(`/api/v1/system/ready` → `{"status":"ok","checks":[{"name":"database","status":"ok"}]}`)
and the Vite dev server both return `200`, and the production build output
contains the new "listed under Approved" confirmation string, proving the change
ships in the built bundle.

**Recommended manual QA for a human with a browser:** sign in as Admin →
`/admin/subscriptions` → confirm the three views render → approve a real pending
proof → confirm it leaves **Pending review**, that the notice points at
**Approved**, and that the receipt is still openable there.

---

## 11. Compliance statement

* **Canonical specification SHA-256**, verified before the first change and again
  after the last: `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.
  **Unchanged.** `docs/WEREFA-COMPLETE-SPECIFICATION.md` was **not** modified.
* **No business rule invented or silently changed.** No status, transition,
  retention, authorization or notification behavior was altered. The fix only
  makes an already-implemented and already-validated `state` query value
  reachable from the product.
* **No mock/demo/fake records.** No payment, proof or history row was fabricated
  in the development or test database. The only records created were by the
  established DB test suite inside `werefa_test`, which it truncates on exit.
* **Authorization and tenant isolation untouched.** The same endpoint, the same
  `ApiAuthGuard` and the same `requireAdminOrSuperAdmin` gate serve all three
  views; the owner's `403` and the anonymous `401` are asserted by the new tests.
  No proof byte is reachable without an authorized Admin session, and no storage
  key or public URL is exposed.
* **No approved record deleted**, and nothing deleted to make a queue update work.
* **No second payment system or duplicate API.** Zero new endpoints, service
  methods, repository methods, DTOs, migrations or indexes.
* **No commit created.** Confirmed: `git log --oneline -1` still points at
  `cc9cc73`, which predates this work.

### Working-tree status (`git status --short`, after this work)

Modified (this work):

```
 M backend/src/api/http-subscription.db.spec.ts                              (2 new DB regression cases)
 M frontend/src/features/admin/SubscriptionReviewPage.tsx                    (three review views)
 M frontend/src/styles/components.css                                        (.proof-queue__tabs / __tab)
```

New, untracked (this work):

```
?? frontend/src/features/admin/subscriptionReviewStatusViews.test.tsx        (6 regression tests)
?? docs/implementation/57-admin-subscription-payment-disappears.md            (this report)
```

Pre-existing uncommitted work from earlier prompts, **left untouched** (the
working tree was already dirty when this task began — reports 55 and 56):

```
 M backend/src/api/admin/subscription.controller.ts        M frontend/src/api/admin.ts
 M backend/src/domain/services/subscription-billing.service.ts
 M frontend/src/features/admin/SubscriptionReviewPage.tsx  (overlaps this fix)
 M frontend/src/features/owner-portal/…                    M frontend/src/features/public-booking/…
 M frontend/src/lib/download.ts   M frontend/src/lib/validation.ts (+ its test)
 M frontend/src/styles/components.css                       (overlaps this fix)
 M frontend/src/test/businessApi.ts M frontend/src/types/models.ts
?? docs/implementation/55-real-payment-proof-preview-inspection.md
?? docs/implementation/56-real-customer-booking-failure-root-cause-and-fix.md
?? frontend/src/components/proof/
?? frontend/src/features/admin/subscriptionProofPreview.test.tsx
```

Two files carry changes from both bodies of work (`SubscriptionReviewPage.tsx`
and `components.css`); nothing from reports 55/56 was reverted or rewritten.

**Report path:** `docs/implementation/57-admin-subscription-payment-disappears.md`

**No commit was created.** Work remains uncommitted in the working tree.