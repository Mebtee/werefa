# 04 — Service Management / Pricing (Prompt 10) — Traceability report

Status: **implemented** · Verified against the quality gate on the date of this doc.

## 1. Source-path mapping

Prompt 10 references `docs/requirements/*`; those paths DO NOT exist in this repository
(see `01-foundation-traceability.md` §1). The authoritative sources used here are:

- Requirements: `docs/01-master-specification.md` §12 (REQ-070 … REQ-081, Domain 8 — Services/Pricing) and §21 (REQ-214).
- Roles/permissions: `docs/02-user-roles-permissions.md` (services are Owner-managed).
- Architecture: `docs/architecture/03-logical-architecture.md` (Service aggregate), `05-domain-architecture.md` (Service + ServiceVariation[] + AddOn[]; no hard-delete with future bookings REQ-077; snapshots REQ-076), `06-data-architecture.md` (Service _unique (business, name)_; ServiceVariation/AddOn _unique (service, name)_; is_active lifecycle), `07-database-design.md` (integer minor-unit money, immutable snapshots written with the booking — deferred), `09-state-machines.md` (deactivate-not-delete), `04-tenant-isolation.md`, `22-audit-logging.md`, `18-api-architecture.md`; ADR `ADR-010-rest-api.md`.
- Prior reports: `01-foundation-traceability.md` (RLS GUC discipline — `NULLIF`), `03-business-tenant-management.md` (ownership matrix, guard patterns, public page).

## 2. What was implemented

### Database (`packages/db`)

- `service`, `service_variation`, `add_on` tables (migration `20260905_000500_service_catalog`):
  - `service` — `business_id` (FK → business, CASCADE), `name`, `base_price_minor` BIGINT, `base_duration_minutes` INT, `is_active` bool default true, timestamps. CHECKs: `base_price_minor >= 0`, `base_duration_minutes > 0`. Unique `(business_id, name)` (arch doc 06). Index `(business_id, is_active)` for the public projection.
  - `service_variation` — FK → service + business (CASCADE), signed `price_delta_minor`, `duration_delta_minutes`, `is_active`, unique `(service_id, name)`.
  - `add_on` — FK → service + business (CASCADE), `price_delta_minor`/`duration_delta_minutes` CHECK `>= 0` (REQ-073 AC1), unique `(service_id, name)`.
  - All rows carry their own `business_id` so RLS re-scopes children by the SAME business ownership (no cross-tenant moves).
- RLS (`20260905_000000_foundation/rls.sql` + `bootstrap-rls.ts`): FORCE RLS on all three tables. Per table: `*_owner_select/insert/update/delete` (OWNER membership via `business_owner`, OR `app.scope='SUPER_ADMIN'`), `*_public_select` (PUBLIC scope AND `is_active = true`, SELECT-only), `*_superadmin_all` (`app_superadmin`). No `app.creating` window is needed here — a just-inserted child's business is already owned, so `INSERT … RETURNING` projects through the OWNER select policy.
  - **GUC discipline carried from Prompt 07/09:** uuid GUCs are always read `NULLIF(current_setting(...), '')::uuid`; PUBLIC cannot write; OWNER `WITH CHECK` re-validates the target `business_id` so an UPDATE can never move a row to a business the actor does not own; SUPER_ADMIN is a narrow, service-layer-audited window (never the normal runtime role).

### Money and duration modelling (arch docs 06/07)

- All prices are **integer minor units stored as BIGINT** (`base_price_minor`, `price_delta_minor`) — nothing floaty enters the domain (REQ-226 legacy). The serializer converts `BigInt → Number` (exact below 2^53; platform magnitudes are far below).
- Durations are **whole minutes**; a service base must be >= 1 minute.
- **Variations** carry SIGNED deltas relative to the parent base (REQ-072) — e.g. a discounted or expedited option. The **effective total** `base ± delta` must stay `>= 0` minor units and `>= 1` minute; because the DB cannot express a cross-row check, this is validated at the app layer on variation create/update AND re-validated whenever the service base price/duration is edited (`assertVariationTotalsValid`).
- **Add-ons** carry non-negative additive deltas (REQ-073 AC1), enforced both by input parsing and DB CHECKs.
- `priceDeltaMinor: 0` / `durationDeltaMinutes: 0` are valid for both (a free, no-time add-on or a price-neutral variation variant).

### API module (`apps/api/src/service`)

- `service-input.ts` — strict parsing: `readInt` (whole safe integers only), `readPriceMinor` (>= 0), `readDurationMinutes` (>= 1), child delta readers (signed / non-negative), `isActive` as strict boolean. Names <= 120 chars. Rejects floats, strings, booleans outright (no silent coercion).
- `service.serializer.ts` — `ownerView` (full catalog incl. `businessId`, lifecycle + timestamps and inactive children — Serializer DTOs), `publicView` (curated subset: name, price, duration, active variations/add-ons ONLY — no `business_id`, no `is_active`, no timestamps, protecting REQ-214).
- `future-bookings.seam.ts` — the REQ-077 boundary. `countFutureBookings(serviceId)` returns `0` today: the booking module does not exist yet, so we do NOT fabricate a booking store. The seam is the single integration point the booking module plugs into; the `SERVICE_DELETE_BLOCKED` audit path is wired for when bookings exist.
- `service.service.ts` — `create/list/get/update/deactivate/reactivate/remove`, `createVariation/updateVariation/deleteVariation`, `createAddOn/updateAddOn/deleteAddOn`, `listPublic(slug)`. All tenant reads/writes run inside `withOwnerBusinessContext` / `withPublicContext` (OWNER / PUBLIC RLS window, never bypassed). `P2002` unique violations map to 409; the seam guards hard delete; base-edit re-validates variation effective totals; sub-ids are always re-scoped by `businessId`.
- `service.controller.ts` — `@Controller('/api/v1/businesses/:businessId/services')` + `@UseGuards(SessionGuard, RolesGuard, TenantGuard)` + `@RolesExact(Role.Owner)` STRICT — Admins/Super Admins do NOT inherit service capabilities (same rule as Prompt 09). `businessId` is tenant-guarded; every service/variation/add-on id is re-scoped against it.
- `service-public.controller.ts` — public SELECT-only projection.
- `service.module.ts` + wiring in `app.module.ts`.
- Audit (`security-events.service.ts`): `SERVICE_CREATE / UPDATE / DEACTIVATE / REACTIVATE / DELETE / DELETE_BLOCKED / VARIATION_CREATE|UPDATE|DELETE / ADDON_CREATE|UPDATE|DELETE` with actor + business scope.

### Endpoints

| Endpoint                                                   | Access        | Behavior                                                       |
| ---------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| `POST /api/v1/businesses/:businessId/services`             | Owner (exact) | create service (name, base price, base duration); 409 dup name |
| `GET /api/v1/businesses/:businessId/services`              | Owner (exact) | list owned services (asc by created) with children             |
| `GET /api/v1/businesses/:businessId/services/:serviceId`   | Owner (exact) | detail                                                         |
| `PATCH /api/v1/businesses/:businessId/services/:serviceId` | Owner (exact) | update name/price/duration; re-validates variation totals; 409 |
| `POST …/services/:serviceId/deactivate` / `…/reactivate`   | Owner (exact) | lifecycle toggle (REQ-078/081); repeated transition → 409      |
| `DELETE …/services/:serviceId`                             | Owner (exact) | hard delete (no future bookings → allowed); cascades children  |
| `GET/POST …/services/:serviceId/variations`                | Owner (exact) | list / create signed-delta variation (REQ-072)                 |
| `PATCH/DELETE …/variations/:variationId`                   | Owner (exact) | update (incl. `isActive` hide) / delete; re-scoped by service  |
| `GET/POST …/services/:serviceId/add-ons`                   | Owner (exact) | list / create non-negative add-on (REQ-073)                    |
| `PATCH/DELETE …/add-ons/:addOnId`                          | Owner (exact) | update (incl. `isActive` hide) / delete; re-scoped by service  |
| `GET /api/v1/public/businesses/:slug/services`             | public        | active services + active variations/add-ons (REQ-079/214)      |

### Dashboard (`apps/dashboard/src`)

- `lib/service-api.ts` — typed client + `majorFromMinor`/`minorFromMajor` (edits in major units, integer minor units on the wire), `api.del` added for the DELETE verbs.
- `business/ServicesManager.tsx` — catalog list (price/duration, Active/Deactivated badges), create/edit forms, deactivate/reactivate, delete (confirm), and per-service variation/add-on editors with signed vs non-negative deltas and Show/Hide (`isActive`) toggles.
- Wired into the owner `BusinessProfile` view via a "Manage services" button (owner-only; admin platform tier does not expose service management).

### Public app (`apps/public/src`)

- `App.tsx` now loads the service catalog alongside the business page (`ServiceCatalog`); renders active services as cards with base price/duration, listed variations (effective totals) and derived add-on prices.

## 3. Requirement → implementation → test mapping

| Req     | Statement (abbr.)                                              | Implementation                                                                                                  | Test                                          |
| ------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| REQ-070 | Multiple services selectable                                   | service catalog (per booking selection is the booking module’s job — scheduled)                                 | A (create/list many)                          |
| REQ-071 | Base service price and duration                                | `base_price_minor` + `base_duration_minutes`, required, DB CHECKs + guards                                      | A (accepted/rejected inputs)                  |
| REQ-072 | Variations/options supported                                   | `service_variation` signed deltas + effective-total invariant                                                   | E                                             |
| REQ-073 | Add-ons may change price and duration                          | `add_on` non-negative additive deltas + DB CHECKs                                                               | F                                             |
| REQ-074 | Total duration = sum of components                             | inherited by delta model; composition computed at booking time (deferred)                                       | L (deltas stay stable on edits)               |
| REQ-075 | Total price derived from components                            | inherited by delta model                                                                                        | L (delta preservation)                        |
| REQ-076 | Existing bookings preserve snapshots                           | DEFERRED: snapshot rows are written by the booking module; catalog edits never rewrite children (deltas stable) | L (fixture contract)                          |
| REQ-077 | Services with future bookings cannot be hard-deleted           | `FutureBookingsSeam` (returns 0 today), `SERVICE_DELETE_BLOCKED` path; documented boundary                      | G + L (seam = 0)                              |
| REQ-078 | Such services can be deactivated                               | `deactivate` endpoint + `is_active`                                                                             | D (deactivate → 409 double)                   |
| REQ-079 | Deactivated services hidden from public page / not selectable  | public policy `is_active = true` + child highlight hiding                                                       | D, E, F (public projections), rls PUBLIC test |
| REQ-080 | Existing bookings unchanged by deactivation                    | deactivation only flips `is_active`; rows/children retained                                                     | D (data unchanged), L                         |
| REQ-081 | Deactivated services can be reactivated                        | `reactivate` endpoint + `is_active`                                                                             | D (reactivate → back on public page)          |
| REQ-214 | Page content: services, prices, durations, variations, add-ons | public catalog endpoint + serializer subset + `apps/public` catalog card                                        | D (no internal fields exposed)                |

## 4. Test totals (last verified run)

- API integration: **97 passing** (7 files — front-door, identity ×3, RLS isolation incl. 6 catalog tests, business-tenant 23, service-management 28).
- API unit: **24 passing** (incl. `roles-guard.test.ts` exact-mode case and `service-deletion.test.ts` — the REQ-077 blocked-delete contract wired to a mocked seam); Shared unit **4**; DB unit **5**.
- Dashboard & public: `typecheck`, `lint`, `vite build` clean. API: `typecheck`, `lint` clean. Migration 000500 applied to dev `werefa` (migrate + rls) and `werefa_test` (rebuild via `db:test:setup`).
- Run: `npm run test:unit --workspace @werefa/api`; `npm run test:integration --workspace @werefa/api` (rebuilds `werefa_test`), executed with the repo root `.env` sourced (`set -a; . ./.env; set +a`).

## 5. Known gaps / deferred (out of Prompt 10 scope)

- **Booking-time composition (REQ-070/074/075) and snapshots (REQ-076/080):** the catalog exposes the delta model required by scheduling; the actual multi-service selection, effective-total composition, and immutable per-booking snapshot rows belong to the Bookings module (Prompt 11). The `service` fixture set in `service-management.test.ts` L pins the contract (children deltas never rewritten by base edits).
- **REQ-077 future-booking guard:** the seam honestly returns 0 (no booking store exists); the `SERVICE_DELETE_BLOCKED` branch becomes reachable when bookings land.
- **No ordering, no description field:** neither is required by any approved REQ (public page shows services with prices/durations/variations/add-ons); omitted deliberately.
- **Service-affecting platform tier:** no Admin/SuperAdmin service endpoints — platform manages businesses; services are Owner-only (strict `@RolesExact(Role.Owner)`).
- **Category/currency:** no platform currency modelling (money stays minor-unit integers transport-wide); the dashboard shows major units with 2 decimals.

## 6. Commands that prove identity

```bash
set -a; . ./.env; set +a
npm run db:generate         # regenerates the Prisma client (Service/ServiceVariation/AddOn)
npm run db:migrate --workspace @werefa/db    # applies 20260905_000500_service_catalog to dev
npm run db:rls --workspace @werefa/db        # idempotent RLS bootstrap
npm run db:test:setup        # rebuild werefa_test, apply migrations + RLS
npm run test:integration --workspace @werefa/api   # 97 tests incl. service-management (28) + rls (9)
npm run test:unit --workspace @werefa/api
npm run build --workspace @werefa/dashboard
npm run build --workspace @werefa/public
# Live check: npm run dev:api + npm run dev:dashboard → owner opens a business → “Manage services”
# → add service, variations (signed deltas), add-ons; deactivate/reactivate; public URL
# http://localhost:<port>/#/b/<slug> shows only active services with prices/durations.
```
