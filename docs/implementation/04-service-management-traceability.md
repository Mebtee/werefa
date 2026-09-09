# 04 — Service Management Traceability (Prompt 10)

Maps every service-management capability to its formal requirement ID,
architecture document/section, implementation file, test location, and status.

See also: `04-service-management.md` (full implementation report).

## 1. Source-path mapping

Prompt 10 references `docs/requirements/*`; those paths DO NOT exist in this
repository (see `01-foundation-traceability.md` §1). The authoritative sources:

| Domain  | Actual location                                                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Req IDs | `docs/01-master-specification.md` §12 (REQ-070..081), §21 (REQ-214)                                                                                                                                                                          |
| Roles   | `docs/02-user-roles-permissions.md`                                                                                                                                                                                                          |
| Arch    | `docs/architecture/03-logical-architecture.md`, `05-domain-architecture.md`, `06-data-architecture.md`, `07-database-design.md`, `09-state-machines.md`, `14-auth-security-architecture.md`, `18-api-architecture.md`, `22-audit-logging.md` |
| ADRs    | `docs/architecture/adr/ADR-010-rest-api.md`                                                                                                                                                                                                  |

## 2. Requirement → architecture → implementation → test traceability

| Req ID  | Description                                                           | Architecture Ref                                 | Implementation Files                                                                                                                                          | Test(s)                                                                | Status                                                               |
| ------- | --------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| REQ-070 | Multiple services per business selectable for booking                 | arch/05 §Service aggregate                       | `prisma/schema.prisma` (Service model), `service.service.ts` (list/create)                                                                                    | service-management A (create multiple)                                 | IMPLEMENTED                                                          |
| REQ-071 | Base price (integer minor units) and duration (minutes)               | arch/06 §Service, arch/07 §money representation  | `schema.prisma` (basePriceMinor BIGINT, baseDurationMinutes INT, CHECKs), `service-input.ts` (readPriceMinor/readDurationMinutes), `service.serializer.ts`    | A (valid/invalid price+duration), A (float/string rejection)           | IMPLEMENTED                                                          |
| REQ-072 | Variations/options with price/duration adjustments                    | arch/05 §ServiceVariation, arch/06 §delta model  | `schema.prisma` (ServiceVariation, signed deltas), `service.service.ts` (createVariation/updateVariation + assertDeltasValid), `service-input.ts`             | E (signed deltas, effective totals)                                    | IMPLEMENTED                                                          |
| REQ-073 | Add-ons with additive price/duration deltas                           | arch/05 §AddOn, arch/07 §add-on CHECKs           | `schema.prisma` (AddOn, non-negative CHECKs), `service.service.ts` (createAddOn/updateAddOn), `service-input.ts` (readAddOnDeltaMinutes)                      | F (non-negative, free add-on, duplicates rejected)                     | IMPLEMENTED                                                          |
| REQ-074 | Total duration = sum of selected service durations                    | arch/05 §booking composition                     | delta model foundation; actual composition deferred to booking module (Prompt 12)                                                                             | L (variation deltas stable on base edit)                               | PARTIAL                                                              |
| REQ-075 | Total price derived from selected services/components                 | arch/05 §booking composition                     | delta model foundation; actual composition deferred to booking module                                                                                         | L (delta preservation on edit)                                         | PARTIAL                                                              |
| REQ-076 | Existing bookings preserve original snapshots                         | arch/05 §snapshot, arch/07 §immutable snapshot   | `future-bookings.seam.ts` (contract boundary); actual snapshot rows belong to booking module                                                                  | L (future-booking seam returns 0; contract documented)                 | DEFERRED                                                             |
| REQ-077 | Services with future bookings cannot be hard-deleted                  | arch/05 §no-delete invariant, arch/09 §lifecycle | `service.service.ts` (remove → `futureBookings.countFutureBookings`), `future-bookings.seam.ts`                                                               | G (delete without bookings), L (seam = 0 contract), J (DELETE_BLOCKED) | IMPLEMENTED (seam returns 0; blocked path active when bookings land) |
| REQ-078 | Such services can be deactivated instead                              | arch/09 §deactivate-not-delete                   | `service.service.ts` (deactivate), `service.controller.ts` (POST deactivate), `rls.sql` (is_active)                                                           | D (deactivate → public invisible, 409 double deactivate)               | IMPLEMENTED                                                          |
| REQ-079 | Deactivated services hidden from public/not selectable                | arch/05 §public catalog, arch/07 §public_select  | `rls.sql` (`*_public_select` WHERE is_active=true), `service.service.ts` (listPublic filters isActive), `service.serializer.ts` (publicView)                  | D (public catalog), E/F (public omits inactive children)               | IMPLEMENTED                                                          |
| REQ-080 | Existing bookings unchanged by deactivation                           | arch/05 §snapshot immutability                   | deactivation flips is_active only; rows/children retained; snapshot write is booking-module responsibility                                                    | D (data unchanged after deact), L                                      | IMPLEMENTED                                                          |
| REQ-081 | Deactivated services can be reactivated                               | arch/09 §lifecycle                               | `service.service.ts` (reactivate), `service.controller.ts` (POST reactivate)                                                                                  | D (reactivate → back on public, 409 double reactivate)                 | IMPLEMENTED                                                          |
| REQ-214 | Public page content: services, prices, durations, variations, add-ons | arch/18 §public endpoints                        | `service-public.controller.ts` (GET public/:slug/services), `service.serializer.ts` (publicView/PublicServiceDto), `apps/public/src/App.tsx` (ServiceCatalog) | D (public field exposure = only approved subset)                       | IMPLEMENTED                                                          |

## 3. Cross-cutting capability traceability

| Capability                                 | Architecture Ref                        | Implementation Files                                                                                                                            | Test(s)                                                                                     | Status                                               |
| ------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Service ownership (tenant-scoped)          | arch/04 §tenant isolation               | `rls.sql` (service_*_owner policies), `tenant-executor.ts` (withOwnerBusinessContext), `tenant.guard.ts`, `service.controller.ts` (@RolesExact) | C (owner B ≠ owner A), AC/AD/AE/AF (RLS cross-tenant), AG (spoofed business_id)             | IMPLEMENTED                                          |
| Strict Owner authorization                 | arch/14 §role model, 02-roles-perms     | `roles.decorator.ts` (@RolesExact), `roles.guard.ts` (exact mode), `service.controller.ts` (class-level @RolesExact(Role.Owner))                | C (Admin/SA blocked), H (role hierarchy non-inheritance)                                    | IMPLEMENTED                                          |
| Money representation (integer minor units) | arch/06 §data model, arch/07 §DB design | `schema.prisma` (BIGINT), `service-input.ts` (readInt, readPriceMinor), `service.serializer.ts` (minor())                                       | A (integers only, no floats), monetary precision in builds                                  | IMPLEMENTED                                          |
| Duration representation (whole minutes)    | arch/07 §DB design                      | `schema.prisma` (INTEGER, CHECK >0), `service-input.ts` (readDurationMinutes >=1)                                                               | A (integer minutes, >= 1)                                                                   | IMPLEMENTED                                          |
| Public catalog (SELECT-only, curated)      | arch/18 §public API                     | `service-public.controller.ts`, `service.serializer.ts` (publicView — no business_id/lifecycle/timestamps), `rls.sql` (PUBLIC scope)            | D (field exposure), K (state-changing verbs not routed), AB (no inactive data in public)    | IMPLEMENTED                                          |
| Audit/security events                      | arch/22 §audit logging                  | `service.service.ts` (security.record for all mutations), event types SERVICE_*                                                                 | J (events recorded with actor + business scope)                                             | IMPLEMENTED                                          |
| Concurrency (DB final boundary)            | arch/07 §constraints                    | Unique indexes (business_id+name, service_id+name), Prisma P2002 → 409                                                                          | I (parallel create 201/409, parallel update both succeed)                                   | IMPLEMENTED                                          |
| Historical snapshot boundary               | arch/05 §snapshot contract              | `future-bookings.seam.ts` (documentation + contract), `service.service.ts` (never touches booking data)                                         | L (deltas stable, seam contract, no fabricated booking store)                               | DEFERRED (snapshot rows written by Prompt 12)        |
| Multiple-service booking contract          | arch/05 §multi-service booking          | Service model exposes stable basePriceMinor/baseDurationMinutes for later composition; no restriction on service reuse per booking              | A (multiple services can be created per business), model allows multiple booking references | PARTIAL (model supports it; booking module enforces) |
| RLS policies (service, variation, add_on)  | arch/04 §defense-in-depth               | `rls.sql` (FORCE RLS, 5 policies per table), `bootstrap-rls.ts` (idempotent apply)                                                              | AC/AD/AE/AF/AG/AH (RLS isolation tests), rls-isolation.test.ts §service catalog             | IMPLEMENTED                                          |
| Deletion protection seam                   | arch/09 §state machines                 | `future-bookings.seam.ts` (countFutureBookings boundary), `service.service.ts` (rejects if > 0)                                                 | G (delete succeeds when 0), L (seam returns 0)                                              | IMPLEMENTED (returns 0; blocks when bookings exist)  |

## 4. Implementation status summary

| Category                                     | Status                                          |
| -------------------------------------------- | ----------------------------------------------- |
| Service CRUD (create/list/get/update)        | IMPLEMENTED                                     |
| Service lifecycle (deactivate/reactivate)    | IMPLEMENTED                                     |
| Service deletion (with future-booking guard) | IMPLEMENTED (guard seams to booking module)     |
| Variations (signed deltas)                   | IMPLEMENTED                                     |
| Add-ons (non-negative deltas)                | IMPLEMENTED                                     |
| Public catalog (active services only)        | IMPLEMENTED                                     |
| Owner API (all endpoints)                    | IMPLEMENTED                                     |
| Dashboard UI (ServicesManager)               | IMPLEMENTED                                     |
| Public UI (ServiceCatalog)                   | IMPLEMENTED                                     |
| RLS (3 tables, 15 policies)                  | IMPLEMENTED                                     |
| Authorization (strict Owner)                 | IMPLEMENTED                                     |
| Audit events (12 event types)                | IMPLEMENTED                                     |
| Database constraints/indexes                 | IMPLEMENTED                                     |
| Money representation (integer minor units)   | IMPLEMENTED                                     |
| Duration representation (whole minutes)      | IMPLEMENTED                                     |
| Historical booking snapshots                 | DEFERRED (booking module Prompt 12)             |
| Total price/duration composition             | DEFERRED (booking module Prompt 12)             |
| Service ordering/display order               | NOT IMPLEMENTED (not required by approved REQs) |
| Service description field                    | NOT IMPLEMENTED (not required by approved REQs) |

## 5. Deferred capabilities (not in Prompt 10 scope)

- **Booking-time snapshot rows (REQ-076/080):** the `FutureBookingsSeam` establishes the contract boundary. Actual snapshot tables and write logic belong to Prompt 12.
- **Multi-service composition (REQ-074/075):** total duration = sum of services; total price derived from components. The service model supports this; the composition logic is part of the booking flow.
- **Service ordering:** not required by any approved requirement; deliberately omitted.
- **Service description/details:** not required by any approved requirement; deliberately omitted.
