# Implementation Report 25 — Business Profile & Public Business API Integration

Status: **DONE** · real Owner Business + Public Business API integration ·
**203/203** backend DB-gated tests, **103/103** backend unit tests,
**322/323** frontend tests (single pre-existing failure), **54/54** real-browser
QA checks at 375/430/1440 · **0 commits** created.

This report closes Prompt 45: the Owner Business Profile and Public Business
Configuration vertical slice now reads and writes the real backend Business
API, persisted through PostgreSQL. The public page (`/p/{slug}`) is served by
the real Public Business API. Only the business-profile vertical was migrated;
services, schedule, bookings, customer APIs, payments, Telegram and
subscriptions remain on the existing in-memory mock seam.

The canonical product source of truth (`docs/WEREFA-COMPLETE-SPECIFICATION.md`)
was **not** modified (SHA-256 `5494658e…b0ff00b`, verified below).

## 1. Objective

Migrate the Owner Business Profile and Public Business Configuration slice from
frontend mock data to the authentic API

```
authenticated Owner ──▶ GET/PATCH /api/v1/owner/businesses ──▶ PostgreSQL ──▶ Owner profile UI
public visitor     ──▶ GET /api/v1/public/businesses/:slug ──▶ PostgreSQL ──▶ Public booking page
```

Scope was deliberately limited to the business-profile vertical. Later slices
(services, schedule, bookings, customers, payments, Telegram, subscriptions)
keep their in-memory mocks so the running app stays fully functional while the
backend catches up.

## 2. Scope Boundaries Honored

| Unit | Migrated to real API? | Where it stays |
| --- | --- | --- |
| Business profile read/edit | **YES** (Prompt 45) | `GET/PATCH /owner/businesses/:id` |
| Public link (slug) read/change | **YES** (Prompt 45) | `PATCH /owner/businesses/:id/slug` |
| Pause / resume / deactivate / reactivate | **YES** (Prompt 45) | `POST /owner/businesses/:id/pause|resume|…` |
| Public business page header/footer | **YES** (Prompt 45) | `GET /public/businesses/:slug` |
| Services (public + owner catalog) | NO | mock seam |
| Schedule + working hours | NO | mock seam |
| Bookings + lifecycle states | NO | mock seam |
| Payments / prepayment | NO | mock seam |
| Telegram notifications | NO | mock seam |
| Subscriptions | NO | mock seam |
| Branding (logo / cover upload) | NO (demo preview) | mock seam, explicitly labelled |

Nothing beyond this vertical was migrated, matching the Prompt 45 acceptance.

## 3. Backend Contract Consumed (exactly the shipped routes)

The client calls **only** routes that exist in the backend (`owner/business.controller.ts`,
`public/public.controller.ts`, Prompt 42/43). No endpoints are invented:

| Client function | HTTP route | Purpose |
| --- | --- | --- |
| `listOwnedBusinesses` | `GET /api/v1/owner/businesses` | list the caller's businesses |
| `updateOwnedBusinessProfile` | `PATCH /api/v1/owner/businesses/:id` | edit real profile fields |
| `changeOwnedBusinessSlug` | `PATCH /api/v1/owner/businesses/:id/slug` | REQ-047 public link change |
| `pauseOwnedBusiness` | `POST /api/v1/owner/businesses/:id/pause` | REQ-147/148/149 pause |
| `resumeOwnedBusiness` | `POST /api/v1/owner/businesses/:id/resume` | manual resume |
| `getPublicBusiness` | `GET /api/v1/public/businesses/:slug` | public page profile |

`deactivate`/`reactivate` exist server-side but are not yet wired to a UI button
in this slice (no deactivation control surfaced on the profile page).

All owner calls rely on the HttpOnly `werefa_session` cookie and are enforced
server-side by `ApiAuthGuard` + `TenantGuard`; the frontend never trusts a
client-supplied business id.

## 4. API Types (`frontend/src/api/types.ts`)

Wire types mirror the backend projections exactly:

- `BusinessCategoryCode`, `PublicCategoryView` `{ code, label }`
- `BusinessCoordinates { latitude, longitude }` (nullable — REQ-211 may store
  a location with all three attributes, or none)
- `OwnerBusinessView` — full owner projection incl. `id`, `slug`, settings,
  `prepayment`, pause fields, `coordinates`
- `PublicBusinessView` — publish-safe projection (no settings/prepayment)
- `UpdateBusinessProfileInput`, `ChangePublicSlugInput`, `PauseBusinessInput`

`PauseBusinessInput` sends `message`/`reopenDate`; the pause client composes the
`until` form into an ISO `YYYY-MM-DDT00:00:00.000Z` string matching the backend
`PausePayload`.

## 5. API Client (`frontend/src/api/business.ts`)

- `apiRequest` wrapper (existing `http.ts`) — always `credentials: 'include'`,
  attaches a correlation id, parses the architecture error envelope into
  `ApiError` kinds (`not-found`, `conflict`, `authentication`, …).
- `isNotFoundError` lets the public page distinguish 404 (→ “Business not
  found” surface) from other errors (→ retry surface).
- **Primary owned business cache**: after `loadPrimaryOwnedBusiness()` the first
  owned business (tenant-scoped list, `createdAt` order) is cached with a
  `useSyncExternalStore` subscription, so the owner header can show the real
  public link, follow renames, and expose an `aria-disabled` link while the
  first list call is still in flight.
- **In-flight dedup**: concurrent callers (owner layout + page hook) share one
  `GET /owner/businesses` promise instead of issuing duplicate requests; the
  layout and the page collapse to a single re-render wave. This is a real
  observable improvement (verified in the network capture during browser QA).

## 6. Mapping Layer (`frontend/src/api/business.mapper.ts`)

- `categoryFromCode` / `categoryToCode` map the backend codes
  (`SALON_AND_BARBER`, `OTHER`) to the UI `BusinessCategory` model and back.
- `coordinatesOf` preserves **null** for an unsaved location (fix below).
- `pauseFromBusiness` rebuilds the UI `PauseState` (`indefinite` / `until` with
  `reopenDate`).
- `hybridizeOwnedBusiness` / `hybridizePublicBusiness` overlay the **real**
  profile fields on the mock-only UI fields (working hours, accent colour, map
  provider, currency, prepayment instructions, Telegram/subscription state,
  logo/cover) so every page renders without a second copy of the data.
- `DEFAULT_PUBLIC_BUSINESS_FIELDS` supplies typed mock-only defaults when a
  real slug has no mock catalog entry (e.g. after a rename).

## 7. Fix: Null Coordinates (REQ-211)

The original mapper coerced a missing location to `0,0`. That made the owner
form pre-fill `Latitude/Longitude` with `0` and, worse, would have **persisted
(0,0)** (“latitude zero on the Equator”) whenever an owner saved an unrelated
profile change with untouched coordinate fields.

- `BusinessDetails.lat/lng` are now `number | null`.
- `coordinatesOf` returns `null` when the backend has no saved location.
- The owner form initializes empty (`''`) when unset and **omits** the fields
  from the PATCH body when left empty — the backend treats an omitted field as
  “leave unchanged”.
- `mapUrl` renders a provider homepage when coordinates are null instead of a
  `0,0` map pin.
- Verified end-to-end in the browser: empty form for the clean fixture business,
  coordinates persisted after save, and a real map link (`mlat=9.02&mlon=38.75`)
  on the public page.

This change is inside scope (the profile edit flow including lat/lng is
Prompt 45 groundwork, backend wire type `latitude/longitude`, REQ-211).

## 8. Owner Portal Integration

- **Header (`OwnerLayout.tsx`)**: real primary slug via `useSyncExternalStore`
  (+ `loadPrimaryOwnedBusiness()` on mount with in-flight dedup); “View public
  page” follows renames; `aria-disabled` until resolved; footer now states
  exactly which data is real vs sample.
- **Profile page (`BusinessProfilePage.tsx`)**:
  - Real form fields: Business name, Category (radio), Description, Public phone
    number, Address, Latitude, Longitude.
  - Client pre-check mirrors the backend `ChangeSlugPayload`
    (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, 2–64 chars) so an invalid link never hits
    the network.
  - Server `409 CONFLICT` maps to “That public link is already taken by another
    business.”; other failures surface via `toUserMessage`.
  - Success strings: “Profile saved. Your public page is up to date.” and
    “Public link updated.”; the QR mock re-encodes the real link and updates on
    rename.
  - **Branding stays mock** (labelled “Demo-only previews”): `ImagePicker`
    uploads are persisted in the local demo store only and are never sent to
    the backend, because a real image/storage API has not landed. Pause card is
    wired with the real `businessId`.
- **Dashboard**: derives the real `businessId` from the primary cache and only
  shows profile/pause actions when a real business was loaded.
- **Pause card**: real pause/resume calls with `reopenAt` ISO conversion and
  server-side error messaging.

## 9. Public Page Integration

`PublicBookingPage.tsx`:

- `getPublicBusiness(slug)` is **authoritative** for existence and the profile;
  404 renders the “Business not found” surface with a fallback link to the demo
  business; other errors render a retry surface (new state).
- Real profile is hybridised over the mock-only fields; services still come
  from the mock seam (merged for the same slug only).
- While paused: `BusinessHero` shows the real pause message (REQ-148) and the
  page renders services read-only instead of the booking wizard (REQ-149).
- Footer: “profile and pause state are real; services, schedule and bookings
  are still sample data.”
- `BusinessHero` is null-safe: no empty tagline paragraph, the fact block
  (`Address` / `Phone`) is present only when the data exists, the phone link
  renders `tel:` unconditionally only for a non-empty number, and the map link
  degrades to the provider homepage when coordinates are unset.

## 10. Test Double (`frontend/src/test/businessApi.ts`)

A stateful, dependency-free double covering every consumed route with the exact
wire contracts (URL, method, credentials, error envelope):

- owner list/get; PATCH profile; PATCH slug (**409** for taken slugs incl.
  `marathon-auto-care`); pause/resume/deactivate/reactivate; public GET by slug.
- **Public store fallback**: other mock businesses (riverside-dry-cleaning,
  …) are served for their public pages, but the initial owned mock slug is
  excluded once renamed, so “the old public link 404s after a rename” asserts
  like the real behaviour.
- `renderAppAt` (test/auth.tsx) auto-installs the double with `afterEach`
  cleanup; the public wizard, customer-status, route-protection, owner-portal
  and business client specs all run against it.

## 11. Real API Pre-Check (contract sanity)

Before touching the browser, the app was booted from `dist` on :3000 against
`werefa_dev` and the real flow was exercised with curl:

- `POST /auth/login` (qa-owner) → `200` + `werefa_session` cookie;
- `POST /owner/businesses` (addis-beauty-lounge fixture) → `201` + TRIAL;
- `GET /public/businesses/addis-beauty-lounge` → `200` with the stored profile.

## 12. Browser QA Method

- Backend: `node dist/main.js` (start:prod) on :3000 against `werefa_dev`
  (Docker `werefa-db-dev`, port 5433).
- Frontend: `npx vite --port 5173 --strictPort`; the dev fallback base URL is
  `http://localhost:3000/api/v1`.
- Playwright-core + headless Chromium 1243 (script outside the repo:
  `qa-p45-real.cjs` under the temp workspace, reusing the Prompt 24/44 tooling).
- A QA Owner (`qa-owner@werefa.test` / `QaOwner-Pass-2030`, present since
  Prompt 44) owns the single canonical business `addis-beauty-lounge`; a second
  fixture business is created through the real API purely to elicit the slug
  409, then removed again (dev DB left clean).
- Viewports 375×900 / 430×900 / 1440×900 with overflow probes and screenshots.

## 13. QA Results (54/54)

| Section | Checks | Pass |
| --- | --- | --- |
| S1 Real login → owner dashboard, header public link | 2 | 2/2 |
| S2 Profile page reads real DB values (incl. empty coords, real slug) | 7 | 7/7 |
| S3 Save profile (name/desc/phone/address/lat/lng) → real persist after reload | 6 | 6/6 |
| S4 Public page = real profile (name, category, desc, address, phone, map link) + mock services still render | 6 | 6/6 |
| S5 Slug conflict: taken slug → 409 message, input retained | 2 | 2/2 |
| S6 Slug change: success toast, QR regen, header/public link renames, old slug 404s | 6 | 6/6 |
| S7 Pause → real: closed alert + message on public page, Book-now hidden | 4 | 4/4 |
| S8 Resume → real: Book-now back | 2 | 2/2 |
| S9 Revert to canonical slug | 1 | 1/1 |
| S10 Responsive 375/430/1440 (owner + public), no horizontal overflow, screenshots | 12 | 12/12 |
| S11 Network/console cleanliness (allowlisted: login session-probe 401s, deliberate 409/404, favicon noise) | 2 | 2/2 |
| **Total** | **54** | **54/54** |

Screenshots: `qa-shots-p45/{owner-business,public}-{375,430,1440}.png`.

## 14. Backend Gap-Fix (coordinates in profile update path)

The backend `UpdateBusinessProfilePayload` already accepted `latitude`/`longitude`
but the service/repository port / Prisma repo / controller wiring did not
persist them. Prompt 45 therefore closed the gap:

- `business.repository.port.ts`: `latitude?`/`longitude?` on the update
  arguments; `prisma-business.repository.ts` persists them (null-coalesced).
- `business.service.ts` `updateProfile`: locates `business.code` and persists
  `latitude`/`longitude` when provided.
- `business.controller.ts`: passes `latitude`/`longitude` into the service call.
- `projections.ts`: owner projection exposes `coordinates { latitude, longitude }`.
- `http-api.db.spec.ts`: **+3 DB-gated regression tests** for saving a location
  with all three attributes, partial updates, and read-back through both the
  owner and public projections.

## 15. Owner Projection (`coordinates`)

`OwnerBusinessView` now carries `coordinates: { latitude: number | null,
longitude: number | null }`. `PublicBusinessView` already exposed it; both are
hybridised consistently so the owner form and the public map link agree.

## 16. Mock Boundary (`frontend/src/mock/…`)

The mock store keeps `getBusiness`, `getBusinessPage`, `setPause`,
`changeBusinessSlug`, `saveBranding` and the deterministic fixtures so the
non-migrated flows (services, schedule, bookings, customer status, telegram)
work unchanged. The owner and public **business profile reads/writes now go
around the mock and land in PostgreSQL**.

## 17. Frontend Tests

`npm run typecheck`, `npm run lint`, `npm run build` — clean (build: ~469 kB JS
/ ~41 kB CSS).

`npx vitest run` — **323 tests**: the canonical verification run is
**322 passed / 1 failed**:

| Failure | Attribution |
| --- | --- |
| `OwnerPortal.test.tsx` · “exceptions are attributed to the schedule version that caused the conflict and are not re-flagged later” (line 977) | **Pre-existing** (present at baseline HEAD `42594bd2`, Prompt 22/24 reports; unrelated to business profile — schedule-conflict store assertion) |
| Intermittent: `BookingManagement.test.tsx` · “accepts a pending booking and transitions it to confirmed” (line 134) | **Pre-existing racy assertion** — `getAllByText('Confirmed')` synchronously after `user.click` with no `waitFor`; passes 25/25 in isolation, surfaces only under full-suite parallel load; the file is untouched by this prompt |

The third historically-observed flake (“edits a service price and duration…”,
OwnerPortal line 279) passed consistently across all final runs and no longer
reproduces; it is left untouched.

New tests: `frontend/src/api/business.test.ts` (12 tests) cover exact
URLs/methods/headers/credentials/body, the full error-kind mapping (404/
409/401), and primary-cache subscribe/notify/in-flight behaviour.

## 18. Backend Tests

- `npm run typecheck`, `npm run lint`, `npm run build` — clean.
- `npm run prisma:status` — schema up to date (3 migrations, `werefa_dev`).
- `npm test` — **103 passed / 153 skipped (256)**.
- `npm run test:db` — **203 passed / 0 failed (12 files)** incl. the 3 new
  coordinate regression tests and the full AUTH/Authorization E2E suite.

## 19. Security / Tenant Notes

- All owner calls go through the session cookie; authorization is decided
  server-side by `ApiAuthGuard` + `TenantGuard`.
- The frontend never sends or trusts a client-supplied business id for
  authorization; it derives `businessId` from the server-listed primary.
- Slug uniqueness is enforced server-side (409), the client only pre-validates
  the character set.
- No credentials are logged or committed; the QA secrets live in the temp
  workspace only.

## 20. Accessibility Notes

- New success/error feedback uses `Alert` with `live="polite"`.
- The header public-page link is `aria-disabled` when no business has loaded
  yet.
- The pause dialog uses `legend`/`fieldset` grouping with a labelled date input.

## 21. Known Limitations / Deferred

- **Branding uploads stay mock** (labelled demo preview) until a real file /
  image API ships — no upload client exists, matching the backend metadata-only
  contract.
- **Detectivate/reactivate** endpoints exist but still lack a UI control.
- **QR code remains a mock** visual that encodes the real link.
- Later slices (services, schedule, bookings, customers, payments, Telegram,
  subscriptions) are not migrated.
- The six unresolved Product-Owner decisions recorded in the spec stay
  unresolved (subscription price, global timezone identity, reminder
  lead-time default, owner booking-report PDF export, owner “modify” scope,
  timezone-abbreviation display rule); Prompt 38 Item 6 stays dropped.

## 22. Traceability

| Spec need | Where satisfied |
| --- | --- |
| REQ-007 (one booking link per business) | slug form + `werefa.app/p/{link}` surface (REQ-214/215) |
| REQ-047 (change public slug) | `PATCH /owner/businesses/:id/slug` + client pre-check + 409 mapping |
| REQ-147/148/149 (pause message/reopen/block bookings) | real `PauseCard` + public page pause alert + services read-only |
| REQ-211 (location may be saved with all three attributes) | real lat/lng fields + backend gap-fix + coordinate regression tests; null handled |
| REQ-212 (map link) | `mapUrl` from saved coordinates or provider homepage fallback |
| REQ-214/215 (public page profile) | real `PublicBusinessView` on `/p/{slug}` |
| REQ-216 (deactivate page visible, bookings stop) | endpoint real; UI control deferred |

## 23. Files Changed

Backend (gap-fix):

- `backend/src/api/dto/payloads.ts` (lat/lng on update payload — pre-existing)
- `backend/src/api/dto/projections.ts` (owner `coordinates`)
- `backend/src/api/owner/business.controller.ts`, `backend/src/domain/services/business.service.ts`
- `backend/src/domain/repositories/business.repository.port.ts`, `prisma-business.repository.ts`
- `backend/src/api/http-api.db.spec.ts` (+3 coordinate tests)

Frontend (new):

- `frontend/src/api/business.ts`, `business.mapper.ts`, `types.ts`, `business.test.ts`
- `frontend/src/test/businessApi.ts`
- `frontend/src/types/models.ts`, `frontend/src/lib/format.ts` (nullable coords / `mapUrl`)

Frontend (modified):

- `frontend/src/features/owner-portal/{components/OwnerLayout,PauseCard,pages/BusinessProfilePage,DashboardPage,state/useOwnedBusiness}.tsx`
- `frontend/src/features/public-booking/{PublicBookingPage,components/BusinessHero}.tsx`
- `frontend/src/test/auth.tsx` + spec wiring in `BookingFlow.test.tsx`,
  `BookingStatus.test.tsx`, `routeProtection.test.tsx`

## 24. Git State

- HEAD: `42594bd2e4d5c055c86dc7b16dd9dce478a51454` (unchanged).
- Spec SHA-256 `5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b`
  (unchanged).
- Working tree: only the files above are modified/new; **no commit created**.

## 25. Verification Summary

| Dimension | Result |
| --- | --- |
| Frontend typecheck / lint / build | PASS / PASS / PASS |
| Frontend vitest | 322/323 (1 pre-existing deterministic + 1 pre-existing intermittent flake documented) |
| Backend typecheck / lint / build | PASS / PASS / PASS |
| Backend unit (`npm test`) | 103 passed / 153 skipped |
| Backend DB-gated (`npm run test:db`) | **203 passed / 0 failed** |
| Prisma status | schema up to date |
| Real-API pre-check (curl: login → create → public GET) | PASS |
| Real-browser QA (Playwright, 375/430/1440) | **54/54 checks** |
| Horizontal overflow | none at 375/430/1440 |
| Spec + HEAD | unmodified |
| Commits | none |

## 26. Status

Prompt 45 complete: real Business Profile and Public Business API integration
built and verified.

Prompt 45 complete; waiting for Product Owner approval before the next
implementation phase.