# 39 — Owner Subscription & Multi-Business Integration Report (Prompt 56; spec §16, §19, §23; REQ-013, REQ-023, REQ-125–REQ-141)

> **Nature of this pass.** The subscription backend, proof storage/review workflow, lifecycle
> derivation, booking gate, and owner HTTP routes already existed and were DB-tested. Prompt 56 was
> therefore executed as an **audit + frontend integration pass**, not a backend rebuild. The missing
> surface was a real selected-business context for multi-business owners, an owner subscription page,
> prominent lifecycle warnings, real proof upload/history, and deterministic route/tenant regression
> coverage. No payment processor, pricing decision, reminder schedule, or second lifecycle engine was
> introduced.

## 1. Objective

Make the owner subscription experience real and business-scoped end to end:

- load every business owned by the authenticated Owner;
- remember and validate one selected business per owner;
- require an explicit choice for multiple businesses;
- send zero-business owners through the existing onboarding route;
- keep services, bookings, subscription state, proof history, warnings, and outlet state isolated by
  the selected business;
- render the backend-derived lifecycle and `bookingsEnabled` projection without client-side
  recalculation;
- support manual bank-transfer proof upload with safe retry/idempotency semantics; and
- preserve owner access to existing business and booking data after expiration.

This covers REQ-013 and REQ-023 together with the owner-facing portion of REQ-125–REQ-141. Existing
backend responsibilities for REQ-135–REQ-140 (manual transfer, platform review, rejection reason,
reminders, and exactly-two-Admin notification fan-out) remain authoritative and unchanged.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (re-hashed with `sha256sum` at
the end; unchanged).

## 4. Existing backend audited

Audited before changing the frontend:

- `domain/lib/subscription-lifecycle.ts` remains the sole canonical lifecycle derivation.
- `domain/services/subscription.service.ts` owns reconciliation and the booking eligibility gate.
- `domain/services/subscription-billing.service.ts` owns owner views, proof persistence, idempotent
  submission, and approval/rejection behavior.
- `domain/repositories/local-proof-storage.ts` and `domain/lib/proof-file.ts` remain the proof
  validation/storage boundary.
- `api/owner/business.controller.ts` exposes the selected business's subscription GET/proof POST
  routes behind the existing ownership guard.
- `domain/services/booking.service.ts` and `domain/services/availability.service.ts` remain the
  authoritative new-booking gate.
- `api/http-subscription.db.spec.ts` already covers fresh trials, proof replay/cross-business key
  conflict, MIME/size validation, Admin review, concurrent approval, rejection, lifecycle gates, and
  approval-driven reopening.
- `api/subscription.ts` already targeted the real owner routes; it was retained rather than duplicated.

No backend source was changed in this pass.

## 5. Gaps identified and closed

1. The owner shell assumed a single business and did not provide a real selected-business context.
2. Operational owner data could be initialized from a mock business before the API loaded.
3. Switching businesses did not guarantee stale-request cancellation or an outlet remount.
4. There was no dedicated owner subscription route in the application route tree.
5. The old subscription card did not expose the full backend lifecycle, `bookingsEnabled`, selected
   business context, rejection reason, and proof history as one coherent owner workflow.
6. There was no prominent selected-business warning outside the subscription page.
7. Proof upload needed browser-compatible byte reading and stable retry-key behavior.
8. There was no deterministic frontend coverage for multi-business selection, tenant isolation,
   zero-business onboarding, lifecycle projections, or proof conflicts.
9. Full-gate verification exposed ancillary integration defects: incorrect owner route targets, a
   duplicate warning on the subscription page, a non-sanitized provider error display, a zero-business
   test-double fallback, and a payment-method label regression.

## 6. Files changed

| File | Change |
| --- | --- |
| `frontend/src/features/owner-portal/state/OwnerBusinessContext.ts` | **New** context value, owner-scoped storage-key helper, and context hooks. Keeping these exports outside the component file preserves Fast Refresh boundaries. |
| `frontend/src/features/owner-portal/state/OwnerBusinessProvider.tsx` | **New** real owned-business loader, abort handling, owner-change isolation, remembered-ID validation, singleton auto-selection, explicit multi-business selection, creation selection, and reload. |
| `frontend/src/features/owner-portal/state/useOwnedBusiness.ts` | Load services and bookings from real selected-business APIs; clear operational state on business change; ignore stale responses; surface provider errors as strings. |
| `frontend/src/features/owner-portal/components/OwnerLayout.tsx` | Add the active-business switcher/picker, zero-business redirect, correct owner/public links, sanitized load errors, selected-business outlet remount, subscription navigation, and global warning placement. |
| `frontend/src/features/owner-portal/components/SubscriptionWarning.tsx` | **New** selected-business warning for `TRIAL_GRACE`, `PAID_GRACE`, `EXPIRED`, and `NONE`; omitted on the dedicated subscription page to avoid duplication. |
| `frontend/src/features/owner-portal/pages/SubscriptionPage.tsx` | **New** `/owner/subscription` page bound to the currently selected owned business. |
| `frontend/src/features/owner-portal/components/SubscriptionCard.tsx` | Rebuild the owner card around the real projection: all lifecycle states, `bookingsEnabled`, proof upload/history/rejection, FileReader bytes, stable submission key, retry-safe errors, and immediate post-success proof display. |
| `frontend/src/features/owner-portal/lib/subscriptionPresentation.ts` | **New** shared lifecycle banner/date presentation used by both the full card and global warning. |
| `frontend/src/features/owner-portal/pages/DashboardPage.tsx` | Gate initial rendering on real operational loading and add the selected-business subscription shortcut. |
| `frontend/src/features/owner-portal/pages/ServiceEditorPage.tsx` | Prevent edit-mode output before the selected business is hydrated and surface its load error. |
| `frontend/src/features/owner-portal/pages/CreateBusinessPage.tsx` | Add the newly created business to the provider and select it before navigating to the dashboard. |
| `frontend/src/features/owner-portal/pages/BusinessProfilePage.tsx` | Use the real selected-business context while preserving the existing local branding-preview seam. |
| `frontend/src/features/owner-portal/pages/BookingDetailPage.tsx` | Restore the readable fallback payment-method label when a real business has no configured instruction. |
| `frontend/src/routes/router.tsx` | Add the owner subscription route inside the protected owner tree. |
| `frontend/src/styles/components.css` | Add responsive switcher, picker, warning, subscription status, upload, and proof-history presentation. |
| `frontend/src/api/business.mapper.ts` | Correct the UI default map provider to the actual `'osm'` model value. |
| `frontend/src/test/businessApi.ts` | Make an explicit empty owned-business list remain empty and add stateful selected-business creation/subscription/proof behavior. |
| `frontend/src/test/auth.tsx` | Add owner-specific selected-business persistence to the authenticated render harness. |
| `frontend/src/features/owner-portal/state/OwnerBusinessSelection.test.tsx` | **New** five-test selection/isolation/onboarding suite. |
| `frontend/src/features/owner-portal/pages/SubscriptionPage.test.tsx` | **New** 16-test lifecycle/warning/upload/rejection/size suite. |
| `frontend/src/api/subscription.test.ts` | **New** four-test real-route/tenant/idempotency/MIME/size contract suite. |
| `frontend/src/features/owner-portal/OwnerPortal.test.tsx` | Update owner route expectations for the real navigation targets. |
| `docs/implementation/39-owner-subscription-integration-report.md` | This report. |

## 7. Selected-business model (REQ-013, REQ-127)

`GET /owner/businesses` is the only source of the owned-business list. The provider stores the selected
ID under `werefa.owner.business.${principal.id}`, so two authenticated owners on the same browser do
not share selection state. On every load:

- an ID still present in the fresh backend list is retained;
- a stale/deleted remembered ID is removed;
- one business is selected automatically;
- multiple businesses require an explicit choice; and
- zero businesses redirect to `/owner/business/new` unless that route is already active.

`selectBusiness` only accepts an ID from the current owned list. `addBusiness` inserts/replaces a
server-returned business and selects it. No owner id is accepted from business-selection UI state.
The provider aborts an obsolete list request when the owner or a newer reload changes the active
request.

## 8. Operational tenant isolation

`useOwnedBusiness` no longer uses a mock primary business. It derives the business id and
authoritative profile from `OwnerBusinessContext`, then requests:

- `GET /owner/businesses/:id/services`
- `GET /owner/businesses/:id/bookings`

A request-generation token and effect cleanup invalidate responses from the previous selection. The
provider also remounts the owner outlet subtree with the selected business ID, preventing route-local
state from surviving a business switch. The subscription card, warning, dashboard shortcut, and public
page link all use that same selected ID.

The backend still enforces ownership. Frontend isolation improves correctness and prevents stale UI
state; it is not treated as an authorization boundary.

## 9. Lifecycle and booking projection (REQ-128–REQ-134, REQ-141)

The UI renders the backend's canonical status directly:

- `TRIAL`
- `TRIAL_GRACE`
- `ACTIVE`
- `PAID_GRACE`
- `EXPIRED`
- `NONE`

It separately renders `bookingsEnabled` and never derives that boolean from timestamps in the
browser. Grace, expiry, and paid-period boundaries therefore remain backend-owned. Expired owners stay
inside the owner workspace and retain dashboard, service, schedule, booking, customer, and business
data; the prominent warning remains visible until a backend projection reports renewed eligibility.
The public business page is not replaced or hidden by the owner UI.

## 10. Proof upload and idempotency (REQ-135–REQ-138)

The dedicated subscription page posts to the real business-scoped proof route. Client-side checks
accept BMP, GIF, JPEG, PNG, WebP, and PDF files no larger than 5 MB before reading them with
`FileReader`. The backend remains authoritative for size and magic-byte validation.

A cryptographically random `submissionKey` is generated for an attempt and retained across transient
read/network failures. Selecting a different file rotates the key; a successful submission rotates it
for the next independent attempt. Consequently:

- retrying the same selected file after an unknown response reuses the original key;
- a same-business replay returns the original proof rather than creating a duplicate;
- cross-business reuse remains a backend `409 IDEMPOTENCY_CONFLICT`; and
- a new file after success starts a new key.

After a successful POST, the returned proof is prepended immediately and the page does not require a
second GET to display success. The next normal load still reconciles from the backend. Upload errors
retain the current key and selected file so the owner can retry safely.

## 11. Security and authorization

Every subscription request is scoped to the selected business id and authorized by the backend's
existing HttpOnly session + ownership guard. The browser does not send or infer an owner id. The UI
never displays proof bytes, prices, or internal billing data not present in the safe backend
projection. Error text is converted through `toUserMessage` rather than rendered from arbitrary caught
values. No secret, access token, or proof content is logged or persisted.

The selection key contains the opaque authenticated principal id, not an email or private profile
field, and is removed when the remembered business is no longer valid.

## 12. Mock boundary

The selected-business, operational-data, subscription, warning, upload, and proof-history production
paths call real typed API clients. The new business API behavior exists only in
`frontend/src/test/businessApi.ts`.

The existing `BusinessProfilePage` branding adapter still imports `mock/ownerApi` for local media
preview because real persisted file storage is not part of this subscription pass. That seam does not
provide subscription, proof, lifecycle, service, or booking data.

## 13. Tests added / strengthened

- `OwnerBusinessSelection.test.tsx` (5): singleton auto-selection and persistence; valid remembered
  selection; stale-ID clearing with explicit multi-business choice; switcher/picker isolation and
  real per-business requests; zero-business onboarding followed by created-business selection.
- `SubscriptionPage.test.tsx` (16): backend lifecycle labels and booking projection; global warning
  behavior; supported proof upload/history; rejection reason/history; retry-key preservation; immediate
  success without a follow-up refresh; MIME and 5 MB limits; warning suppression on the full page.
- `subscription.test.ts` (4): exact real route/body; selected-business isolation; same-key replay and
  cross-business conflict propagation; supported MIME/size behavior.
- `OwnerPortal.test.tsx`: corrected owner route expectations.
- `businessApi.ts`: explicit zero-business behavior and stateful create/subscription/proof seam.

## 14. DB results

After starting and provisioning the repository's PostgreSQL 16 test container, `npm run test:db`
completed twice consecutively:

- Run 1: **346 passed / 22 files**
- Run 2: **346 passed / 22 files**

Both runs included the real subscription/proof HTTP suite. No backend source changed in this pass.

## 15. Frontend results

- `npm test -- --run`: **500 passed / 43 files** (previous checkpoint: 475/40; +25 tests, +3 files).
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS. Vite emitted the existing non-fatal single-chunk-size warning (520.70 kB
  before gzip); there were no build errors.

## 16. Browser-QA results or documented harness limitation

Not run. The repository has no Playwright, Cypress, Puppeteer, or other browser-test harness. No large
browser framework was added for this prompt. Deterministic tests use the real route tree, auth guard,
API client modules, and a stateful wire-contract test double.

## 17. Known limitations / deferred work

- The numeric subscription price remains `PENDING_CLARIFICATION`; this UI invents no amount.
- Subscription-reminder lead time remains unresolved; no reminder schedule or default was added.
- Payment remains manual bank-transfer proof only. No Stripe, PayPal, crypto, reconciliation, refund,
  or automatic processor was added.
- Email delivery infrastructure remains outside this pass; the frontend does not claim an email was
  sent.
- Real persisted brand-media storage remains deferred; the existing local branding-preview seam is
  unrelated to subscription data.
- No browser harness is available.
- The production frontend is a single Vite chunk above the warning threshold; this pass did not change
  the approved routing/build architecture to introduce code splitting.

## 18. Confirmation that no unresolved product decision was silently resolved

None. The six §46 decisions remain unresolved: subscription price, canonical timezone, reminder lead
time, owner booking-report PDF, owner “modify” scope, and timezone-abbreviation display. This pass
implemented only requirements already approved and the existing backend contract.

## 19. Confirmation that the specification was not modified

The canonical specification was read-only throughout. `git diff --exit-code` reported no change and
the final SHA-256 remained
`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 20. Confirmation that no commit was made

No `git add`, `commit`, `amend`, `push`, or `reset` was run. Git history remains at HEAD `18b15bf`;
all Prompt 33–56 work remains uncommitted in the working tree.

---

## Regression gate summary

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `npm test` (no DB) | **178 passed / 224 skipped** (34 files: 26 passed, 8 skipped) |
| Backend | `npm run test:db` | **346 passed / 22 files**, run twice consecutively |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS (`--max-warnings=0`) |
| Backend | `npm run build` | PASS |
| Frontend | `npm test -- --run` | **500 passed / 43 files** |
| Frontend | `npm run typecheck` | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` | PASS (non-fatal chunk-size warning) |
| Repository | `git diff --check` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged (`5494658e…ff00b`) |

## Close

- Task type: **audit + owner-subscription frontend integration + tenant-isolation hardening**.
- Backend authority preserved: lifecycle, booking eligibility, proof validation/storage,
  idempotency, and review rules were not reimplemented in the browser.
- Gaps closed: real selected-business context, owner-scoped persistence, stale-ID validation,
  multi-business picker/switcher, zero-business onboarding continuation, business-scoped operational
  loading, selected-business outlet remount, dedicated subscription route, full lifecycle/proof UI,
  warning behavior, and 25 focused regression tests.
- All final gates pass; both clean DB runs pass; the canonical specification is unchanged.
- **NO COMMIT MADE.**
