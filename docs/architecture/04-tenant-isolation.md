# 04 — Tenant Isolation

> **Architecture Version:** 1.0.0 | **Source Spec:** Werefa v0.5.0 | **Date:** 2026-09-05 | **Status:** APPROVED — PROMPT 06

## 1. Model

**Shared-schema multi-tenancy** (ADR-003): one database, per-tenant rows. Rationale: single monthly price, no tiers (REQ-125/126), no product requirement for tenant-level hardware isolation, and transactional needs (slot locking, subscriptions) benefit from shared ACID infra. Isolation is enforced by the application **and** by PostgreSQL RLS as defense-in-depth.

## 2. Tenant identifier strategy

- **Primary tenant key:** `business_id UUID` (surrogate, never reused). Every tenant-owned table carries `business_id`.
- **Public identifier:** `public_slug` (unique, validated `^[a-z0-9][a-z0-9-]{3,62}[a-z0-9]$` — REQ-047), used for public URL/QR (REQ-007/008/046). Changes re-point the QR target (REQ-049) and old slugs are reserved (REQ-048).
- **One business = one queue/schedule** (REQ-009); no staff-level tenancy (REQ-010).
- Owners may own many businesses (REQ-013); an owner-permission table `BusinessOwner(user_id, business_id)` is the ownership matrix. Business switching (REQ-016/019) selects the active business from that matrix.

## 3. Every tenant-owned record is associated with a business

| Table group                                                                         | Tenant column                                                       | Notes                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Business-owned configuration (settings, category, services, schedules, pause, page) | `business_id` FK → `business.id`                                    | —                                                        |
| Transactional (booking, payment, proof, slot lock, subscription, history)           | `business_id` (denormalized FK on every row, including history)     | Always set; history rows keep it for scoping reports/PDF |
| Owner-linked (user accounts)                                                        | owners are **not** tenant rows; ownership via `business_owner` join | A user may serve multiple businesses                     |
| Platform-level (users, admins, sessions, security events)                           | not tenant-scoped; own visibility rules                             | Admin/SuperAdmin access governed by role                 |

## 4. Tenant-aware authorization

| Layer              | Mechanism                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session            | Cookie → server-side `Session` row → `ActorContext { role, userId, activeBusinessId? }`                                                                    |
| Middleware         | Resolves tenant from route context; sets `TenantContext`                                                                                                   |
| Guards             | NestJS guards enforce role + tenant scope on every handler (doc 18)                                                                                        |
| Repository/service | Every tenant query method takes `businessId` explicitly; there is **no** public "get entity by id" that lacks a tenant parameter                           |
| RLS                | `CREATE POLICY` on all `business_id` tables for the database role used by the API (defense-in-depth — bypassed only by service account role in migrations) |
| Query scoping      | WHERE clauses always include `business_id = $1` (or `business_id IN (owned)`); never rely on HTTP id alone                                                 |

## 5. Prevention of cross-tenant access — owner paths

Rule: an owner may only ever see/modify rows where `business_id ∈ ownedBusinessIds(session)`. Enforcement pattern for every owner endpoint:

1. Resolve resource id from request (e.g., booking_id).
2. Resolve owning business of the resource **inside the query** (join or filter), not as a separate step that trusts request context.
3. Compare against the session-owned set in the same SQL predicate.

**Example — reschedule:** `UPDATE booking SET ... WHERE id=$1 AND business_id IN (SELECT business_id FROM business_owner WHERE user_id=$2)`. No two-step id→tenant trust.

## 6. Admin cross-tenant access

- Admins operate at **platform level but with restricted business data views**: review subscription proofs (REQ-137) and see current booking status only (REQ-176). They do **not** see schedule history (REQ-168) or full booking history (REQ-176).
- Subscription-review queries are scoped to pending subscription payments; booking status views return current status only (no history join).
- Admin access is granted by role and further constrained by **view filters** (REQ-176/168), not by tenant membership.

## 7. Super Admin cross-tenant access

- Super Admin may view all relevant data (REQ-041): full booking history (REQ-177), schedule history (REQ-167), security history (REQ-203), PDF export across all businesses or one selected (REQ-180).
- Implemented via an **elevated tenant scope** (`businessId optional` = "all"), still routed through the same read models/queries but with an explicit `SUPER_ADMIN` audit marker on sensitive reads/exports. Deletion paths (REQ-205) are narrow (security records) and always audited (REQ-206).

## 8. Background-job tenant context

- Every job carries an explicit `businessId` (or is platform-level with no tenant rows).
- Jobs re-resolve the business in their own transaction; they never inherit a stale HTTP tenant context.
- Cross-business jobs (Super Admin PDF export over all businesses) are platform-level and mark their output with a Super Admin trigger + audit entry (REQ-178/180).

## 9. File-storage tenant isolation

- Storage keys embed the tenant: `{env}/business/{businessId}/...` (doc 16). Access control never relies on the key alone — presigned URLs are scoped server-side to the authenticated principal's tenant; proofs are never public (REQ/§: "Never make payment proof publicly accessible").

## 10. Reporting tenant isolation

- Owner reports/history: only their businesses (REQ-174).
- Super Admin exports: all businesses or exactly one selected (REQ-180); multi-select not allowed (REQ-181). PDF is generated server-side from a scoped query and stored with the requesting tenant scope + audit entry (REQ-182).

## 11. Audit implications

- Every history record (`booking_status_history`, `schedule_version`, `security_event`, `audit_event`) records actor + business scope.
- Cross-tenant reads by Admin/Super Admin are visible in audit only where the functional spec says so (deletion audited REQ-206; reports/PDF documented in doc 21). Owner history views stay tenant-scoped (REQ-174).

## 12. Dangerous failure modes and safeguards

| Failure mode                                           | How it could happen                             | Safeguard                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /bookings/:id` returns another business's booking | Service reads by ID without tenant predicate    | No id-only reads exposed; tenant predicate mandatory; RLS second wall                                                 |
| Availability leaks across tenants                      | Scheduling engine queries without `business_id` | Engine API requires `businessId`; tests assert isolation                                                              |
| Owner of business A modifies business B's schedule     | Tenant context from a stale business switch     | Context re-derived per request from `BusinessOwner` join; never cached across requests without revalidation           |
| Worker touches wrong business rows                     | Job loses tenant context                        | Job payload carries `businessId`; service re-scopes; RLS applies                                                      |
| Admin leaks schedule history                           | Admin dashboard queries history endpoint        | Handler-level guard denies by role (REQ-168); history query also requires role allow-list                             |
| Presigned proof URL used by another customer           | URL obtained by sharing                         | URLs short-lived (5 min) and issued only to the owner/Admin for that business's proofs; object key unguessable (UUID) |
| Report PDF mixed tenants                               | Export query missing business filter            | Export path requires either `businessId` or explicit `all` scope; audit records the scope                             |
| Slug collision → wrong public page                     | Slug uniqueness race                            | Unique index on `public_slug`; validation (REQ-048)                                                                   |

## 13. Explicit non-goals

- No per-tenant database, schema prefix, or connection routing faster than shared schema (not required; complexity unjustified).
- No customer isolation model (customers have no accounts — REQ-040). Customer identity is booking-scoped (phone), so "tenant" for customers is the business they booked with.
