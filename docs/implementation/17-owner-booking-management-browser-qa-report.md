# 17 — Owner Booking Management Browser QA (Prompt 38, Item 4) — Completion Report

Status: **DONE** · Real-browser QA under Playwright + headless Chromium ·
**152/152 assertion checks passed** on the final run · **0 product defects** ·
**0 commits** created during this item.

This report closes out Prompt 38, Item 4: a comprehensive real-browser
verification of the Owner Booking Management feature (the list, filters,
sorting, and the full booking lifecycle + conflict resolution already shipped
by Items 1–3). Everything was exercised through the actual running app against
the app's own in-memory mock store. No production source file was changed
(verified `git status --porcelain` empty at the end of the item), and the
canonical product source of truth (`docs/WEREFA-COMPLETE-SPECIFICATION.md`)
was **not** touched.

## 1. Conformance summary

| Dimension | Result |
| --------- | ------ |
| Requirement coverage | Real-browser verification of the owner Bookings list (count/status summary, OR status pills incl. all six pressed, name/phone search, from/to date range incl. reversed-range empty result, combined AND filters, all six sort fields × both directions with deterministic tie-breaks, Reset-filters), the booking detail page (customer/note/appointment/payment/state sections, proof, history, accept/reject-with-validation/cancel/no-show/release/reschedule terminal guards, no manual Complete action), the reschedule hard availability gate, schedule-exception conflict + keep flow and its list badge / detail card / public availability effect, Telegram notice surfaces on both owner detail and customer status views (incl. customer-safe redaction), responsive overflow and screenshots, accessibility spot checks, and a multi-route regression smoke. |
| Partial | None. No targeted behavior remains partially verified within this item's scope. |
| Defects found | **0 product defects.** All 152 checks pass. The six-failure first run and the fixes that followed were **harness/selector defects only** (wrong locator semantics, an ISO-vs-formatted date assumption, a payload selector that only renders inside the wizard, an invalid `filter:` locator option, and two checks that assumed data the results summary does not contain). |
| Deferred (out of scope) | Prompt 38 Items 1/2/3 (delivered in prior sessions); the six unresolved product decisions recorded in the spec stay **unresolved** — this item asserts already-approved behavior only; backend/infrastructure work. |

## 2. Test environment

| Item | Value |
| ---- | ----- |
| Browser | Chromium 1243 (Playwright-managed `chrome-win64`, headless) via Playwright **1.63.0** for Node |
| Dev server | Vite at `http://localhost:5173` (served the unmodified frontend) |
| Viewports | **375 × 900**, **430 × 900**, **1440 × 900** (list + detail overflow and screenshots each) |
| Data stage | The app's own in-memory mock store, seeded **in the page context** through dynamic `import('/src/mock/store.ts')` (13 deterministic fixtures + the 2 demo bookings + 1 wizard-created booking = 16) |
| Script | `werefa-qa/qa-run.js` (node, CJS, Playwright) |

### 2.1 Critical harness finding (mock-store lifecycle)

The mock store is an in-memory browser singleton. A full page load (`page.goto`)
**wipes it**, so the QA script performs exactly one full load at the start and
then navigates client-side for the whole session:

- `spaGo(page, route)` = `history.pushState({}, '', route)` +
  `window.dispatchEvent(new PopStateEvent('popstate'))`, which drives the React
  Router without reloading, keeping store + state intact (proof-probed before
  the run: store booking count persisted across `/owner/bookings` →
  `/owner/schedule`).
- The final S24 regression smoke uses real `page.goto` loads because it is
  store-independent (static route rendering).

This is a QA-architecture property, **not** a product behavior.

## 3. Key fixtures

13 deterministic fixtures were seeded relative to the run date (2026-09-16),
on future weekdays that avoid the demo's blocked day (+5, a Monday), its
special closed day (+6, Tuesday), and the closed weekday (Sunday); **all
Mondays were excluded from the shared fixture pool** so the schedule-exception
booking (Meron, on Monday 2026-09-28) is the only user of that weekday,
making the conflict panel deterministic. Subset promoted directly in store for
density: Tigist and Abel → Confirmed; Henok → Rejected (with reason). Chaltu's
phone was connected to Telegram through the real customer-status UI before
being accepted. One extra booking (Liya) was created end-to-end through the
real public wizard.

## 4. Results, by QA section (final run)

| Section | Checks | Pass/Fail |
| ------- | ---- | --------- |
| S1 Fixture seeding + Telegram connect (real UI) | 2 | 2/2 |
| S2 Public wizard regression booking (real UI) | 2 | 2/2 |
| S3 Bookings list header & workspace | 5 | 5/5 |
| S4 Status filter pills (OR, all six pressed) | 13 | 13/13 |
| S5 Search (name, phone prefix, exact digits, no-match) | 5 | 5/5 |
| S6 Date range (from/to, reversed → empty, intact page) | 5 | 5/5 |
| S7 Combined filters (AND across categories) | 5 | 5/5 |
| S8 Sorting (6 fields × 2 directions, tie-breaks, long name) | 11 | 11/11 |
| S9 Reset filters | 6 | 6/6 |
| S10 No horizontal overflow (375/430/1440) | 3 | 3/3 |
| S11 List screenshots (375/430/1440) | 3 | 3/3 |
| S12 Card → detail routing (demo Confirmed) | 4 | 4/4 |
| S13 Detail — payment-pending surface (sections/actions) | 14 | 14/14 |
| S14 Reject validations + reject flow | 9 | 9/9 |
| S15 Accept flow + Telegram notices (connected) | 7 | 7/7 |
| S16 No-show flow (confirm step, terminal) | 3 | 3/3 |
| S17 Cancel flow (terminal) | 3 | 3/3 |
| S18 Release flow (slot freed) | 3 | 3/3 |
| S19 Reschedule + hard availability gate | 11 | 11/11 |
| S20 Schedule exception via real conflict → keep flow | 11 | 11/11 |
| S21 Customer status + Telegram surfaces (connected & not) | 4 | 4/4 |
| S22 Accessibility spot check | 8 | 8/8 |
| S23 Detail overflow + screenshots (375/430/1440) | 6 | 6/6 |
| S24 Regression smoke (6 routes + conflict/telegram) | 8 | 8/8 |
| S90 Console/error cleanliness | 1 | 1/1 |
| **Total** | **152** | **152/152** |

## 5. §23 completion-report items (27/27 verified)

1. **Browser and version** — Chromium 1243, Playwright 1.63.0, headless, on Windows 11 (win32).
2. **Viewports tested** — 375×900, 430×900, 1440×900 (each for list and detail).
3. **Bookings list renders** — title, workspace form, result summary (`role=status`, `aria-live`) with count pattern, 16 cards incl. long customer name.
4. **Status pills** — all seven pills present; All initially `aria-pressed`; OR multi-select; all six states pressed with no layout break; All clears and restores the full list.
5. **Customer search** — by name (1 result, name on the card), phone prefix (all match `+2519`), exact phone digits (1), and no-match → empty state with Reset CTA.
6. **Date range** — from+to inclusive; to-only; from-only; **reversed `from > to` → 0 results with empty state and intact page** (REQ-190).
7. **Combined filters** — status+search, status+date, date+search, status+date+search all narrow correctly (AND semantics).
8. **Sorting** — default date-time Newest first; all six fields (date-time, booking-id, customer, status, actor, payment-status) flip between the two directions; directions communicated via button `aria-label`; deterministic tie-breaking; round-trip in place.
9. **Reset filters** — clears pills (All only), search, dates, sort; restores the full result set and default order.
10. **Responsive list** — no horizontal overflow at 375/430/1440.
11. **List screenshots** — `bookings-375.png`, `bookings-430.png`, `bookings-1440.png`.
12. **Card → detail routing** — clicking a demo Confirmed card opens the right booking, the right ID (`bk-demo-confirmed`), with matching status/payment badges.
13. **Detail surface (payment-pending)** — customer name/phone/note, appointment with line items, payment method + proof, state section, history, and the action set (accept/reject/cancel-inline); **no manual Complete action anywhere**.
14. **Reject validation** — empty and whitespace-only reasons refused with the understandable error; a valid reason → Rejected + payment Rejected + reason persisted + UI updated without refresh + history grows; no Telegram notice for an unconnected customer.
15. **Accept flow** — Confirmed + payment Accepted; `booking-confirmed` notice recorded for a connected customer; owner detail shows Connected + the notice; no IDs/slug/phone leaked; UI updates without refresh.
16. **No-show** — confirm step prevents accidental action; terminal No Show offers no actions.
17. **Cancel** — terminal Cancelled, no actions, no Complete button.
18. **Release** — a rejected booking offers Release; release → Cancelled; the slot becomes bookable again.
19. **Reschedule + hard gate** — form opens showing the current appointment (formatted); picker starts empty; only free + fitting times offered (occupied time excluded — REQ-106); identity, Confirmed state and attached payment persist; appointment moves; UI updates without refresh; no Telegram reschedule notice (unconnected); history grows to 3.
20. **Schedule exception** — closing the exception weekday surfaces an unsaved-changes warning, a conflict panel listing the affected booking, the Keep flow records the Schedule Exception (reason + schedule version), keeps the appointment and Confirmed state, shows the list badge and detail card, and makes the weekday unselectable on the public page (rendered as a disabled date chip).
21. **Telegram (customer view)** — connected customer sees Connected, the notice history (type label "Booking confirmed" + message + timestamp); disconnected customer sees Not connected + Connect CTA with no inbox.
22. **Accessibility spot check** — result summary `role=status`; Tab moves focus (skip-link first); `:focus-visible` ring; pills operable by Enter; Reset reachable by keyboard; sort direction buttons labeled; rejection validation `aria-describedby` + readable error text.
23. **Responsive detail** — no horizontal overflow at 375/430/1440.
24. **Detail screenshots** — `detail-375.png`, `detail-430.png`, `detail-1440.png`.
25. **Regression smoke** — public booking page, public service list, customer status, business profile, service management, schedule management, schedule conflict panel, Telegram display.
26. **Console/error hygiene** — no page JS load errors or console errors (only the expected favicon 404, filtered).
27. **Quality gate + boundaries** — no production source changed (`git status --porcelain` empty at item end); the prior Item 3 gate (268 tests ×3, `tsc --noEmit`, `eslint .`, `vite build` all green) therefore still stands; zero commits; spec untouched; the six unresolved product decisions remain unresolved.

## 6. Defect classification (per Prompt 38 §21 classes A–F)

| Class | Found | Notes |
| ----- | ----- | ----- |
| A — Critical | 0 | — |
| B — Functional | 0 | — |
| C — Minor | 0 | — |
| D — Cosmetic/accessibility | 0 | — |
| E — Responsive/layout | 0 | no horizontal overflow on any viewport |
| F — Documentation/test | 0 product-side; 6 harness-only issues were identified and fixed in the QA script (selectors/assumptions), none in app code |

## 7. Harness fixes that produced the clean run

All were `qa-run.js` bugs found while driving the real app; the app itself never
required a fix:

1. `seedBooking` destructured `{ name, phone, dates }` but used `slug` → crash.
2. `page.goto` anywhere after seeding wiped the mock store → replaced with a
   `spaGo` (pushState + popstate) client-side navigation helper; exactly one
   full load at start.
3. Wizard customer-input locators assumed label-wrapped inputs; the `Field`
   renders label and input as siblings inside `.field` → use
   `.field:has-text("Your name") input`.
4. S4 read *all* `.booking-chip` per card (incl. payment badges) → read only the
   first chip per card.
5. S19 compared appointment text against the raw ISO date; the UI renders
   `formatDateLong` (e.g. "Fri, Sep 18 2026") → compare against the matching
   `Intl` label.
6. S5 assumed the results summary echoes the matched customer name (it does
   not; the card does) and used fixed 300 ms waits → polled summary until the
   expected count rendered and asserted the name from the card.
7. S20 selectors: `filter: { hasText }` is not a locator option (matches every
   row) → `{ hasText }`; exception booking date landed on the demo's blocked
   Monday and the seed silently no-opped → pick the second upcoming Monday and
   exclude Mondays from the shared fixture pool; the "Monday closed" public
   check requires entering the wizard (date chips only render after a service
   is chosen) → click through, then assert the Monday chip is disabled.
8. S21 customer-notice regex expected "Booking request received|Confirmed";
   seeded bookings have no such notice and the connected-customer message is
   "Your booking is confirmed." / type label "Booking confirmed" → updated.
9. S24 smoke waited for `.date-chip` on the landing page (never present there)
   → asserted the service list instead.

## 8. Boundaries honored

- No production source files were modified for this item (`git status --porcelain` empty).
- `docs/WEREFA-COMPLETE-SPECIFICATION.md` untouched; the six unresolved product decisions remain **unresolved**.
- Items 1/2/3 were not redone; behavior was verified, not changed.
- No backend or infrastructure work; **no commits created**.
- QA artifacts (script, screenshots, probes) live outside the repo in the temporary Playwright workspace; six screenshots referenced above are the deliverable captures.