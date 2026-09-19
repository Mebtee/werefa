# Implementation Report 26 — Services Catalog API Integration

Status: **DONE** · real Owner Services Catalog + Public Services API integration ·
**210/210** backend DB-gated tests, **103/103** backend unit tests,
**338/339** frontend tests (single pre-existing date flake, proven on pristine HEAD),
**47/47** real-browser QA checks at 375/430/1440 against the live stack ·
**0 commits** created.

This report closes Prompt 46: the Owner Services page, the Service editor, and
the public booking page's service picker are now served by the real Service
Catalog API (`/api/v1/owner/businesses/:id/services…` and
`/api/v1/public/businesses/:slug/services`), persisted through PostgreSQL.
Only the service-catalog vertical was migrated; schedule, bookings, customers,
payments, Telegram and subscriptions remain on the existing in-memory mock
seam.

The canonical product source of truth (`docs/WEREFA-COMPLETE-SPECIFICATION.md`)
was **not** modified (SHA-256 `5494658e…b0ff00b`, verified below).

## 1. Objective

Migrate the Owner Services Catalog and Public Services picker from frontend mock
data to the authentic API:

```
authenticated Owner ──▶ CRUD /api/v1/owner/businesses/:id/services ──▶ PostgreSQL ──▶ Services UI + editor
public visitor      ──▶ GET /api/v1/public/businesses/:slug/services ───▶ PostgreSQL ──▶ Public service picker
```

Scope was deliberately limited to the service-catalog vertical. The remaining
verticals (schedule, bookings, customers, payments, Telegram, subscriptions)
keep their in-memory mocks so the running app stays fully functional.

## 2. Scope Boundaries Honored

| Unit | Migrated to real API? | Where it stays |
| --- | --- | --- |
| Owner service list (create / edit / price / duration) | **YES** (Prompt 46) | `GET/POST/PATCH /owner/businesses/:id/services[/:serviceId]` |
| Service variations + add-ons | **YES** (Prompt 46) | `POST /owner/businesses/:id/services/:serviceId/variations|addons` |
| Deactivate / reactivate | **YES** (Prompt 46) | `POST …/services/:serviceId/deactivate|reactivate` (REQ-078, REQ-081) |
| Public service picker | **YES** (Prompt 46) | `GET /public/businesses/:slug/services` (REQ-079) |
| Schedule + working hours | NO | mock seam |
| Bookings + lifecycle states | NO | mock seam |
| Payments / prepayment | NO | mock seam |
| Telegram notifications | NO | mock seam |
| Subscriptions | NO | mock seam |

Nothing beyond this vertical was migrated, matching the Prompt 46 acceptance.

## 3. Backend Contract Consumed (exactly the shipped routes)

The client calls **only** routes that exist in the backend
(`backend/src/api/owner/catalog.controller.ts`, `public` services route from
Prompt 43). No endpoints are invented:

| Client function | HTTP route | Purpose |
| --- | --- | --- |
| `listOwnerServices` | `GET /api/v1/owner/businesses/:id/services` | owner service catalog |
| `createOwnerService` | `POST /api/v1/owner/businesses/:id/services` | create service |
| `updateOwnerService` | `PATCH /api/v1/owner/businesses/:id/services/:serviceId` | edit base price / duration |
| `deactivateOwnerService` | `POST /api/v1/owner/businesses/:id/services/:serviceId/deactivate` | REQ-078/REQ-080/REQ-081 |
| `reactivateOwnerService` | `POST /api/v1/owner/businesses/:id/services/:serviceId/reactivate` | REQ-081/REQ-082 |
| `createServiceVariation` | `POST /api/v1/owner/businesses/:id/services/:serviceId/variations` | add a variation |
| `createServiceAddOn` | `POST /api/v1/owner/businesses/:id/services/:serviceId/addons` | add an add-on |
| `getPublicServices` | `GET /api/v1/public/businesses/:slug/services` | public active-only catalog |

There is **no** single-service GET and **no** HTTP delete route; the UI never
calls either. Deletion is intentionally refused at the service layer (REQ-077)
and remains out of the frontend, matching the shipped backend.

Wire shapes consumed verbatim:

- `OwnerServiceView = { id, name, basePriceMinor, baseDurationMinutes, isActive, variations, addOns }`
- `PublicServiceView = { id, name, basePriceMinor, baseDurationMinutes, variations, addOns }` (active only)
- variant / add-on: `{ id, name, priceDeltaMinor, durationDeltaMinutes }`
- `CreateServiceInput = { name, basePriceMinor, baseDurationMinutes }`
- `UpdateServiceInput` = same, all-optional
- `CreateServiceVariantInput = { name, priceDeltaMinor, durationDeltaMinutes }`

Minor-unit money (`basePriceMinor` / `priceDeltaMinor`) is the single source of
truth end to end; ETB presentation stays a formatter concern (REQ-073 add-ons
are deltas in integer minor units).

## 4. API Client (`frontend/src/api/catalog.ts`)

New typed client, one function per shipped route (table above). Every function
envelopes `ApiError` so call sites surface backend `fields` validation on the
form. No response is shimmed; unknown payloads are passed through to the
mapper.

## 5. Types + Mapping Layer

- `frontend/src/api/types.ts` adds `ServiceVariantView`, `OwnerServiceView`,
  `PublicServiceView`, `CreateServiceInput`, `UpdateServiceInput`,
  `CreateServiceVariantInput`.
- `frontend/src/api/catalog.mapper.ts` maps API views → domain `Service`
  (`{ id, name, basePriceMinor, baseDurationMinutes, variations, addOns, isActive }`).
  The public mapper marks `isActive: true` because the public route only ever
  returns active services; the domain model keeps `isActive` for the owner side.

Domain `Service` has **no `description`**; the backend model has none, and no UI
edits one.

## 6. Owner Portal Integration

- `useOwnedBusiness.ts` loads `listOwnerServices(view.id)` right after the
  business list, so `ServicesPage` and `ServiceEditorPage` read real services.
  The profile fields and today-preview still use the mock seam (profile API is
  the Prompt 45 migration, out of scope here).
- `ServicesPage.tsx` deactivates/reactivates through
  `deactivateOwnerService` / `reactivateOwnerService` and reloads the list from
  the API; error alerts surface the API result.
- `ServiceEditorPage.tsx` was rewritten around the real API: create → then
  `POST variations` / `POST addons` for newly added rows; edit → `PATCH` base
  fields and persists only **new** variation/add-on rows (saved ones are shown
  read-only with a `(saved)` tag). Validation maps `ApiError.fields` onto the
  matching inputs. No mock APIs are imported by this page.

### Accessibility fix surfaced by QA

The editor once used identical dynamic labels across the variation **and**
add-on groups (e.g. `Change to price (Birr) 1`), which Playwright's strict a11y
role resolution flagged as a real collision. Labels were scoped per group:

- variation price/duration → `Variation N — change to price (Birr)` / `Variation N — extra minutes`
- add-on price/duration → `Add-on N — change to price (Birr)` / `Add-on N — extra minutes`

This makes every field programmatically distinguishable across sections.

## 7. Public Booking Page Integration

- `PublicBookingPage.tsx` runs `Promise.all` including `getPublicServices(slug)`
  and passes the returned domain `Service[]` straight into the flow (no
  double-mapping).
- `useBookingFlow(business, services)` + `BookingWizard` consume those real
  services.
- `ServicesStep.tsx` / `ServicesReadOnly.tsx` surface `basePriceMinor`,
  `priceDeltaMinor`, `durationDeltaMinutes`; add-ons render as
  `+price · +min` deltas. The `description` field and any mock-only service
  fields are gone.
- `mock/api.ts` `createBooking(draft, business, services, durationMinutes)`
  builds line items from the passed services so totals stay correct while the
  bookings vertical is still mocked.

## 8. Test Double (`frontend/src/test/businessApi.ts`)

The frontend store-based stub gained a service catalog endpoint group seeded
from the in-memory store: owner list / create / patch / deactivate / reactivate /
variations / add-ons and the public active-only list. It answer with the same
validation envelopes and id prefixes (`svc-*`, `variant-*`, `addon-*`) the real
API uses. Stores that mutated `service.basePrice` were updated to
`basePriceMinor` where needed.

## 9. Mock Boundary

`frontend/src/test/servicesNoMock.test.ts` pins the migration boundary:

- `useOwnedBusiness` calls `listOwnerServices` (real API), not the mock store.
- `ServicesPage` and `ServiceEditorPage` call `src/api/catalog` functions.
- `ServiceEditorPage` imports **no** mock module.
- `PublicBookingPage` calls `getPublicServices` and does **not** consume
  `mockPage.services`.
- `useBookingFlow` signature carries `services`; it no longer calls
  `getServices`.
- mock `createBooking` receives the real service list.

## 10. Frontend Tests (338/339)

`frontend/src/api/catalog.test.ts` contract-tests every client function. The
remaining failure is the **pre-existing** schedule-conflict test
("exceptions are attributed to the schedule version that caused the conflict…",
`OwnerPortal.test.tsx`), which fails identically on pristine HEAD — it is
date-sensitive (Fri 2026-09-18 places a demo booking on a closed Saturday) and
was proven unrelated by `git stash` before this migration.

| Suite | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `eslint .` | clean |
| `npm run build` (vite) | pass |
| `vitest run` | 338 passed / 1 pre-existing flake |

## 11. Backend Tests (210 DB-gated + 103 unit)

REQ-077/REQ-078 behavior pinned at the domain and HTTP layers:
`domain-services.db.spec.ts` (+3) and `http-api.db.spec.ts` (+4, incl. tenant
isolation extensions). `npm run build`, typecheck, eslint, `npm run test:db`
(210 passed) and `npm test` (103 passed / 160 skipped) are all green.

## 12. Browser QA Method

Playwright harness (`qa-p46-real.cjs`, pattern `qa-p45-real.cjs`) drove the
**live** stack: Vite on 5173, API on 3000 (rebuilt + restarted to pick up the
REQ-078 backend change), dev PostgreSQL. It seeded the QA owner sign-in, created
a service through the real UI, verified persistence at the DB and API layers,
edited it, seeded an open future booking in the DB, deactivated/reactivated with
the booking present, then ran deterministic viewport overflow checks at
375/430/1440 on both the owner Services page and the public page. Screenshots
are under `qa-shots-p46`. QA fixtures (service + seeded booking) are removed at
the end; the DB is left pristine.

## 13. QA Results (47/47)

- service create toast + API persistence (`isActive=true`, 25000 minor / 45 min)
- variation row (+100 ETB / +15 min) and add-on row (+50 ETB / +5 min) persisted
- public page renders the real card, chips, and `+` deltas
- mock-only services no longer leak to the public page; public API answers only
  catalog services
- edit pre-fills saved values, persisted variants render read-only `(saved)`
- edited price/duration persisted (30000 minor / 30 min) and mirrored publicly
- **REQ-078**: deactivate succeeds with an open future booking, `isActive=false`
- **REQ-079**: deactivated hidden from the public page
- **REQ-081**: reactivate restores public visibility
- 375/430/1440 owner + public overflow checks pass; no page errors, no
  unexpected network errors; fixtures cleaned (`services remaining=0`)

## 14. Backend Gap-Fix (REQ-078 + REQ-077)

QA caught that the locally-running API rejected deactivation on future-booked
services: the process was serving a stale `dist` build predating the REQ-078
change. After `npm run build` + restart, the endpoint correctly **allows**
deactivation with future bookings (`deactivateService`, REQ-078) while the new
`deleteService` **refuses** deletion of future-booked services (REQ-077). No
runtime code change was needed for the gate.

## 15. Security / Tenant Notes

Catalog routes are tenant-scoped by business id; the client never receives other
tenants' services. The public route is flat by slug (active-only view). QA
owner only ever saw its single demo business's services.

## 16. Known Limitations / Deferred

- Creating variations / add-ons on an **existing** service via the editor is not
  exposed (no HTTP route to mutate a saved row); saved rows show read-only.
- No service deletion UI (backend refuses REQ-077; no delete route shipped).
- Schedule, bookings, customers, payments, Telegram, subscriptions remain on the
  mock seam — the bookings vertical (Prompt 47+) will consume these real
  catalog objects next.

## 17. Traceability

| Requirement | Evidence |
| --- | --- |
| REQ-073 add-ons are deltas (minor units) | mapper + UI `+price · +min`; QA add-on row |
| REQ-077 refuse hard-delete with future bookings | new `deleteService` + domain/HTTP tests |
| REQ-078 deactivate allowed with future bookings | `deactivateService` + QA step with seeded booking |
| REQ-079 inactive hidden from public | public active-only view + QA |
| REQ-081 reactivation restores visibility | `reactivateService` + QA |
| Prompt 46 scope (catalog only) | §2 boundaries; mock boundary test |

## 18. Files Changed

Backend: `catalog.service.ts`, `catalog.controller.ts` (+ REQ-077/REQ-078
behavior + docstring), `domain-services.db.spec.ts`, `http-api.db.spec.ts`.

Frontend: `api/types.ts`, `api/catalog.ts` (new), `api/catalog.mapper.ts` (new),
`api/catalog.test.ts` (new), `test/businessApi.ts`, `test/servicesNoMock.test.ts`
(new), `features/owner-portal/state/useOwnedBusiness.ts`,
`pages/ServicesPage.tsx`, `pages/ServiceEditorPage.tsx`,
`features/public-booking/PublicBookingPage.tsx`, `state/useBookingFlow.ts`,
`components/BookingWizard.tsx`, `components/ServicesReadOnly.tsx`,
`components/steps/ServicesStep.tsx`, `mock/api.ts`, plus stale `basePrice`
references fixed in `BookingsPage.test.tsx`, `BookingManagement.test.tsx`,
`BookingStatus.test.tsx`, `mock/seedBookings.ts`, `mock/lifecycle.test.ts`,
`mock/notifications.test.ts`, `mock/bookings.test.ts`,
`mock/customerLookup.test.ts`.

## 19. Git State

No commits created. Working tree contains this migration's diff only.
HEAD: `42594bd` (unchanged). Spec inputs unchanged (spec file SHA-256
`5494658e…b0ff00b` matches the Prompt 45 baseline; KF/REQ notes in
`%TEMP%\opencode` untouched).

## 20. Verification Summary

| Check | Result |
| --- | --- |
| Backend build / typecheck / lint | pass |
| `npm run test:db` | 210/210 |
| `npm test` | 103/103 (160 skipped) |
| Frontend tsc / lint / build | pass |
| `npx vitest run` | 338/338 + 1 pre-existing flake |
| Browser QA (live stack) | 47/47 |
| DB state after QA | pristine (0 bookings, 0 QA services) |
## 21. Status

**DONE.** Prompt 46 closed. Services Catalog vertical is fully real; next
verticals can now route their mock objects through the catalog API.