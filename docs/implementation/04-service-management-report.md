# 04 — Service Management (Prompt 10) — Section 38 Final Report

Status: **IMPLEMENTED** · Final quality-gate run: **all green** · This report is the
Prompt 10 §38 close-out. Prompt 11 (Bookings/Scheduling) was **NOT** started.

## 1. Conformance summary

| Dimension               | Result                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement coverage    | REQ-070 … REQ-081 fully implemented; REQ-214 public projection implemented                                                                                       |
| Deferred (out of scope) | Booking-time composition, immutable per-booking snapshots (REQ-076/080) — Booking module (Prompt 11); REQ-077 guard branch reachable when a booking store exists |
| Explicitly omitted      | Ordering / description fields (no approved REQ demands them); Admin/Super Admin service endpoints (strict Owner-only)                                            |
| Prompt 11 status        | NOT started — no scheduling/booking/payment/Telegram work introduced in this session                                                                             |

## 2. Quality gate (final, this session)

| Step                 | Command                                               | Result                                                                                                                                           |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Format            | `npm run format:check`                                | PASS (0 files flagged)                                                                                                                           |
| 2. Lint              | `npm run lint` (all workspaces)                       | PASS (0 errors)                                                                                                                                  |
| 3. Typecheck         | `npm run typecheck` (all workspaces)                  | PASS (0 errors)                                                                                                                                  |
| 4. DB bootstrap      | `npm run db:test:setup`                               | PASS — clean `werefa_test` build: 6 migrations (incl. `20260905_000500_service_catalog`) + RLS                                                   |
| 5. Smokes/invariants | dev migrate + `db:rls` against `werefa`               | PASS                                                                                                                                             |
| 6. Unit tests        | `npm run test:unit`                                   | PASS — API **24** (5 files), DB **5**, Shared **4**                                                                                              |
| 7. Integration tests | `npm run test:integration`                            | PASS — **97** tests, 7 files, fileParallelism=false (each file bootstraps its own Nest app)                                                      |
| 8. Builds            | `npm run build` (all workspaces)                      | PASS — API `nest build`, dashboard + public `vite build`, db + shared `tsc`                                                                      |
| 9. Startup smoke     | `node apps/api/dist/main.js` → `/api/v1/health/ready` | PASS — `{"status":"ok","db":"up"}` within 1s; secret masking confirmed: `DATABASE_URL:"***"`, `S3_SECRET_ACCESS_KEY:"***"`, `REDIS_URL:"***"`, … |

Numeric deltas vs the previous run: integration **96 → 97** (new RLS child-write test), API unit **22 → 24** (new REQ-077 deletion unit tests).

## 3. Coverage strengthening added in this close-out

Previously the behavior behind two boundaries was pinned only indirectly; both are now asserted directly:

1. **REQ-077 blocked hard-delete (Prompt test S)** — `apps/api/test/unit/service-deletion.test.ts` (2 tests). Stubs the `FutureBookingsSeam` (never a fake Booking table):
   - seam returns >0 → `remove()` throws a Conflict (code `CONFLICT`, http 409, detail "…future bookings…"), records exactly one `SERVICE_DELETE_BLOCKED`/`DENIED` event with actor + business scope, and **never opens a DB transaction** (`$transaction` spy not called).
   - seam returns 0 → no `SERVICE_DELETE_BLOCKED` event is emitted (branch must not fire spuriously).
   - This exercises the exact order of `service.service.ts` `remove()`: seam check **before** the tenant transaction.
2. **RLS on `service_variation` / `add_on` children (Prompt tests X/Y, AC–AF application to children)** — `apps/api/test/integration/rls-isolation.test.ts` (1 new test). With `app.business_id` spoofed to a tenant A that owns **neither** the target rows nor the target service:
   - `UPDATE`/`DELETE` of B's variation and add-on rows → **0 rows affected** (AE/AF `USING` policies).
   - `INSERT` of a child into B's service → **row-level security violation** (AD `WITH CHECK` policy), for both child tables.
   - Reads on children were already covered; writes are now covered too. (Table `service` full WRITE isolation was already asserted by the existing RLS suite.)

## 4. Feature completeness (via `04-service-management.md` + traceability doc)

- **IMPLEMENTED:** service CRUD + deactivate/reactivate (`is_active` lifecycle, repeated transition → 409); variations with signed price/duration deltas; add-ons with non-negative deltas; effective-total invariant (base ± delta ≥ 0 minor / ≥ 1 min) re-validated on base edits; integer-minor money + whole-minute durations everywhere (no floats); `FutureBookingsSeam` delete boundary + `SERVICE_DELETE_BLOCKED` audit path; strict `@RolesExact(Role.Owner)` on all 17 owner routes (Admins/Super Admins do not inherit); FORCE RLS on `service`/`service_variation`/`add_on` (OWNER + SUPER_ADMIN windows, PUBLIC SELECT with `is_active = true`); public catalog endpoint + curated serializer (no internal fields); dashboard `ServicesManager` (create/edit/deactivate/reactivate/delete + per-child editors); public catalog cards; audit events `SERVICE_CREATE/UPDATE/DEACTIVATE/REACTIVATE/DELETE/DELETE_BLOCKED`, `VARIATION_*`, `ADDON_*`.
- **PARTIAL / DEFERRED (documented, not fabricated):**
  - Booking-time composition (REQ-074/075) and immutable per-booking snapshots (REQ-076/080) — belong to the Bookings module (Prompt 11). The catalog keeps child deltas stable so snapshots remain truthful.
  - REQ-077 guard branch reachability — initially the seam returned 0 (no booking store
    existed); since Prompt 11 a live booking store exists, so the `SERVICE_DELETE_BLOCKED`
    branch is now truly reachable (see `05-booking-management-report.md`).
- **NOT IMPLEMENTED by design:** ordering and description fields (no approved REQ requires them — assertion recorded in `04-service-management.md` §5); platform-tier service management (Owner-only per `02-user-roles-permissions.md`).

## 5. Architectural consistency checks (final pass)

- Items 1–12 (RoleExact, RLS windows, no premature booking/scheduling/payment/Telegram scope, deactivate-not-delete, no invented states, no floats, no cross-tenant re-scope, sub-id re-scoping, public serialization hygiene, unique constraints, snake_case/DB design, event audit) — confirmed via the implementation doc matrix, traceability doc, and the 97-test integration suite.
- Item 13 — every uuid GUC read uses `NULLIF(current_setting(...), '')::uuid` (no unsafe empty-string casts); verified at `rls.sql` line 56 and in the new child-write tests.
- Item 14 — no `INSERT … RETURNING` / creation-window regression: Prompt 09's `app.creating` windows are untouched; service children project via OWNER select because a just-inserted child's business is already owned (no new window introduced).
- Seed (`npm run seed:dev --workspace @werefa/api`) is idempotent and dev-only; existing seeded businesses gain working service catalogs.

## 6. Evidence / artifacts

- `docs/implementation/04-service-management.md` — implementation + REQ→impl→test matrix (§3) + gap list (§5).
- `docs/implementation/04-service-management-traceability.md` — REQ → architecture → implementation → test traceability matrix with IMPLEMENTED/PARTIAL/DEFERRED status.
- `docs/implementation/README.md` — index updated to include the traceability doc.
- `apps/api/test/unit/service-deletion.test.ts` — new (REQ-077 blocked-delete contract).
- `apps/api/test/integration/rls-isolation.test.ts` — extended (child-table write isolation).
- Reproducible gate: `set -a; . ./.env; set +a` then the commands in §2 (Postgres 5433 / Redis / MinIO / MailHog via `infra/docker-compose.yml`).

## 7. Prompt 11 boundary declaration

No changes were made toward Bookings, Scheduling, Payments, or Telegram in that
(Prompt 10) session. The only forward-looking hooks introduced were (a) the `FutureBookingsSeam`
integration point and (b) the `ServiceCatalog` projection consumed by the booking
module later. **Prompt 11 has since landed** — see `05-booking-management-report.md`.
