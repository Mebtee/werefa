# Implementation Report 24 — Frontend API Foundation & Real Owner Authentication

Prompt 44: replace the frontend's mock Owner authentication with real
authentication against the Prompt 43 backend, and introduce a centralized,
production-shaped HTTP API client that every future frontend integration
(business, services, schedule, bookings, customers, payments, subscriptions,
Telegram) will build on — without migrating any of those domains yet.

The authoritative spec (`docs/WEREFA-COMPLETE-SPECIFICATION.md`) is byte-unchanged
(`sha256 5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`).

---

## 1. Objective

Prompt 43 delivered a real backend authentication/authorization/security layer
(Report 23). The frontend, however, still authenticated against a local mock
(`src/mock/ownerSession.ts`) and had no API client at all — every screen rendered
synthetic data. Prompt 44 begins the frontend-backend integration with the
smallest coherent, production-shaped slice:

- a centralized, typed, testable HTTP client (base URL resolution, request id,
  credentialed requests, normalized errors);
- real Owner sign-in / sign-out / session restoration against the backend;
- Owner-only route protection;
- a strict mock boundary so that domain data may still be mocked while
  authentication is real;
- one minimal backend addition (`GET /api/v1/auth/session`) and CORS configuration
  so the browser can talk to the backend with cookies;
- proof via unit/component tests, backend tests, and real-browser QA.

Not in scope (explicitly deferred): migrating business/service/schedule/booking/
customer/payment/Telegram/subscription APIs to the real backend; Admin and Super
Admin frontends; any change to the public unauthenticated customer booking flow;
any Owner Portal redesign.

## 2. Scope Boundaries Honored

- No domain API migration: only `auth` is wired to HTTP.
- No Admin / Super Admin frontend surfaces were built.
- The public customer booking flow remains unauthenticated and unchanged.
- The Owner Portal layout/design is unchanged except the session section
  (real principal + Sign out) and copy clarifying sample data vs. real session.
- The backend diff is limited to one new read-only endpoint plus tests; no
  Prompt 43 behavior was altered.

## 3. Backend Contract Consumed

From Prompt 43 (unchanged):

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/v1/auth/login` | 200 `{ expiresAt, user: { id, role } }` + `werefa_session` cookie |
| `POST` | `/api/v1/auth/logout` | idempotent 204, clears cookie |
| `POST` | `/api/v1/auth/password/change` | invalidates sessions |
| `GET` | `/api/v1/auth/security` | self security history |

Added in Prompt 44 (the only backend code change):

| Method | Path | Guard | Response |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/session` | `ApiAuthGuard` | `{ user: { id, role, email } \| null }` |

Rationale: the session cookie is persistent (`maxAge = ttlHours * 3600 * 1000`,
default 12h), so a returning Owner must be able to discover their principal on
boot. Without a principal-read endpoint the frontend would have had to persist
identity client-side, which would be both spoofable and a stale-role risk.
`GET /auth/session` keeps the backend authoritative: the frontend never decides
its own role.

## 4. Session Principal Endpoint (`principalFor`)

- `backend/src/domain/services/auth.service.ts` exports
  `SessionPrincipal { id: string; role: UserRole; email: string }` and
  `principalFor(actor): Promise<SessionPrincipal | null>`.
- It returns `null` unless the resolved actor is `OWNER`/`ADMIN`/`SUPER_ADMIN`
  (Customers never authenticate) and the user still exists and is not deactivated.
- `backend/src/auth/controllers/auth.controller.ts` adds
  `@Get('session') @UseGuards(ApiAuthGuard)` returning `{ user }`, so an expired,
  revoked or absent cookie yields the guard's standard `401` envelope.
- Because the guard re-resolves the user through the same path used by all other
  authenticated endpoints, role/tenant changes and deactivation take effect
  immediately, with no client cache to invalidate.

## 5. Frontend API Client Architecture

New directory `frontend/src/api/`:

- `config.ts` — `DEVELOPMENT_API_BASE_URL = 'http://localhost:3000/api/v1'` and
  `resolveApiBaseUrl(raw, isDev)`. Trims trailing slashes; falls back to the dev
  URL only in development; in production an unset `VITE_API_BASE_URL` throws
  lazily at first request rather than silently calling localhost.
- `types.ts` — `AuthRole`, `AuthPrincipal`, `LoginRequest`, `LoginResponse`,
  `SessionResponse`, `ChangePasswordRequest`.
- `errors.ts` — `ApiError` with a closed `ApiErrorKind`
  (`network | validation | authentication | forbidden | locked | not-found |
  conflict | rate-limited | server | unknown`), `ApiError.network`,
  `ApiError.fromResponse` (maps the `{ error: { code, title, detail, fields } }`
  envelope plus HTTP status), and `isApiError`, `isAuthenticationError`,
  `toUserMessage`, `toFieldErrors`.
- `http.ts` — `apiRequest`: base-URL join, `credentials: 'include'`, a generated
  `X-Request-Id`, JSON handling, `204` short-circuit, envelope parsing, and a
  global `401` handler (`setUnauthorizedHandler`) that can be suppressed per
  request (`handleUnauthorized: false` — used by the login and session calls).
  A `fetchImpl` option is the test seam.
- `auth.ts` — `authApi.login/logout/session/changePassword`; the only module that
  knows auth URLs.

## 6. Environment Configuration

- `frontend/.env.example` documents the single variable `VITE_API_BASE_URL`.
- `frontend/src/vite-env.d.ts` types it (`VITE_API_BASE_URL?: string`).
- Only public, non-secret values are exposed to the bundle. No backend secret,
  token or password is ever read into `VITE_*`.
- `frontend` production build succeeds with the variable unset; the failure mode
  is a clear runtime error on the first API request, which is intentional (fail
  loud, never ship a localhost default to production).

## 7. Auth State Machine

`frontend/src/features/auth/`:

- `auth-context.ts` — non-component module (satisfies
  `react-refresh/only-export-components`) exposing `AuthStatus`
  (`loading | unauthenticated | authenticating | authenticated | error`),
  `AuthState`, `AuthCredentials`, `AuthContextValue`, `AuthContext`.
- `AuthProvider.tsx` — owns the state machine:
  - **bootstrap** (`refresh`): `GET /auth/session`; `200` → authenticated
    principal, `401` → unauthenticated, any other failure (network/5xx) →
    `error` with a message — which the guard still treats as "not
    authenticated", so access is denied;
  - **login**: sets `authenticating`, calls `authApi.login`, then sets the
    principal from the backend `{ id, role }` plus the normalized email from the
    submitted credentials (the login response intentionally carries no email); a
    failure yields `error` with a single generic message. It does **not** re-call
    `/auth/session` (the cookie is already established);
  - **logout**: `authApi.logout`, clears local state even if the call fails;
  - registers/clears the global `401` handler so a mid-session expiry flips the
    app to unauthenticated and the guard redirects.
- `useAuth.ts` — context hook.
- `RequireOwner.tsx` — `AuthLoadingScreen`, `OwnerForbidden`, and `RequireOwner`.
  `loading`/`authenticating` render the loading screen; any other non-
  `authenticated` status (including `error`) redirects to `/owner/login`.
- `LoginPage.tsx` — email/password form with local validation
  (`EMAIL_PATTERN`), a single generic error alert for all credential failures
  (no account enumeration), and no social sign-in (REQ-025).

## 8. Login / Logout User Experience

- `/owner/login` renders an accessible card (`<h1>Owner sign in</h1>`,
  labelled `email`/`password` inputs with correct `autoComplete`, a submit
  button) inside the existing Werefa visual language.
- Invalid credentials produce one generic message —
  "Your email or password is incorrect." — regardless of whether the account
  exists, is locked, or the password is wrong (the locked/rate-limited codes are
  still mapped to specific kinds for future, deliberate copy). The failure is
  stored as an `error` status with the message shown in the danger alert; the
  form remains usable so the user can retry.
- Successful login navigates to `/owner` (or to the originally requested
  `/owner*` path via router state, restricted to `/owner` prefixes to avoid any
  open redirect).
- Sign out is available in the Owner layout session section and returns the user
  to `/owner/login`.

## 9. Route Protection

- `frontend/src/routes/router.tsx` adds `/owner/login` and wraps `/owner` in
  `<RequireOwner><OwnerLayoutApp/></RequireOwner>`.
- While `AuthStatus` is `loading` or `authenticating` the guard renders
  `AuthLoadingScreen` (no flash of the login form for an already-authenticated
  returning Owner, and no flash of protected content for an anonymous one).
- Authenticated non-Owner roles (Admin / Super Admin) see `OwnerForbidden`
  rather than the Owner Portal; the backend independently authorizes every
  Owner endpoint, so the guard is UX-only, never a security boundary.

## 10. Global 401 Handling

- `setUnauthorizedHandler` is registered by `AuthProvider`; any API call that
  returns `401` (and does not opt out) flips auth state to unauthenticated.
- The login and session calls opt out, because a `401` there is an expected
  outcome rather than an expired-session signal.
- The handler fails closed: on flip the guard redirects to `/owner/login`, and a
  bootstrap `error` status (network/5xx) is likewise treated as "not
  authenticated" rather than being rendered as an authorized session.

## 11. Mock Boundary

Requirement: authentication must be real, but domain data may remain synthetic
until later prompts.

- Deleted `frontend/src/mock/ownerSession.ts` (the mock auth/session source).
- Added `frontend/src/mock/ownedBusinessFixture.ts` with
  `MOCK_OWNER_ACTOR_NAME = 'Demo Owner'` and
  `getMockOwnedBusinessSlug` / `setMockOwnedBusinessSlug` /
  `resetMockOwnedBusinessSlug`, so the mock domain layer keeps an owned-business
  fixture without carrying any notion of a session.
- Updated `mock/ownerApi.ts` and `mock/store.ts` to use the fixture.
- `frontend/src/features/auth/mockBoundary.test.tsx` asserts both at runtime and
  by scanning the source tree that no module imports `mock/ownerSession` and
  that the file no longer exists.

## 12. Owner Portal Integration

- `OwnerLayout.tsx` now reads the real principal from `useAuth` (email display,
  "Owner" role badge) and renders a Sign out action; the mock owned-business slug
  still comes from `ownedBusinessFixture`.
- Footer copy is updated to distinguish the real session from sample data.
- The three Owner test harnesses (`OwnerPortal.test.tsx`,
  `BookingManagement.test.tsx`, `BookingsPage.test.tsx`) now render through the
  shared `renderAppAt` helper (real `AuthProvider` + router), and the previous
  `'Demo session'` assertion was replaced with the real principal email.

## 13. Tests — Frontend

New/updated suites (19 files total, 311 tests):

- `frontend/src/api/http.test.ts` — 15 tests: URL join/base resolution, request
  id header, `credentials: 'include'`, `204`, error-envelope → `ApiError`
  mapping, network failure → `kind === 'network'`, global vs. suppressed `401`.
- `frontend/src/features/auth/AuthProvider.test.tsx` — 7 tests: bootstrap
  authenticated/unauthenticated/network-failure, login success (no session
  re-fetch), login failure, logout clearing state, 401 flip.
- `frontend/src/features/auth/routeProtection.test.tsx` — 10 tests: loading
  state, redirect to `/owner/login`, return-to path, authenticated owner renders
  the portal, Admin/Super Admin forbidden, redirect after login/logout.
- `frontend/src/features/auth/mockBoundary.test.tsx` — 4 tests: fixture behavior,
  source-tree scan for `mock/ownerSession`, module-absence assertion, auth
  modules contain no mock-session imports.
- Helpers: `frontend/src/test/auth.tsx` (`OWNER_PRINCIPAL`, `ADMIN_PRINCIPAL`,
  `AUTHENTICATED_OWNER`, `AUTHENTICATED_ADMIN`, `UNAUTHENTICATED`,
  `renderAppAt`) and `frontend/src/test/fetch.ts` (`installFetchStub` matching by
  `String(url).includes(path)`, unmatched requests → a `404` envelope).

## 14. Tests — Backend

- `backend/src/api/http-auth.spec.ts` — added the `/auth/session` `401` contract
  and a `CORS origin policy (Prompt 44)` describe (4 tests):
  - allowed origin preflight echoes the origin and allows credentials +
    `X-Request-Id`;
  - a real credentialed `401` response carries the CORS headers;
  - an unknown origin is not echoed;
  - no CORS headers are emitted when no origin is configured.
- `backend/src/api/http-auth.db.spec.ts` — added a `SESSION principal` describe
  (4 DB-gated tests): Owner principal shape `{ id, role, email }`, `401` without
  a cookie, Super Admin role surfaced, revoked session → `401`.

## 15. CORS / Cookie Configuration

- Backend default remains "CORS disabled" (`corsOrigins` default `''`). CORS is
  enabled only when origins are configured, then with an explicit allowlist,
  `credentials: true`, `allowedHeaders: ['Content-Type', 'X-Request-Id',
  'X-Requested-With']` and `exposedHeaders: ['X-Request-Id']` — never a wildcard
  (a wildcard is incompatible with credentialed requests).
- Local `backend/.env` (gitignored) sets
  `CORS_ORIGINS=http://localhost:5173`.
- The session cookie is httpOnly, `SameSite=Lax`, and `Secure` only in
  production, so JavaScript can never read the token and it is not sent on
  cross-site subrequests.

## 16. Security Review

- **No credential persistence in the client.** The session is an httpOnly cookie;
  the frontend stores only an in-memory principal and never writes tokens or
  passwords to `localStorage`, `sessionStorage`, cookies or logs.
- **Role is server-authoritative.** The client role comes from the login/session
  responses; the frontend cannot mint an Owner.
- **No enumeration.** A single generic message covers unknown account, wrong
  password and lockout; the underlying codes are retained only for future,
  deliberate copy.
- **No open redirect.** Post-login redirects accept only paths beginning with
  `/owner` and are applied via router navigation, not `window.location`.
- **Fail closed.** Bootstrap network errors and any unsuppressed `401` result in
  unauthenticated state; protected UI is never shown optimistically.
- **Secret hygiene.** Only `VITE_API_BASE_URL` is exposed to the bundle; no
  backend secret is referenced by frontend code.
- **No new injection surface.** No `dangerouslySetInnerHTML` or dynamic HTML was
  introduced; React escaping remains in force.
- **Least-privilege backend diff.** The new endpoint is read-only and guarded; it
  re-queries the user so deactivated/role-changed accounts are honored on every
  request.

Residual/known considerations (documented, not defects of this prompt): CSRF
relies on `SameSite=Lax` plus the strict CORS allowlist rather than a CSRF token
(a token remains future work should a same-site subdomain deployment be
introduced); production must set `VITE_API_BASE_URL` and the backend
`CORS_ORIGINS` to the deployed origin.

## 17. Accessibility

- The login page uses a real `<h1>`, a `<form>` with a submit button, labelled
  inputs, and `autoComplete="email"` / `autoComplete="current-password"`.
- The error alert is announced via `role="alert"`.
- The Owner navigation retains its `aria-label="Owner portal"` landmark.
- Focus moves to the form on navigation to `/owner/login`; the loading screen
  exposes a status role rather than a blank page.

## 18. Responsive Verification

Real-browser QA (Playwright, headless Chromium) at three viewports —
desktop 1440, mobile 430, mobile 375 — confirmed:

- the guard redirects `/owner` → `/owner/login`;
- a wrong password shows the generic danger alert;
- correct credentials reach the Owner dashboard (`nav[aria-label="Owner portal"]`,
  page title "Dashboard", session email `qa-owner@werefa.test`);
- Sign out returns to `/owner/login`;
- the public page (`/p/addis-beauty-lounge`) shows no login affordance.

An additional layout probe confirmed **zero horizontal overflow**
(`scrollWidth - innerWidth === 0`) and all key controls visible at all three
viewports, on both the login page and the dashboard.

The only console noise observed was the expected barrage of `401`s from the
unauthenticated session probe and the wrong-password attempt (plus a favicon
`404`); no unexpected errors were raised.

## 19. Browser QA Method

- Backend: built `dist` served with `npm run start:prod` on `:3000` against
  `werefa_dev`; frontend: `npm run dev -- --port 5173 --strictPort`.
- A seeded Owner (`qa-owner@werefa.test` / `QaOwner-Pass-2030`) was created via a
  temporary script in `werefa_dev`.
- Scripts (`qa-auth.cjs`, `qa-layout.cjs`) live under
  `C:\Users\Tame\AppData\Local\Temp\opencode\` (outside the repo) and drive
  headless Chromium via `playwright-core`.
- Screenshots were written to `frontend/qa-shot/prompt44-*.png`
  (login, login-error, dashboard, public — each at desktop-1440, mobile-430,
  mobile-375).

## 20. Verification Commands

Frontend (in `frontend/`):

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — success (110 modules; ~467 kB JS / ~41 kB CSS).
- `npx vitest run` — **19 files, 310 passed / 1 failed**; the single failure is
  the pre-existing `OwnerPortal.test.tsx` schedule-conflict failure (see §21).

Backend (in `backend/`):

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — success.
- `npm test` — **103 passed / 151 skipped** (+5 new non-DB tests).
- `npm run test:db` — **201 passed / 0 failed** (+9 vs. Prompt 43's 192), incl.
  `http-auth.db.spec.ts` (57 tests).

## 21. Pre-existing Failure (not introduced by Prompt 44)

`frontend/src/features/owner-portal/OwnerPortal.test.tsx` ›
`schedule conflicts (REQ-091/092/093/099/159/160)` ›
`exceptions are attributed to the schedule version that caused the conflict and
are not re-flagged later`.

- Failure: `expected [ { id: 'cnf-…', …(7) } ] to deeply equal []`.
- This test failed identically before Prompt 44 (same test, same assertion) and
  is unrelated to auth; the assertion line shifted from 982 to ~977 only because
  imports were consolidated. The randomly-generated conflict id varies run to
  run (e.g. `cnf-bpcdyisy3`). It is left untouched to keep the diff focused.

## 22. Traceability

| Spec need | Where satisfied |
| --- | --- |
| REQ-025 (no social sign-in for Owner) | `LoginPage.tsx` (email/password only) |
| REQ-193 (lockout surfaced) | `errors.ts` `locked` kind; generic login copy |
| Real owner session (Prompt 43 backend) | `GET /auth/session`, `AuthProvider` bootstrap |
| Owner-only portal | `RequireOwner`, backend `ApiAuthGuard` |
| Customer flow unauthenticated | public route untouched; QA asserts no login affordance |
| Sample-data disclosure | `OwnerLayout` footer copy |

## 23. Known Limitations / Deferred

- Only authentication is real; all other domains still render mock data.
- No CSRF token (mitigated by `SameSite=Lax` + CORS allowlist); revisit if a
  same-site subdomain topology is adopted.
- The login response carries no email, so the displayed email is the normalized
  submitted value; if the backend later normalizes differently (e.g.
  plus-addressing), display could differ cosmetically. Wiring display to the
  session response is a trivial follow-up should the backend expose it.
- `VITE_API_BASE_URL` and `CORS_ORIGINS` must be set per environment before a
  production deploy (documented in `.env.example`).
- Real email, Telegram, payments, storage, billing and 2FA remain deferred.

## 24. Files Changed

Added (frontend): `src/api/{config,types,errors,http,auth}.ts` + `http.test.ts`,
`src/features/auth/{auth-context.ts,AuthProvider.tsx,useAuth.ts,RequireOwner.tsx,
LoginPage.tsx}` + `{AuthProvider,routeProtection,mockBoundary}.test.tsx`,
`src/mock/ownedBusinessFixture.ts`, `src/test/{auth.tsx,fetch.ts}`,
`.env.example`, `qa-shot/prompt44-*.png`.

Modified (frontend): `src/app/App.tsx`, `src/routes/router.tsx`,
`src/features/owner-portal/components/OwnerLayout.tsx`,
`src/features/owner-portal/{OwnerPortal,BookingManagement,BookingsPage}.test.tsx`,
`src/mock/{ownerApi.ts,store.ts}`, `src/styles/components.css`,
`src/vite-env.d.ts`.

Deleted (frontend): `src/mock/ownerSession.ts`.

Backend: `src/auth/controllers/auth.controller.ts` (new `GET /session`),
`src/domain/services/auth.service.ts` (`principalFor`), plus tests in
`src/api/http-auth.spec.ts` and `src/api/http-auth.db.spec.ts`. Local
(gitignored) `backend/.env` gained `CORS_ORIGINS=http://localhost:5173`.

## 25. Git State

- HEAD unchanged: `ba7648895a9b81abeeed5e11593f61550ab50106`.
- The spec hash is unchanged (§ top).
- No commit, reset, rebase or rewrite was performed.

## 26. Verification Summary

Frontend typecheck/lint/build are clean; 18/19 test files and 310/311 tests pass
with the single failure pre-existing and unrelated. Backend typecheck/lint/build
are clean; `npm test` 103 passed and `npm run test:db` 201 passed. Real-browser QA
passes all five flows at desktop-1440, mobile-430 and mobile-375 with no layout
overflow. The authentication boundary is real, server-authoritative and fails
closed.

## 27. Status

Prompt 44 is complete and awaiting Product Owner approval before the next
implementation phase.
