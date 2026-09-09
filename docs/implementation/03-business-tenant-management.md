# 03 — Business & Tenant Management (Prompt 09) — Traceability report

Status: **implemented** · Verified against the quality gate on the date of this doc.

## 1. Source-path mapping

Prompt 09 references `docs/requirements/*`; those paths DO NOT exist in this repository
(see `01-foundation-traceability.md` §1). No requirement/architecture doc was renamed;
the authoritative sources used here are:

- Requirements: `docs/01-master-specification.md` §5 (REQ-001 … REQ-006), §6 (REQ-007 … REQ-023), §9 (REQ-045 … REQ-053), §16 (REQ-125 … REQ-141), §18 (REQ-143 … REQ-158), §21 (REQ-207 … REQ-212), §25 (REQ-207/215 … published-page block).
- Roles/permissions: `docs/02-user-roles-permissions.md`.
- Architecture: `docs/architecture/04-tenant-isolation.md`, `07-database-design.md`, `14-auth-security-architecture.md`, `16-file-storage.md`, `17-background-jobs.md`, `18-api-architecture.md`, `20-admin-architecture.md`, `22-audit-logging.md`; ADR `ADR-010-rest-api.md`.

## 2. What was implemented

### Database (`packages/db`)

- `business` table: profile fields (category, description, phone, contactEmail, address, lat/lng, googleMapsLink, openStreetMapLink), lifecycle (`trialEndsAt`, `isPaused`, `pausedUntil`, `pauseMessage`, `deactivatedAt`), public identity (`publicSlug` unique CITEXT — one URL/QR per business, REQ-008/047), storage keys (`logoKey`/`logoMime`, `coverKey`/`coverMime`).
- `business_owner` ownership matrix (REQ-012/013): many businesses per owner, one owner per business.
- Migrations: `20260905_000400_business_tenant_management`, `20260905_000410_business_media_mime` (dev applied).
- RLS (`20260905_000000_foundation/rls.sql` + `bootstrap-rls.ts`): permissive policies on `business` and `business_owner` for the `app` role via tenant GUCs (`app.scope`, `app.user_id`, `app.business_id`, `app.creating`); SUPER_ADMIN write window; `app_superadmin` full access; PUBLIC select-only. No BYPASSRLS for `app`.
- Tenant-context plumbing (`packages/db/src/tenant-context.ts`): a SINGLE `SELECT set_config(...), …` statement (Prisma's extended protocol rejects multi-statement strings).
  - **GUC reset quirk:** after any transaction-local `set_config(name, v, true)` ends (commit OR rollback), a custom GUC returns to its `''` default on that pooled connection. Policies therefore read uuid GUCs via `NULLIF(current_setting(...),'')::uuid` so an empty/missing value is NULL (never an invalid cast), and every request transaction re-establishes ALL the GUCs it reads.
  - **Create-time INSERT…RETURNING window:** Prisma `create` issues `INSERT … RETURNING`, which Postgres gates through the SELECT policy; a freshly inserted business has no owner row yet, so the default owner window could not project it back. A narrow branch (`app.scope='OWNER'` AND `app.creating='1'` AND `app.business_id = id`) opens visibility ONLY during the creation transaction, and only for the exact business being created. `app.creating` is NEVER set outside the create flow, so owner B cannot aim the window at owner A's business (verified in `rls-isolation.test.ts` B and `business-tenant.test.ts` C).

### Business module (`apps/api/src/business`)

- `BusinessService` — `create` (name → slug auto-derivation, category allowlist `{Salon & Barber, Other}`, reserved-slug rejection, `-N` suffix on derived collisions, explicit-slug conflict → 409, owner link in the same creation transaction, 30-day trial), `listOwned` / `getOwned` / `update` (profile + slug change), `pause` (indefinite or `until`; repeat pause changes/extends/removes), `resume` / `deactivate` / `reactivate` (no hard delete — owner retains dashboard access, REQ-023), `selectContext` (persists active `businessId` per session), `uploadMedia` (logo/cover, allowlist image/png/jpeg/webp, ≤10 MB), `autoResumeDueBusinesses` (SUPER_ADMIN system sweep; gated on subscription validity else denied + event), public `findBySlug` (PUBLIC scope).
- `SubscriptionAvailabilityService` — the Prompt-09 boundary to Domain 12: trial starts at creation; scheduled/auto resume requires an active subscription window, otherwise the business stays paused with a `RESUME_DENIED`/`AUTO_RESUME_DENIED` security event (REQ-153/154/155 spirit). Full subscription lifecycle (proofs, admin review, grace) is a later module.
- Guards/decorators: `TenantGuard` (URL `businessId` ∈ actor `ownedBusinessIds`), `@RolesExact(Role.Owner)` — STRICT equality on the owner controller so Admin/Super Admin do NOT inherit business-owner capabilities by hierarchy (`docs/01-master-specification.md` "Admin cannot perform owner-only operations"); Admins/Super Admins reach the platform tier through `/admin`.
- `SecurityEventsService` reuse: `BUSINESS_CREATE`, `BUSINESS_UPDATE`, `BUSINESS_PAUSE`, `BUSINESS_RESUME`, `BUSINESS_RESUME_DENIED`, `BUSINESS_AUTO_RESUME`, `BUSINESS_AUTO_RESUME_DENIED`, `BUSINESS_DEACTIVATE`, `BUSINESS_REACTIVATE`, `BUSINESS_MEDIA_UPLOAD`, `BUSINESS_SELECT`, `BUSINESS_ADMIN_*`.
- `BusinessSerializer` — owner/Admin view exposes storage keys + full profile; PUBLIC view is a curated subset with NO internal keys (`logoKey`/`coverKey` removed); `isDeactivated` exposed on every view.

### Endpoints

| Endpoint                                                  | Access           | Behavior                                                                |
| --------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/businesses`                                 | Owner (exact)    | create business + owner link; trials, slugs, categories                 |
| `GET /api/v1/businesses`                                  | Owner (exact)    | list owned businesses                                                   |
| `GET/PATCH /api/v1/businesses/:id`                        | Owner + Tenant   | read / update profile (validation + conflicts)                          |
| `POST /api/v1/businesses/:id/pause`                       | Owner + Tenant   | indefinite or scheduled pause; message                                  |
| `POST /api/v1/businesses/:id/resume`                      | Owner + Tenant   | manual resume (active subscription)                                     |
| `POST /api/v1/businesses/:id/deactivate` / `…/reactivate` | Owner + Tenant   | lifecycle toggle per REQ-023                                            |
| `POST /api/v1/businesses/:id/select`                      | Owner + Tenant   | persist active business context (REQ-016/020/021/022 exported on `/me`) |
| `POST /api/v1/businesses/:id/logo` / `…/cover`            | Owner + Tenant   | multipart upload (mime allowlist, size cap)                             |
| `GET /api/v1/admin/businesses` (+`?search=`)              | Admin/SuperAdmin | platform list/search (read-only for Admin, writable for SuperAdmin)     |
| `GET /api/v1/admin/businesses/:id`                        | Admin/SuperAdmin | detail incl. owning account                                             |
| `PATCH …/deactivate …/reactivate …/pause …/resume`        | SuperAdmin only  | platform lifecycle management (REQ-041/042)                             |
| `GET /api/v1/public/businesses/:slug`                     | public           | curated page subset incl. pause message (REQ-207..216)                  |
| `GET /api/v1/public/businesses/:slug/logo\|cover`         | public           | stored media bytes                                                      |
| `GET /api/v1/public/businesses/:slug/qr`                  | public           | PNG QR for `{publicBaseUrl}/b/{slug}` (REQ-046/048/049)                 |

### Background job (`apps/api/src/jobs/business-scheduled-resume.job.ts`)

- BullMQ repeatable every-minute sweep → `BusinessService.autoResumeDueBusinesses` (SUPER_ADMIN system actor) → resumes due businesses or records denial, per subscription boundary (REQ-153/154/156).

### Dashboard (`apps/dashboard/src`)

- `business/OwnerBusiness.tsx` (REQ-016/017/018/019 create + switcher hub), `BusinessProfile.tsx` (profile, media, lifecycle), `AdminPanel.tsx` (list/search/manage), `pages/Dashboard.tsx` routing, `lib/business-api.ts`, extended `lib/api.ts` (`/me` actor with `businessId` + `ownedBusinessIds`, `api.patch`, `api.upload`).

### Public app (`apps/public/src`)

- Hash route `#/b/:slug` rendering the public business page (REQ-207 foundation): name/category/description/contact/address/links, pause message (REQ-146/148), logo/cover, QR, external map links. Booking entry point is the later booking module.

### Dev seed (`apps/api/src/seed/dev-seed.ts`)

- Owner seeded with two businesses (profile fields populated), preserving the 1 SA / 2 Admins identities.

## 3. Requirement → implementation → test mapping

| Req               | Statement (abbr.)                                      | Implementation                                                      | Test                                       |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------ |
| REQ-001 … 004     | Multi-tenant SaaS; business tenant; any type; generic  | business + business_owner schema, RLS windows                       | `rls-isolation.test.ts`, business-tenant A |
| REQ-005           | Self-service Owner registration                        | any authenticated owner creates + auto-owns                         | A (201 owns)                               |
| REQ-006           | 30-day trial per business                              | `trialEndsAt = now()+30d` on create                                 | A (≈+30 days asserted)                     |
| REQ-007           | One public booking URL per business                    | unique `publicSlug`; `publicUrl` derived                            | B (slug change → URL follows)              |
| REQ-008           | One QR code per business                               | QR PNG endpoint keyed by slug                                       | E (QR PNG; 404 unknown)                    |
| REQ-011           | Owners configure their own business                    | owner update endpoint                                               | B                                          |
| REQ-012/013       | 1 owner per business; owner → many businesses          | business_owner matrix                                               | A (owner link), C (isolation), D           |
| REQ-014           | Per-business dashboard context                         | `activeBusinessId` on `/me` + select                                | C (context switching)                      |
| REQ-016 … 019     | Selection / direct-open / create / switcher            | dashboard OwnerBusiness hub + `ownedBusinessIds`                    | C + dashboard builds                       |
| REQ-020/021/022   | Active identity visible; last selected remembered      | session `businessId` persisted on select                            | C (me reflects switch)                     |
| REQ-023           | Deactivated/expired openable by owner                  | deactivation ≠ deletion; owner list retains it                      | D (deactivate/reactivate)                  |
| REQ-045/046 … 053 | Public URL entry point / QR / unique slug / rejections | slug rules + public page + QR                                       | A (reserved/malformed), E, F               |
| REQ-125 … 141     | Subscription domain                                    | boundary: trial + resume gating (`SubscriptionAvailabilityService`) | G (resume blocked when invalid)            |
| REQ-143 … 149     | Pause/indefinite/scheduled/message/reopening shown     | pause service + public page fields                                  | D, F (pause message public)                |
| REQ-153 … 158     | Auto resume gating / indefinite stays paused / manual  | sweep job + resume gating                                           | G (due vs indefinite)                      |
| REQ-207 … 216     | Public business page subset                            | public controller + curated serializer + `apps/public`              | F                                          |

## 4. Test totals (last verified run)

- API integration: **63 passing** (6 files — front-door, identity ×3, RLS isolation, business-tenant 23 tests).
- API unit: **22 passing** (incl. `roles-guard.test.ts` exact-mode case). Shared unit: **4**. DB unit: **5**.
- Dashboard & public: `typecheck`, `lint`, `vite build` clean. API: `typecheck`, `lint`, prettier clean.
- Run: `npm run test:unit --workspace @werefa/api`; `npm run test:integration --workspace @werefa/api` (rebuilds `werefa_test`), executed with the repo root `.env` sourced.

## 5. Known gaps / deferred (out of Prompt 09 scope)

- Booking / schedule / services / customers / payments / notifications — later modules (Prompt 10+).
- Full subscription lifecycle (proof upload, admin review, grace, extend) — Domain 12 module; only trial + resume-gating boundary in place.
- Category management UI for growing the allowlist; categories stored as validated strings (no enum migration) per REQ-003/004.
- Storage is memory/local-file in dev; MinIO/S3 provider is deployment config (doc 16).
- Public page is a static foundation view; interactive booking enters with the booking module (REQ-045 entry point then becomes booking flow).

## 6. Commands that prove identity

```bash
set -a; . ./.env; set +a
npm run db:test:setup                 # rebuild werefa_test, apply migrations + RLS
npm run test:integration --workspace @werefa/api   # 63 tests incl. business-tenant
npm run test:unit --workspace @werefa/api          # 22 tests
npm run build --workspace @werefa/dashboard        # owner hub + profile + admin panel
npm run build --workspace @werefa/public           # /b/:slug public page
npm run seed:dev --workspace @werefa/api           # owner + 2 businesses, idempotent
# Live check: npm run dev:api + npm run dev:dashboard → create a business, edit profile,
# upload logo, pause (with/without date), select context; admin@… sees AdminPanel;
# public URL http://localhost:<port>/#/b/<slug> renders the public page + QR.
```
