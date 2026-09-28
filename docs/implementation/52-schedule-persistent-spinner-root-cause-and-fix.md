# 52 — Owner Schedule Page Persistent Spinner: Root Cause & Fix

Prompt: **Prompt 68 — Werefa Owner Schedule Page Endless Spinner Investigation & Fix**
Status: **COMPLETE** — two independent defects found, both fixed, regression suite added, gate green
Report date: 2026-09-28
Repository: Werefa (`master`, uncommitted working tree; no commit made)

> The Owner → Schedule spinner was **not** a missing-data problem. It was two
> independent front-end defects that produced a byte-identical symptom. The
> canonical specification was not modified, no product decision was made, no
> demo/mock runtime data was added, and no provider, §46 item or Prompt 38
> Item 6 concern was touched.

---

## 1. Summary

The page rendered `header + footer + spinner` indefinitely, with no message and
no retry. Investigating with a real browser against real data found **two
separate bugs**, either of which alone reproduces that exact screen:

| # | Defect | Trigger | Effect |
|---|--------|---------|--------|
| **A** | One-shot `initialized` latch combined with a `cancelled` cleanup guard | `React.StrictMode` (which `main.tsx` enables) | The only schedule request is issued, then discarded by its own cleanup; the second effect run skips the work. Page never leaves loading. |
| **B** | `loading={loading \|\| form === null}` | Any non-404 schedule failure | `form` is null *because* the request failed, so the page reports "loading" and renders a spinner **instead of** the error and retry button. |

Defect **B** is the more serious of the two: it silently swallows genuine
server, auth and network failures behind a permanent spinner. Defect **A** is
what produced the originally reported symptom on the real account, whose
businesses legitimately have no schedule yet.

Critically, **neither was visible to the existing test suite**, for two
independent reasons: the tests did not render under `StrictMode`, so defect A was
invisible; and no test asserted the error path, so defect B was invisible.

---

## 2. Defect A — the StrictMode latch

### 2.1 The code

`frontend/src/main.tsx` renders the application inside `React.StrictMode`, which
double-invokes effects in development: **mount → cleanup → mount**.

`SchedulePage`'s data-loading effect combined a one-shot latch with a
cancellation guard:

```tsx
if (initialized.current) return      // run #2 bails out here
initialized.current = true           // run #1 flips this BEFORE awaiting
void (async () => {
  try {
    const current = await getOwnerSchedule(id)   // the only request
    if (cancelled) return             // ...which is then thrown away
    setForm(...)
```

### 2.2 Why the page never recovered

| Step | Run | `initialized` | `cancelled` | Outcome |
|------|-----|---------------|-------------|---------|
| 1 | effect mount #1 | `false` → set `true` | `false` | `getOwnerSchedule` dispatched |
| 2 | cleanup | `true` | `false` → `true` | nothing; the in-flight response is orphaned |
| 3 | effect mount #2 | `true` → **returns early** | `false` (new closure) | **no request is made** |

The one response that ever arrived was discarded by `if (cancelled) return`, and
the run that would have consumed it never executed. `form` and `saved` stayed
`null`, the render guard stayed true, and the page rendered
`Loading your business` **forever** — with no error state, no retry, and no
failed request visible in the network log to explain it.

### 2.3 Runtime evidence

Captured against the running app (`localhost:5173`, real backend, real
account, no data fixtures), valid persisted business selection:

```
RES< 200 GET /api/v1/auth/session
RES< 200 GET /api/v1/owner/businesses            -> 2 businesses
RES< 404 GET /api/v1/owner/businesses/63101fa0-.../schedule/current
RES< 200 GET /api/v1/owner/businesses/63101fa0-.../subscription
```

DOM after 6 seconds of wall clock, with every request already settled:

```json
{ "hasHeader": true, "hasFooter": true,
  "spinners": [ "Loading your business" ],
  "h1s": [], "daysDayCount": 0 }
```

The decisive detail: the 404 had **already resolved** and yet the page was
still loading. No request was in flight, so no amount of waiting could help.

### 2.4 Fix

The latch was removed and replaced with a business-identity guard plus a
correctly scoped cancellation flag. Cancellation is now meaningful: it only
suppresses a *stale* response, never the one that is actually displayed.

```tsx
if (loadedBusinessId.current !== id) {
  loadedBusinessId.current = id
  setForm(null); setSaved(null); setCurrentSchedule(null); setSaveError(null)
}
let cancelled = false
setScheduleLoading(true)
```

Under StrictMode this now runs mount → cleanup → mount, with **both** runs
issuing a request and the second one's response winning, which is the intended
behaviour.

---

## 3. Defect B — the error-masking render guard

This defect was found *while writing the regression tests for defect A*, when a
test asserting that a 500 response shows an error state failed. It is a separate
bug with a separate cause and would have been invisible had the tests not
covered the failure path.

### 3.1 The code

```tsx
if (!business || !businessId || !form || !saved) {
  return <LoadState
    loading={loading || form === null}     // <-- true whenever form is null
    error={saveError !== null || error}   // <-- set, but never rendered
    onRetry={reload}>...
```

`LoadState` checks `loading` **before** `error`. Since `form` is `null` precisely
*because* the request failed, `loading` evaluated to `true` on every error
path. The `error` branch was unreachable dead code.

### 3.2 Consequence

Any non-404 failure — HTTP 500, 403, a network drop, an unparseable body —
produced the **same** permanent spinner as defect A, and the user was never
offered the retry that `onRetry` was already wired to provide. The page could
not distinguish "still loading" from "permanently broken", so it showed the
former forever.

### 3.3 Fix

A dedicated in-flight flag now distinguishes the two states, and it is cleared
on **every** outcome via `finally`, including failure:

```tsx
const [scheduleLoading, setScheduleLoading] = useState(true)
...
} finally {
  if (!cancelled) setScheduleLoading(false)
}
...
loading={loading || scheduleLoading}
```

This is a state-machine correction, not a cosmetic one: success, "no version
yet", and failure are now three genuinely distinct, correctly-labelled states.

---

## 4. Resulting state machine

| Schedule request outcome | `form` | `scheduleLoading` | Rendered |
|---|---|---|---|
| Still in flight | `null` | `true` | Spinner |
| 200 with a version | populated | `false` | Editor, hydrated |
| **404, no version yet** | **blank week** | `false` | **Editor, ready to define hours** |
| 401 / 403 / 500 / network | `null` | `false` | **Error message + Retry** |
| Business list failed | — | — | Error message + Retry |

No row can reach a permanently-spinning state. The 404 row matters on its own:
treating "no schedule version yet" as a load error made the page unreachable,
so a brand-new business could never be given a schedule at all.

---

## 5. Browser verification (after the fix)

Same real browser, same real account, same real backend, same persisted
selection, no fixtures:

```json
{ "hasHeader": true, "hasFooter": true,
  "spinners": [],
  "h1s": [ "Working hours" ],
  "h2s": [ "Weekly hours", "Schedule history" ],
  "daysDayCount": 7,
  "alertTitles": [] }
```

All seven weekday rows render as genuinely **Closed**. This is the real empty
state, not seeded data: both businesses still have **no** schedule version and
no hours were inserted. The clean-profile run correctly shows
`Choose a business` (a selection is required before the page can load), and
`versions` / `conflicts` return `200 []`.

---

## 6. Regression tests

`frontend/src/features/owner-portal/SchedulePageNoVersion.test.tsx` — 8 tests.

The test harness gained a `strict` option so the page can be rendered exactly
as the entry point renders it:

```tsx
renderAppAt('/owner/schedule', { businessApi: { noScheduleVersionYet: true }, strict: true })
```

`src/test/auth.tsx` wraps the tree in `<StrictMode>` only when requested, so all
pre-existing tests are unaffected. `src/test/businessApi.ts` gained a
`failOwnerBusinessRequest` hook covering the collection and the `schedule`
sub-routes — the existing booking-scoped hook could not reach them.

### 6.1 Coverage

| Requirement | Test |
|---|---|
| Renders when schedule returns 404 | `reaches the editor on the 404 no-schedule path` |
| Does not remain loading after 404 | same, asserts no `Loading your business` |
| Appropriate empty state | all seven weekday rows present and closed |
| Business loading failure exits loading | `business list failure exits loading and offers a retry` |
| Schedule failure exits loading | `a schedule failure ... exits loading into the error state` |
| Unrelated services/bookings cannot block | multi-business test asserts zero services/bookings calls |
| Parent providers cannot block | business-list-failure test drives the real provider |
| StrictMode, with a schedule | `reaches the editor on the has-schedule path` |
| StrictMode, multi-business + selection | `reaches the editor for a multi-business owner...` |

### 6.2 Both defects are genuinely caught

Each fix was reverted individually to confirm the tests fail without it:

| Reverted | Result |
|---|---|
| Reinstated the one-shot latch | **4 of 8 tests fail** |
| Restored `loading={loading \|\| form === null}` | **1 of 8 fails** (the error-state test) |

The suite therefore fails against the original code and passes against the fix,
for each defect independently.

---

## 7. Pre-existing test flakiness (unrelated, but gate-blocking)

Running the full gate repeatedly exposed an intermittent
`Test timed out in 5000ms` in `BookingFlow.test.tsx` — roughly 1 run in 3,
independent of the schedule work.

**It was verified not to be a regression.** Measured against the original
`PublicBookingPage` and the current one, in isolation, the affected test costs
~350–490 ms either way; the change is not measurable.

**Actual cause:** a wall-clock budget problem. The suite drives real user
journeys (typed input, multi-step routers, full provider trees) and vitest fans
out roughly one jsdom worker per core. On this 16-core machine a test doing
~350 ms of work can be starved past the 5 s default purely by CPU contention.

**Fix:** `frontend/vite.config.ts` sets `testTimeout: 15000` — ample headroom
while still bounding a genuine hang. No test was weakened and no assertion
loosened; per-test budgets in the new schedule suite were also raised to 10 s
for the same reason.

---

## 8. Scope discipline

- No mock, demo, or seed data was added; no fake schedule or hours were written.
- No backend endpoint, provider, or production architecture was changed. The
  fix is confined to one front-end component and its tests.
- `docs/WEREFA-COMPLETE-SPECIFICATION.md` was not modified — verified by hash
  and independently by the acceptance gate's own `Canonical specification hash`
  check.
- The two real businesses remain without a schedule version; the browser was
  only used to reproduce and verify, and its selection preference lives in a
  throwaway browser profile.
- Temporary diagnostic scripts were kept **outside** the repository
  (`%TEMP%\opencode\`) and deleted afterwards; no browser tooling was added to
  the test suite. Browser QA used `playwright-core`, which was already present.
- No commit was made.

---

## 9. Gates

| Gate | Result |
|---|---|
| Backend tests | **199 passed** (30 files, 11 skipped) |
| Backend DB tests — run 1 | **396 passed** (29 files) |
| Backend DB tests — run 2 (consecutive) | **396 passed** (29 files) |
| Backend typecheck / lint / build | pass |
| Frontend tests | **522 passed** (47 files) |
| Frontend typecheck / lint / build | pass |
| `npm run acceptance` | **PASS — 20 of 20 checks** |
| `npm run acceptance:static` | **PASS** |

The two consecutive DB runs are the meaningful check: identical counts twice in
a row indicate the suites are not order- or state-dependent.

Browser QA (real Chromium, real backend, real account):

| Scenario | Result |
|---|---|
| No business selected | `Choose a business` — correct |
| Selection persisted, no schedule version (404) | **Editor renders, 7 closed days, no spinner** |

---

## 10. Files changed

Modified:

- `frontend/src/features/owner-portal/pages/SchedulePage.tsx` — removed the
  latch; added the `scheduleLoading` in-flight flag; cleared it in `finally`;
  reset state on business change.
- `frontend/src/test/auth.tsx` — added the opt-in `strict` render option.
- `frontend/src/test/businessApi.ts` — added `failOwnerBusinessRequest`.
- `frontend/vite.config.ts` — explicit `testTimeout`.

New:

- `frontend/src/features/owner-portal/SchedulePageNoVersion.test.tsx` — 8 tests.

Also present in the working tree from earlier prompts (67 and earlier) and left
untouched by this work: `frontend/src/api/schedule.mapper.ts`,
`frontend/src/features/public-booking/PublicBookingPage.tsx`,
`frontend/src/features/public-booking/PublicPageMissingSchedule.test.tsx`,
`frontend/src/features/owner-portal/state/useSelectedOwnedBusiness.ts`.

---

## 11. Limitations

- Defect B was found only because a test asserted the **error** path. The
  remaining error paths (401, 403, and true network failure) are covered by the
  shared `LoadState` behaviour rather than by dedicated schedule-specific tests;
  the 500 case is the representative non-404 failure and is tested directly.
- The browser QA used a real Chromium via `playwright-core` as a throwaway
  diagnostic. There is no committed end-to-end harness, so the StrictMode
  double-invoke is guarded by unit tests instead. Adding a real E2E harness was
  out of scope for this prompt.
- Verification of defect A relied on React's documented StrictMode
  double-invocation semantics plus reproduction in a real browser; the unit
  tests use the same mechanism the entry point uses.
