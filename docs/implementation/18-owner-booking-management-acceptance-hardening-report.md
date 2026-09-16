# 18 — Owner Booking Management Acceptance Hardening (Prompt 38, Item 5) — Completion Report

Status: **DONE** · Full quality gate **green** · Test suite **275 passed on three
consecutive runs** (`tsc --noEmit`, `eslint .`, `vite build` clean) · Real-browser
regression **152/152 passed** · One targeted production fix applied.

This report closes out Prompt 38, Item 5: the final engineering
acceptance/hardening pass over the Owner Booking Management vertical slice.
The canonical product source of truth
(`docs/WEREFA-COMPLETE-SPECIFICATION.md`) was **not** touched, **no commits
were created**, and no new product decisions were made — the six unresolved
spec decisions remain unresolved.

## 1. Conformance summary

| Dimension | Result |
| --------- | ------ |
| Canonical audit (REQ-093…REQ-232) | **No requirement within this slice contradicts the implementation.** N/A and deferred sets documented below (§11). |
| Query / filter / sort (REQ-175, 184–190) | Conforms. OR-within/AND-across filtering, inclusive date range, case-insensitive name/phone search, 6 sortable columns in both directions, deterministic REQ-190 tie-breaking, default newest-first by date/time. |
| Tenant isolation | Conforms. Every store mutation scopes through the owner session’s `businessSlug` and returns the generic `Booking not found.` for foreign rows; owner API injects `ownedSlug()` on every route. Coverage completed this item (see §4). |
| Booking/state lifecycle (REQ-100–108, 121–124) | Conforms. Six booking states, three payment states, System-only auto-Complete, terminal guards on No Show / Completed / Cancelled / Rejected, hard availability gate on reschedule, payment stays attached, atomic slot claim, rejected slot stays blocked, reason required for rejection. |
| Idempotency | Conforms. Every double action is rejected with no extra history rows or Telegram notices. Coverage completed this item (see §6). |
| Telegram notifications (REQ-227–229, N01–N08) | Conforms. Gated on per-business + per-phone customer connection; deduplicated; reschedule notice only when the appointment actually changed; new date/time recorded; no cross-tenant delivery. |
| Schedule exceptions — Keep Booking (REQ-159/160/161) | Conforms after one targeted fix: the store now **rejects keeping a booking that has no open schedule conflict** (§8). Exception is attributed to the conflict’s schedule version, leaves the original booking data intact, never notifies, persists through completion, and does not leak across tenants. |
| Payment states (REQ-100, SM-08, T8/T9/T10) | Conforms. Only Pending / Accepted / Rejected; owner cancellation of a Payment Pending booking keeps the slot blocked with no notice; rejected release/resubmission paths preserve payment state as specified. |
| Customer-data projection (REQ-109) | Conforms. Phone-only lookup, slug-scoped, phone-normalized, no internal IDs / reference codes / business slug / phone leaks on any customer-facing surface. |
| UI action safety | Conforms. Lifecycle buttons appear only in the valid state; every destructive/terminal action is behind a confirm dialog; no manual “Complete” button anywhere; rejection validation, whitespace rejected; view-only actions never duplicate notices. |
| Browser QA | Item 4’s 152/152 campaign re-ran green against the fix (S20 keep-flow included). |

## 2. Baseline and delta

| Metric | Value |
| ------ | ----- |
| Tests before this item | **268**, all passing (Item 3 baseline) |
| New tests this item | **7** (5 in `lifecycle.test.ts`, 2 in `schedule.test.ts`) |
| Tests after this item | **275**, all passing ×3 consecutive runs (19s each) |
| Production changes this item | **1 file** (`frontend/src/mock/store.ts`): `keepBooking` guard hardened; dead helper removed |
| Pre-existing test fixes | None — no pre-existing assertion was changed |
| Browser regression | `qa-run.js` **152/152** re-passed (S1–S24 + S90) against the tuned build |

## 3. Query / filter / sort audit (REQ-175, REQ-184–190)

Verified in `frontend/src/features/owner-portal/lib/bookingQuery.ts` followed by
the pure-query suite (`bookingQuery.test.ts`, 22 cases):

- **REQ-185** OR within a category, AND across categories — `statuses` is OR’d
  (empty = unconstrained), date range and search are AND’d; page-level pairwise
  AND verified in `BookingsPage.test.tsx`.
- **REQ-187** default newest-first — `DEFAULT_BOOKING_SORT` is `{date-time,
  desc}`; asserted (page default + `bookingQuery.test.ts`).
- **REQ-188** sortable columns — six fields (`date-time`, `booking-id`,
  `customer`, `status`, `actor`, `payment-status`) with a shared direction
  toggle; the spec’s business-name column is N/A on a single-tenant owner list
  (reporting module, §11).
- **REQ-189** exact appointment date, then exact time as secondary, one shared
  direction (`compareDateTime`).
- **REQ-190 / CONF-001** — the comparator chain per field:
  - `booking-id`: issuance order (createdAt proxy, documented) → date/time →
    actor A–Z;
  - `date-time`: date/time → Booking ID → actor A–Z;
  - other columns: primary → Booking ID → date/time.
  Tie-breakers always run ascending; `[…].sort` is deterministic and
  insertion-order independent (asserted for all 6 fields × both directions).
- Booking state canonical order matches the spec’s six states; payment order
  matches the three states (asserted).

**Result: conforms; no changes required.**

## 4. Tenant-isolation audit

Verified by reading `store.ts` (every mutation resolves rows through
`getBooking(slug, id)` / `getConfirmedBooking(slug, id)`; foreign slugs resolve
to nothing and return the generic `Booking not found.` — no cross-tenant
metadata is ever echoed) and `mock/ownerApi.ts` (each route injects
`ownedSlug()` from the single owner session; the booking id is the only
caller-supplied payload, so a copied id can never select another tenant’s row).

Existing coverage (Item 3) already proved `accept/reject/cancel/no-show`
cross-tenant safety. Coverage completed this item:

- `lifecycle.test.ts` — **“every other mutation is tenant-isolated…”**: a
  Confirmed, Telegram-connected booking in a second business cannot be
  rescheduled, cancel-payment-pending’d, released, resubmitted, kept, or
  auto-completed by the primary owner session; each attempt returns
  `Booking not found.`; the foreign booking **gains no Telegram notice** from
  any attempt (it keeps exactly its own proof-received + confirmed events), and
  its state/payment state are untouched.
- Schedule scoping re-checked in `schedule.test.ts`: conflict detection,
  resolution and keep all filter by business slug; `getOpenConflicts` returns
  only the session’s own rows.

**Result: conforms; coverage gap closed.**

## 5. Lifecycle + terminal-guard audit (REQ-100–108, 121–124)

Store pathways audited end-to-end (`store.ts`):

- T1 create — atomic slot claim (re-check + single insertion; the mock is
  single-threaded so the first submission wins), `payment-pending` + Pending.
- T2 accept — Payment Pending → Confirmed, payment Pending → Accepted, one
  confirmation notice when connected.
- T3 reject — Payment Pending → Rejected, payment → Rejected, **reason
  required**, one rejection notice with the reason.
- T4 auto-Complete — **System actor only**, when `date + time + duration`
  passes; no manual Complete button anywhere in the UI (asserted).
- T5 No Show — Confirmed → No Show, terminal, slot released, notice.
- T6 Cancel — Confirmed → Cancelled, terminal, slot released, notice; resolves
  any open schedule conflict as `cancel`.
- T7 Reschedule — Confirmed → Confirmed on a free fitting slot (hard gate,
  REQ-106), payment/ totals unchanged (REQ-107/108), notice only on real
  change; resolves conflicts as `reschedule`.
- T8 Cancel Payment Pending — Cancelled with slot **staying blocked**, no
  notice (SM-08).
- T9 Release rejected — Rejected → Cancelled, slot released, payment stays
  Rejected, no notice.
- T10 Resubmit — Rejected → Payment Pending with slot **still blocked**, proof
  replaced, reason cleared, proof-received notice (REQ-230).
- Terminal guards: No Show and Completed bookings refuse every later action;
  doubles are rejected; auto-Complete never disturbs other states.

**Result: conforms; no changes required.**

## 6. Idempotency audit

Existing Item-3 tests proved double accept / cancel / no-show / reschedule
produce no extra history rows or notices. Coverage completed this item:

- double **reject** — one ‘payment-rejected’ notice, one transition, reason kept;
- double **release-rejected** — one transition, slot released once;
- double **cancel Payment Pending** — slot still blocked, no notice;
- double **resubmit** — only the first proof is kept, one proof-received
  transition, notice count stable;
- double **keep** — rejected after the first keep resolves the conflict, one
  exception, one history entry (in `schedule.test.ts`).

Each assertion pins the exact invariants the spec demands (no duplicate
transitions, no duplicate notifications, terminal state preserved).

**Result: conforms; coverage gap closed.**

## 7. Telegram notification audit (N01–N08, REQ-227–229)

Verified in `store.ts` (`noticeIfConnected` → `recordTelegramNotice`) and
`mock/notifications.test.ts`:

- Single gate: `customerTelegramConnections` keyed `slug::normalizedPhone`
  (REQ-056; same phone can be connected for one business and not another —
  asserted). Business provisioning alone never gates customer events (1b).
- Disconnected default: no lifecycle action fabricates a “failed delivery” or
  any other event (1 / 1b / 10b).
- N02 confirmed, N03 rejected-with-reason, N06 no-show, N07 cancelled, N08
  reschedule-with-new-date/time — each exactly once per real transition, in
  chronological order with deterministic `ntf-N` ids.
- N08 only when the appointment actually changed (7b); failed reschedule emits
  nothing.
- N04/N05 reminders exist only as the deterministic mock seamer
  (`emitMockReminder`, confirmed + connected only) and are not wired to any
  timer — consistent with “do not invent a scheduling rule”.
- API projection (10/10b) exposes only the customer-safe notification view; no
  internal ids.

**Result: conforms; no changes required.**

## 8. Schedule exceptions audit (REQ-159/160/161, REQ-098/099)

Audit findings:

- Conflict warning identifies the affected booking, date/time and reason
  (REQ-093) — `conflictReasonFor` produces date/time-specific reason strings;
  the schedule + detail panels list each affected booking and link to its
  detail (REQ-096/098).
- Quick actions Reschedule / Cancel / Keep resolve the conflict with the
  matching `action` and clear the panel (REQ-099).
- Keep Booking persists after completion, never alters the normal schedule,
  records the decision in audit history, and issues **no customer
  notification** (REQ-160).

**Gap found and fixed (the only production change this item):** the store
allowed `keepBooking` on any live booking even when it had **no open conflict**,
attaching the exception to the latest active version id (or an empty string) —
an unreachable-by-UI but spec-violating path (REQ-159: only bookings affected
by a schedule change can be kept). Fix:

- `keepBooking` now returns
  `Only a booking affected by an open schedule conflict can be kept.` when no
  open conflict exists for that booking, and the exception’s
  `scheduleVersionId` is always the conflict’s own version (the empty-id and
  fallback branches are gone). The now-dead `latestActiveVersion` helper was
  removed.
- New tests: a booking on an untouched day cannot be kept (state, history and
  exception stay null; no conflict is fabricated); a double keep is rejected
  after the first keep resolves the conflict.

UI/API invariants double-checked so the change is strictly tightening, not
behavior-shifting: `ScheduleConflicts` and `BookingDetailPage` only offer Keep
from open-conflict rows, and `OwnerApi.keepBooking` forwards the slug-scoped
store call — no caller exercises the removed fallback.

**Result: conforms after the §8 fix; browser regression re-passed (S20 keep
flow, 11/11).**

## 9. Payment-state audit (REQ-100, REQ-107, SM-08)

- Exactly `Pending | Accepted | Rejected` (`PAYMENT_STATE_ORDER` asserted to
  match the canonical three).
- Accept → Accepted; reject → Rejected; resubmit returns to Pending; Reschedule
  and auto-Complete leave payment value attached (REQ-107); No Show / Cancel /
  release preserve the last payment state.
- No refund logic exists anywhere (REQ-122: manual handling only).
- Detail page renders the three badges (Pending / Accepted / Rejected) and the
  proof card (REQ-119); owner-side Telegram proof verification (REQ-120) is
  deferred backend/infra (§11).

**Result: conforms; no changes required.**

## 10. Customer-data projection audit (REQ-109)

- Lookup is phone-only and slug-scoped; phones are normalized on both sides so
  formatting differences still match; the same phone at another business never
  surfaces here (customerLookup + `BookingStatus.test.tsx`).
- Customer-facing status surfaces show **no internal booking ids, no history
  internals, no reference codes, no business slug, no raw phone** (asserted in
  `BookingStatus.test.tsx` projection tests).
- Telegram projections likewise strip internal fields (`notifications.test.ts`
  10/10b).

**Result: conforms; no changes required.**

## 11. Applicability matrix (REQ-093…REQ-232)

Grouped decision for every domain touched by the audit range. “In-slice” = part
of the Owner Booking Management vertical slice and verified here; “Pre-delivered” =
behavior owned by earlier prompts of the same product mock; “N/A” = another
domain/surface (admin, reporting, subscriptions, pause, public-page
customization, auth) with no owner-booking-dashboard surface; “Deferred” =
backend/infra channel required by the spec that the frontend mock cannot
deliver and was never claimed to (consistent with every prior item).

| Requirements | Decision | Notes |
| ------------ | -------- | ----- |
| REQ-093–098 | In-slice | Conflict panel per affected booking with date/time/reason, per-booking listing, quick actions, direct access. The affected-booking **email** notification (REQ-094/097) is Deferred (no email channel in the mock; the in-app conflict panel is the owner-visible equivalent). |
| REQ-099 | In-slice | Reschedule / Cancel / Keep resolve conflicts. |
| REQ-100–108 | In-slice | States, auto-Complete, manual No Show/Cancel, reschedule availability, payment attached/manual. |
| REQ-109 | In-slice | Phone lookup, no customer-facing references. |
| REQ-110–118 | Pre-delivered | Payment methods / prepayment config from earlier prompts; owner surface only reviews proof. |
| REQ-119 | In-slice | Proof review in dashboard. |
| REQ-120 | Deferred | Owner-side Telegram proof verification is backend/infra (auth + provisioning), not in the frontend mock. |
| REQ-121–124 | In-slice | Atomic claim, no auto-refund, blocked slot on reject, reason required. |
| REQ-125–141 | N/A | Subscription domain (other prompts); no owner-booking-dashboard surface. |
| REQ-142–158 | N/A | Pause domain (pre-delivered elsewhere); not booking management. |
| REQ-159–161 | In-slice | Keep Booking (hardened this item). |
| REQ-162–166, 169 | In-slice | Schedule versioning/history retention, actor/when/what/reason, optional manual reason, System actor, no restore. |
| REQ-167–168, 176–183 | N/A | Admin / Super Admin platform not built (owner portal only). |
| REQ-170–172 | Deferred | PDF export (no PDF infra in the frontend mock). |
| REQ-173–175 | In-slice | Full per-tenant history, current-status reporting. |
| REQ-184–186 | N/A for the owner list | Actor filter, business filter and the 30-day default are **reporting-module** filters (§40.17). The owner queue implements its own filter set (statuses, date range, search) per the bookings-workspace design; no contradiction on this surface. |
| REQ-187–190 | In-slice | Sort fields, default, tie-breaks (CONF-001). |
| REQ-191–206 | N/A / Deferred | Security/history domain — auth is out of scope (demo owner session). |
| REQ-207–221 | N/A | Public-page customization & admin ops (other prompts). |
| REQ-222–226 | In-slice | Fixed global timezone note (no TZ picker); YYYY-MM-DD / HH:MM / minute precision enforced by types + validation. |
| REQ-227–230, 232 | In-slice | Notification decisions; product name **Werefa** used on owner layout, public flow and status surfaces. |
| REQ-231 | N/A | Auto-resume recording belongs to the pause domain (N/A here). |

No in-slice requirement contradicts the implementation; no accidental extra
behavior was found (the only deviation—Keep on unaffected bookings—was
the spec-violating path fixed in §8).

## 12. UI action-safety audit

Re-derived from the component suite + Item 4 browser checks:

- Confirmed bookings expose exactly No Show / Cancel / Reschedule; Payment
  Pending expose Accept / Reject / cancel-pending; Rejected expose the release
  path + resubmission explanation; Completed / Cancelled / No Show expose
  nothing (each asserted).
- Reject requires a non-blank reason at the UI and store level; textarea has an
  accessible described-by hint (S22).
- Every destructive/terminal action is confirmed before it runs; the schedule
  editor warns about unsaved changes and saves store a pending version when
  paused.
- Reschedule only offers times that fit and are free; a failed reschedule
  leaves the occupant untouched.
- Viewing a detail page never mutates state or duplicates notices (asserted).
- Keyboard operability + focus management spot-checked in the browser (S22).

**Result: conforms; no changes required.**

## 13. Test-gap analysis and fixes applied

Gaps found by the audit that were closed this item (all low-risk, additive):

| Gap | Fix |
| --- | --- |
| Keep allowed on a non-affected booking (REQ-159) | Production hardening in `store.ts` + 2 store tests (`schedule.test.ts`). |
| Cross-tenant coverage only for accept/reject/cancel/no-show | +1 test (`lifecycle.test.ts`) covering reschedule, cancel-pending, release, resubmit, keep, scoped auto-complete, and **notification suppression** across tenants. |
| Idempotency only for accept/cancel/no-show/reschedule | +4 tests (`lifecycle.test.ts`) for reject, release, cancel-pending, resubmit; +1 keep double-action test (`schedule.test.ts`). |

No other genuine gaps were found: every §3–§11 criterion is either conforming
with existing tests or the §13 set above.

## 14. Changes this item

```
 frontend/src/mock/store.ts          |  15 +--   (keepBooking guard; helper removed)
 frontend/src/mock/lifecycle.test.ts | 138 ++++  (+5 tests)
 frontend/src/mock/schedule.test.ts  |  30 ++++  (+2 tests)
 frontend/qa-shot/*                  | refreshed at 375/430/1440 (list + detail)
```

- `docs/WEREFA-COMPLETE-SPECIFICATION.md` — **untouched**.
- No commits created.
- No new product decisions; the six unresolved decisions stay unresolved.

## 15. Verification (final, this item)

| Step | Command / scope | Result |
| ---- | --------------- | ------ |
| 1. Unit/feature tests ×3 | `npx vitest run` (frontend) | PASS — **15 files, 275 tests**, 0 failures each run (~19s each) |
| 2. Typecheck | `npx tsc --noEmit` (frontend) | PASS — 0 errors |
| 3. Lint | `npx eslint .` (frontend) | PASS — 0 errors |
| 4. Build | `npx vite build` (frontend) | PASS — 101 modules, `dist` written |
| 5. Browser regression | `qa-run.js` (Playwright, headless chromium, dev build) | PASS — **152/152** (S1–S24 + S90 console cleanliness), screenshots refreshed at 375/430/1440 |

Note: the browser re-run surfaced one environment artifact — the dev server
started before this session served a stale HMR module graph (a status-page
lookup returned an empty result for a known phone). After restarting Vite the
same flow returned the expected booking and the full campaign passed; no
defect in the product was involved.

## 16. Known limitations (documented, unchanged by this item)

- **Email notifications for affected bookings (REQ-094/096/097)** — no email
  channel exists in the frontend mock; owner-visible equivalent is the in-app
  conflict panel. Real delivery is backend/infra.
- **Owner-side Telegram proof verification (REQ-120)** — backend/infra
  (authorization + provisioning); dashboard proof review (REQ-119) is the mock
  equivalent.
- **Auth / security / lockout domain (REQ-191–206)** and **Admin / Super-Admin
  platform (REQ-167/168, 176–183)** — out of scope; the mock uses a demo owner
  session.
- **PDF exports (REQ-170–172)** — no export infra.
- **Reporting-module filters (actor, business, 30-day default; REQ-184–186)** —
  belong to the report/export domain, not the owner bookings queue; noted as
  N/A on this surface rather than implemented here.
- **Timezone (REQ-222/223)** — the mock uses the browser-local zone for
  `YYYY-MM-DD HH:MM` values; the authoritative global-zone concern remains an
  open spec item, consistent with prior reports.
- The six unresolved product decisions were not resolved; nothing in this item
  depends on them.

## 17. Boundaries honored

- Only the smallest targeted fix required by the audit was applied (§8); every
  other audit dimension was verified conforming without code change.
- No commit, no git history mutation, no `docs/WEREFA-COMPLETE-SPECIFICATION.md`
  edits.
- No backend/Postgres/Telegram/payment/file/auth/subscription work.
- No new payment or booking states; no customer-facing reference codes; no
  SMS/Twilio; no manual “Complete” button.
- Items 1–4 not redone; Item 4’s 152/152 campaign was re-run as regression
  against the single production change.

## 18. Final compliance statement

The Owner Booking Management vertical slice satisfies every requirement within
REQ-093…REQ-232 that applies to it, with no unaddressed contradiction and no
accidental extra behavior. The single gap the audit found (Keep Booking on a
non-affected booking) was hardened and is covered by new tests; every audit
dimension is either conforming with existing coverage or covered by the tests
added in §13. All four quality gates are green (275/275 ×3, `tsc`, `eslint`,
`vite build`) and the full Item-4 real-browser campaign re-passed 152/152.

## 19. Prompt 38 Item 5 complete; waiting for Product Owner approval before proceeding.