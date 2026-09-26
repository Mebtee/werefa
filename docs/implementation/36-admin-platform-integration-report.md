# 36 — Real Admin Portal & Platform Administration Integration Report (Prompt 53; spec §20, §27.3, REQ-191 … REQ-206, REQ-217 … REQ-221)

> **Nature of this pass.** The platform-administration **backend** vertical (authentication/session,
> Super Admin emergency recovery, Admin-account lifecycle, forced logout, login-attempt security,
> security history, subscription review, schedule-version history) was already implemented and
> thoroughly tested in the committed tree (documented at reports #23/#24/#25/#35). Prompt 53 was
> therefore executed as an **audit + frontend build-out**, not a rebuild. The backend was left
> untouched; the missing **Admin/Super Admin frontend** — explicitly deferred by report #24 — was
> built against the existing routes, and the whole vertical was verified against the canonical
> specification. No product decision was invented and no existing behavior was duplicated.

## 1. Objective

Make the Admin/Super Admin administration surfaces real (frontend) over the already-real backend,
covering: Admin login and own security/activity history (REQ-202); subscription-proof review
(REQ-137); Super Admin platform security history (REQ-203) and audited security-record deletion
(REQ-205/206); Admin-account lifecycle (REQ-217), Admin password change (REQ-219) and forced logout
(REQ-220); and Super Admin emergency recovery (REQ-198–200) — preserving the exact approved
requirements and leaving unresolved product decisions untouched.

## 2. Starting specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`

## 3. Ending specification SHA-256

`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b` (re-hashed with `sha256sum` at
the end; unchanged).

## 4. Existing platform-administration backend audited

Audited in full before changing anything (no backend change was needed):

- **Auth/session:** `auth/controllers/auth.controller.ts`, `auth/controllers/admin.controller.ts`,
  `auth/controllers/recovery.controller.ts`, `auth/dto/auth.dto.ts`; `domain/services/auth.service.ts`,
  `domain/services/admin-management.service.ts`, `domain/services/recovery.service.ts`.
- **Authorization:** `domain/authorization/tenant-guard.ts` (`requireAdminOrSuperAdmin`,
  `requireSuperAdmin`), `domain/authorization/actor-context.ts` (`isAdminOrSuperAdmin`,
  `isSuperAdmin`).
- **Persistence:** `repositories/user-auth.repository.port.ts`, `session.repository.port.ts`,
  `security-event-auth.repository.port.ts`, `emergency-recovery.repository.port.ts`,
  `audit-event-auth.repository.port.ts` and their Prisma implementations (advisory-locked
  max-two-admin transaction; `updatePassword` clears lockout and revokes sessions).
- **Admin HTTP surfaces:** `api/admin/subscription.controller.ts` (proof queue + approve/reject),
  `api/admin/schedule.controller.ts` (`GET admin/businesses/:businessId/schedule/versions`).
- **Tests (real HTTP/DB):** `http-auth.db.spec.ts` (57), `http-auth.spec.ts` (16),
  `auth.db.spec.ts`, `http-api.db.spec.ts` (39) — login/logout for Super Admin/Owner/Admin, session
  principal, 5-failure→15-minute lockout (race-safe), password change + session invalidation + Admin
  self-reset 403, recovery (hashed/single-use/expired/attempt-cap/lockout-clear), admin management
  (list/create/max-2/duplicate/deactivate/reset/self-reset 403/deletion audited), forced logout,
  tenancy isolation, role gating, device first-use, secret hygiene.

## 5. Gap identified

The frontend had only `features/admin/SubscriptionReviewPage.tsx`; there was **no Admin shell,
dashboard, Admin-account management, platform security-history, or emergency-recovery UI**. Report #24
recorded this as an explicit deferral ("Admin and Super Admin frontends"). That is the sole gap this
pass closed.

## 6. Files changed

| File | Change |
| --- | --- |
| `frontend/src/api/types.ts` | Add `AdminUserView`, `SecurityEventView`, `CreateAdminRequest`, `ResetAdminPasswordRequest`, `RecoveryRequestInput`, `RecoveryConfirmInput`. |
| `frontend/src/api/admin.ts` | Extend with `listAdmins`, `createAdmin`, `deactivateAdmin`, `resetAdminPassword`, `forceLogoutUser`, `listPlatformSecurityHistory`, `deleteSecurityHistory`, `listScheduleVersions` (+ existing subscription functions). |
| `frontend/src/api/auth.ts` | Add `authApi.securityHistory()` (`GET /auth/security`). |
| `frontend/src/api/recovery.ts` | **New** `recoveryApi.requestCode` / `confirmReset`. |
| `frontend/src/features/auth/RequireSuperAdmin.tsx` | **New** Super-Admin route guard. |
| `frontend/src/features/admin/AdminLayout.tsx` | **New** role-aware administration shell. |
| `frontend/src/features/admin/AdminDashboardPage.tsx` | **New** navigational landing page. |
| `frontend/src/features/admin/AdminAccountsPage.tsx` | **New** Admin lifecycle (create/deactivate/reset/force-logout). |
| `frontend/src/features/admin/SecurityHistoryPage.tsx` | **New** own (Admin) / platform-wide (Super Admin) history + deletion. |
| `frontend/src/features/admin/RecoveryPage.tsx` | **New** Super Admin emergency recovery. |
| `frontend/src/routes/router.tsx` | Add nested `/admin` layout route tree with guards. |
| `frontend/src/features/auth/LoginPage.tsx` | Role-aware post-login redirect (Owner→`/owner`, Admin/Super Admin→`/admin`); removed the obsolete "not an owner account" block. |
| `frontend/src/styles/components.css` | Add the platform-administration style block. |
| `frontend/src/test/auth.tsx` | Add `SUPER_ADMIN_PRINCIPAL`, `AUTHENTICATED_SUPER_ADMIN`. |
| `frontend/src/api/admin.test.ts` | **New** wire-contract tests (11). |
| `frontend/src/features/admin/adminPortal.test.tsx` | **New** render/guard tests (12). |
| `frontend/src/test/adminPortalNoMock.test.ts` | **New** no-mock boundary tests (5). |

The pre-existing Prompt 52 modifications (`backend/*`, `frontend/src/features/owner-portal/*`) remain
uncommitted and were not touched by this prompt.

## 7. Admin vs Super Admin authorization model

Unchanged and enforced server-side: exactly **one Super Admin** and **two Admins**; the role set is
fixed (no new role). `RequireAdmin` admits `ADMIN`/`SUPER_ADMIN`; `RequireSuperAdmin` (nested) admits
only `SUPER_ADMIN`. Both guards are **UX gates only** — every backend route independently re-authorizes
(`requireAdminOrSuperAdmin` / `requireSuperAdmin`), so an Admin reaching a Super-Admin route still
receives 403. A Business Owner is redirected to login (unauthenticated) or shown an explicit
"Admin access only" screen (authenticated owner).

## 8. Admin login and session

The single `LoginPage` (`/owner/login`) posts to the real `POST /auth/login`; the session cookie is
HttpOnly and never touched by JavaScript. On success the page redirects by role: `OWNER` → the owner
portal, `ADMIN`/`SUPER_ADMIN` → `/admin`. Session restoration is owned by `AuthProvider`
(`GET /auth/session`). No credentials or roles are stored client-side; no role is ever sent to the
server.

## 9. Admin-account lifecycle (REQ-217/219)

`AdminAccountsPage` lists `GET /admin/admins` (with active-session counts), creates via
`POST /admin/admins`, deactivates via `DELETE /admin/admins/:id`, and resets passwords via
`POST /admin/admins/:id/password`. The exactly-two-active-Admin cap is enforced by the backend inside
an advisory-locked transaction; the page surfaces the count and renders the server's rejection (e.g.
409) rather than trusting a client-side rule. Force logout uses `POST /admin/users/:id/force-logout`
(REQ-220). An Admin cannot change their own password and cannot reach these routes.

## 10. Super Admin emergency recovery (REQ-198–200)

`RecoveryPage` calls `POST /auth/recovery/request` (generic success message — no account enumeration;
the one-time code is sent only to the separate recovery email and is never returned to the client) and
`POST /auth/recovery/confirm` (valid one-time code immediately permits a new password, revokes every
session and clears any lockout). Both calls use `handleUnauthorized: false` because they legitimately
operate outside a live session. The page is gated by `RequireSuperAdmin`.

## 11. Security/activity history (REQ-201/202/203/205/206)

`SecurityHistoryPage` shows an Admin **only their own** history via `GET /auth/security` (REQ-202) and
shows the Super Admin the **platform-wide** history via `GET /admin/security-history` (REQ-203). Only
the Super Admin sees the deletion control, which calls `DELETE /admin/security-history` with an
`olderThan` instant; the backend audits the deletion itself (REQ-206) and retention is one year
(REQ-204). Event type strings are rendered human-readably; no secret material is displayed.

## 12. Subscription-proof review (REQ-137)

The existing `SubscriptionReviewPage` continues to consume the real queue/approve/reject routes; it is
now reachable from the Admin shell and dashboard. No price value is displayed anywhere (see §27).

## 13. Schedule-version history (REQ-167)

`listScheduleVersions` consumes `GET /admin/businesses/:businessId/schedule/versions` (Super Admin,
read-only). The client function is implemented and contract-tested; a dedicated Super Admin browsing
UI for choosing a business was not added because no platform business-list endpoint exists (see §26).

## 14. Route tree and guards

`/admin` is a nested layout route: `RequireAdmin` wraps `AdminLayout`; children are index
(`AdminDashboardPage`), `subscriptions` (`SubscriptionReviewPage`), `security` (`SecurityHistoryPage`),
and `admins`/`recovery` each wrapped in `RequireSuperAdmin`. The shell hides Super-Admin-only nav
entries for an Admin; the guards and backend enforce the boundary regardless. Unauthenticated visitors
are redirected to `/owner/login` with a `from` state.

## 15. Frontend changes

New admin shell/dashboard/accounts/security/recovery pages; extended admin/auth/recovery API clients
and wire types; role-aware login redirect; admin styles; test fixtures. No existing owner or public
behavior was altered; the removed "not an owner account" login block is superseded by the role-based
redirect.

## 16. Mock code removed from production paths

No new mock removal was required: every production admin source calls the real typed API client
(`api/admin.ts`, `api/auth.ts`, `api/recovery.ts`) and none imports the `@/mock/*` seam. Test seams
(`test/fetch.ts`, `test/businessApi.ts`) remain test-only. No silent production fallback exists. This
is asserted mechanically by `adminPortalNoMock.test.ts`.

## 17. Security / authorization

All calls send `credentials: 'include'` and an `X-Request-Id`; no role, actor id, tenant id or password
is supplied by the client for authorization decisions. The server derives the actor from the session
cookie. Cross-tenant reads return 404. The recovery code is never returned to the client; security
history exposes only event metadata. Admin pages never log secrets.

## 18. Concurrency / idempotency

The client is a thin, non-authoritative layer: the max-two-admin cap, exactly-once proof approval,
single-use recovery codes and session revocation are all enforced by the existing backend
advisory-locked/guarded writes. The UI disables actions while in flight and refetches after each
mutation; a duplicate/retried request is rejected by the server rather than duplicated client-side.

## 19. Tests added

- `frontend/src/api/admin.test.ts` (**new**, 11): exact route/method/body for `listAdmins`,
  `createAdmin`, `deactivateAdmin`, `resetAdminPassword`, `forceLogoutUser`,
  `listPlatformSecurityHistory`, `deleteSecurityHistory`, `authApi.securityHistory`,
  `listScheduleVersions`, `recoveryApi.requestCode`, `recoveryApi.confirmReset`.
- `frontend/src/features/admin/adminPortal.test.tsx` (**new**, 12): unauthenticated redirect, owner
  "Admin access only", Admin blocked from Super-Admin route, Super Admin vs Admin dashboard sections,
  sign-out, Admin list/create/reset against the stubbed backend, own vs platform security history
  (including that the wrong endpoint is never called), recovery request+confirm, and role-based login
  redirect.
- `frontend/src/test/adminPortalNoMock.test.ts` (**new**, 5): production admin sources never import
  `@/mock/*`, use the real clients, and the router guards every admin route.

## 20. DB results

`npm run test:db` (real PostgreSQL 16, `RUN_DB_TESTS=true`): **345 passed / 22 files**, on **two
consecutive clean runs** (unchanged from report #35 — the backend was not modified in this pass).

## 21. Frontend results

`npx vitest run`: **458 passed / 38 files** (430/35 before this pass; +28 tests, +3 files). `npm run
typecheck`, `npm run lint`, `npm run build`: PASS.

## 22. Browser-QA results or documented harness limitation

Not run. The repository has **no Playwright/Cypress/Puppeteer harness** (consistent with reports
#28–#35). No large browser framework was added for this prompt. Deterministic seam-level tests
(real route tree + guards + stubbed `fetch` contract) were used instead.

## 23. Known limitations / deferred work

- **Super Admin booking status-history view (REQ-177) and the booking-history/schedule-history PDFs
  (REQ-178/170)** are **deferred**: there is no reporting/PDF infrastructure in the current tree and
  no Super Admin booking-history endpoint exists. They were not implemented or invented.
- A dedicated Super Admin business-browsing/schedule-history screen (REQ-167) is deferred pending a
  platform business-list endpoint; the schedule-version client call is implemented and tested.
- The email sender and reminder lead time remain out of scope (reports #34/#35).

## 24. Confirmation that no unresolved product decision was silently resolved

All six spec §46 items remain unresolved and untouched (subscription price, global timezone,
subscription-reminder lead time, owner booking-report PDF, owner "modify" scope, timezone-abbreviation
display). In particular, **no subscription price** is chosen, hardcoded or displayed, and the owner
booking-report PDF remains deferred. Prompt 38 Item 6 was not reconstructed.

## 25. Confirmation that the specification was not modified

The canonical specification was read-only throughout; the final full SHA-256 equals the checkpoint
`5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`.

## 26. Confirmation that no commit was made

No `git add`/`commit`/`amend`/`push`/`reset` was run. Git history is untouched (`HEAD` still
`18b15bf`); all Prompt 52 and Prompt 53 changes remain uncommitted in the working tree.

---

## Regression gate summary

| Layer | Command | Result |
| --- | --- | --- |
| Backend | `npm run typecheck` | PASS |
| Backend | `npm run lint` | PASS |
| Backend | `npm run build` | PASS |
| Backend | `npm test` (no DB) | **178 passed / 223 skipped** (34 files: 26 passed, 8 skipped) |
| Backend | `npm run test:db` | **345 passed / 22 files** × 2 consecutive clean runs |
| Frontend | `npx vitest run` | **458 passed / 38 files** |
| Frontend | `npm run typecheck` | PASS |
| Frontend | `npm run lint` | PASS |
| Frontend | `npm run build` | PASS |
| Spec | `docs/WEREFA-COMPLETE-SPECIFICATION.md` | unchanged |

## Close

- Task type: **audit + frontend build-out** of the existing platform-administration backend (not a
  rebuild; backend untouched).
- Gap closed: the deferred Admin/Super Admin frontend — shell, dashboard, Admin-account lifecycle,
  own/platform security history (+audited deletion), emergency recovery, role-aware login routing, all
  against the existing real routes.
- Deferred (unchanged): Super Admin booking status-history view and booking/schedule PDFs; platform
  business-list-driven schedule-history UI.
- Unresolved product decisions: **unchanged** (six §46 items; notably subscription price and
  owner booking-report PDF).
- **NO COMMIT MADE.**
