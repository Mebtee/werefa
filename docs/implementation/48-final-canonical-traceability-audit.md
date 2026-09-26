# 48 — Final Canonical Traceability & Implementation-Integrity Audit

Prompt: **Prompt 63 — Werefa Final Canonical Traceability & Implementation Integrity Audit**
Status: **COMPLETE** — full audit + safe documentation corrections
Report date: 2026-09-26
Repository: Werefa (`master`, uncommitted working tree; no commit made)

> **Current repository state is authoritative over stale historical classifications.**

---

## 1. Executive summary

This Prompt performed a final, independent, requirement-level traceability audit of
**REQ-001 … REQ-232** against the **current repository** — not against earlier
reports. Every requirement was classified into exactly one of the four permitted
categories (A implemented / B partial–deployment/provider input required /
C blocked–specification insufficient / D deferred by design), with backend,
frontend, test, file and canonical-section evidence. The counts were recalculated
from scratch.

**Outcome**

- Final counts: **A = 214, B = 12, C = 3, D = 3** (total **232**).
- **No source-behavior change was required.** The single fully-specified gap
  (REQ-230 code delivery) was already closed in Prompt 63's first pass; this audit
  independently re-verified it in the current tree.
- **Safe documentation corrections: 3** — three stale source comments that still
  described delivery as "out of scope", contradicting the current
  implementation/classification. No behavior changed.
- The canonical specification was **not modified** (SHA-256 unchanged).
- **No commit was created** (HEAD unchanged at `80a69ff`).

The counts differ from report 44's raw tally (228 I / 1 P / 3 B / 3 D) and from the
Prompt 62 baseline (A=215 / B=11): the email-dependent requirements are moved from
A to B, and this audit additionally found **REQ-196** cannot be A (see Section 6).
Report 44 had wrongly treated REQ-026–031 and REQ-033 as implemented, and had not
separated mechanism-only email delivery (REQ-195/198/221) from true implementation.

## 2. Starting repository state

- Branch `master`; HEAD `80a69ff1aefcb06e5336547dd85bf23dbadf75d0` (unchanged).
- Working tree: **121** uncommitted entries (the implementation remains entirely
  uncommitted by design); reports `44`–`47` already existed.
- `backend/` — NestJS modular monolith + Prisma/PostgreSQL; `frontend/` — React 19
  + Vite 6.
- No `infrastructure/` directory and no Dockerfiles; only
  `backend/docker-compose.dev.yml` (PostgreSQL 16, host port 5433). Container
  `werefa-db-dev` was healthy (up, ~3 h) during the DB gates.
- 7 migrations under `backend/prisma/migrations/`; the last two share the
  timestamp prefix `20260923120000` (accepted, reported in 45).
- 10 DB-gated spec files read `TEST_DATABASE_URL` + `RUN_DB_TESTS==='true'`.

## 3. Canonical specification hash

Before work and recomputed at the end (Section 22):

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Equal to the required digest. The `REQ-###` heading count is **232**
(`grep -cE "^#### REQ-[0-9]+ — "` → 232; first `REQ-001`, last `REQ-232`).

## 4. Audit methodology

1. **Specification-first inventory.** Enumerated all 232 headings and their
   statements from the canonical file only.
2. **Repository as source of truth.** Each requirement was traced to current
   source and current tests in `backend/` and `frontend/`; reports 44/45/47 were
   used as *evidence to re-check*, never as authority.
3. **Special-area deep checks** (Section 15–19): email, Telegram, booking
   lifecycle, subscription, security, concurrency/idempotency, schedule.
4. **Classification.** One class per requirement, using only A/B/C/D. Any apparent
   gap was re-read in the spec, inspected in code, checked against tests and prior
   reports, and only then classified.
5. **Safe-gap rule** (Section 13): a fix was made only if it was required by the
   spec/existing contract, needed no product/provider/deployment decision, and
   changed no intended behavior.
6. **Count reconciliation** (Section 6): recomputed independently and explained.
7. **Gates** (Section 20): all backend/frontend gates; DB tests twice.

## 5. Classification scheme

| Class | Meaning |
| --- | --- |
| **A — IMPLEMENTED** | Canonical behavior present in current code, with meaningful implementation evidence (and usually an automated test). |
| **B — PARTIAL — DEPLOYMENT/PROVIDER INPUT REQUIRED** | The in-repo mechanism exists, but the remaining behavior needs an approved external provider/deployment input (here: an external email sender). Not "work remains a safe fix could close". |
| **C — BLOCKED — SPECIFICATION INSUFFICIENT** | The canonical specification leaves the required behavior open, so no faithful implementation exists. |
| **D — DEFERRED BY DESIGN** | Intentionally out of Phase 1 by the canonical spec; correctly absent, not a gap. |

## 6. Final classification counts

| Class | Count | Requirements |
| --- | --- | --- |
| **A — IMPLEMENTED** | **214** | All except the B/C/D rows below |
| **B — DEPLOYMENT/PROVIDER** | **12** | REQ-026, 027, 028, 029, 030, 031, 032, 033, 195, 196, 198, 221 |
| **C — BLOCKED** | **3** | REQ-094, 095, 139 |
| **D — DEFERRED** | **3** | REQ-025, 034, 115 |
| **Total** | **232** | |

### Reconciliation against the Prompt 62 baseline

The Prompt 62 baseline was A=215 / B=11 / C=3 / D=3. This Prompt recalculated the
counts from the current tree and found **one** requirement changed class:

- **B (now 12; was 11).** REQ-026–033 (owner email verification / blocked
  dashboard / time-limited + replaceable + invalidating links / rate-limited
  requests / auto-auth / forgot-password) have **no flow at all** in this rebuild:
  the auth controller exposes only `login`, `register`, `logout`,
  `password/change`, `security`, `session`, and no email-verification token table
  exists (Section 17). REQ-195/198/221 have a complete in-repo mechanism (outbox
  event + email template + delivery worker) whose actual send is **suppressed**
  because `EMAIL_PROVIDER` binds to `DisabledEmailProvider`. A provider binding is
  a deployment input, not a product decision.
- **REQ-196 — moved A → B (the one changed requirement).** The requirement is
  "the lockout email SHALL include the IP and device/browser". Inspecting the
  current tree, the `LOCKOUT_EMAIL` event is published as
  `{ type, userId, email, occurredAt }` with **no IP/device**, and
  `writeAuthEmailEvent` writes `payloadRef: null`, so
  `NotificationDeliveryService.emailData` has nothing to render; `emailTemplate`
  returns only an id/subject and no auth email body is ever produced. The
  requirement therefore cannot be delivered even with a configured provider until
  the email content slice exists, so it belongs in the same provider-dependent
  bucket as REQ-195. (The IP/device *capture* itself is implemented at the
  security-event layer — REQ-192 — but that is a different requirement.) The
  Prompt 62 baseline had left REQ-196 as A; that is now corrected.
- **C (3).** REQ-094/095 have no canonical deep-link/quick-action or grouping
  contract; REQ-139 depends on §46 item 3 (lead-time default). Unchanged.
- **D (3).** REQ-025/034/115 remain Phase-1 exclusions. Unchanged.
- No requirement moved from A because report 44's "228 implemented" was already
  corrected by Prompt 62; this audit re-derived the corrected figure directly.

## 7. Traceability matrix — REQ-001 … REQ-232

Legend: **A** implemented · **B** partial (provider/deployment) · **C** blocked ·
**D** deferred. `§` = canonical section(s). Evidence that could not be verified
as present is marked "(none found)".

### Domain 40.1 — Platform tenancy & owner context (REQ-001 … REQ-023)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | Multi-tenant SaaS platform | A | Every repository scoped by `businessId`; `TenantGuard` | owner/customer/admin apps | `domain-services.db.spec.ts` (tenant isolation) | `src/domain/authorization/tenant-guard.ts` | §40.1 |
| 002 | Business as separate tenant | A | `business` model + per-tenant scoping | — | DB specs | `prisma/schema.prisma` | id not cited in code |
| 003 | Any business type may register | A | `BusinessService.createBusiness` | registration UI | `http-api.db.spec.ts` | `business.service.ts` | — |
| 004 | Generic architecture not tied to target types | A | `business_category` enum `SALON_AND_BARBER`/`OTHER` | category select | `domain-services.db.spec.ts` | `catalog`/`business` | — |
| 005 | Self-service owner registration | A | `AuthService.registerOwner` | `RegisterPage` | `http-auth.db.spec.ts` | `auth.service.ts` | — |
| 006 | 30-day free trial per new business | A | trial seed / `trialEndsAt` | subscription panel | `http-subscription.db.spec.ts` | `subscription.service.ts` | — |
| 007 | One public booking URL per business | A | `publicSlug` | `/p/:slug` route | `http-api.db.spec.ts` | `public.controller.ts` | — |
| 008 | One QR code per business | A | QR derived from slug | profile QR view | frontend owner tests | `BusinessProfilePage.tsx` | — |
| 009 | One shared queue/schedule | A | single active `schedule_version` | schedule editor | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 010 | No individual staff/barber booking links | A | no staff model exists | no staff UI | absence by design | — | id not cited |
| 011 | Owners configure their own business | A | `business`/`catalog` controllers | owner portal | `http-api.db.spec.ts` | `owner/*.controller.ts` | — |
| 012 | One business has one owner relationship | A | `business_owner` | — | DB specs | `prisma/schema.prisma` | — |
| 013 | One owner may manage multiple businesses | A | `listByOwner` | `OwnerBusinessSelection` | `OwnerBusinessSelection.test.tsx` | `business.service.ts` | — |
| 014 | Per-business dashboard context | A | tenant-scoped reads | `OwnerLayout`, `useOwnedBusiness` | `OwnerPortal.test.tsx` | `OwnerLayout.tsx` | — |
| 015 | Independent subscription per business | A | `subscription` keyed by business | subscription card | `http-subscription.db.spec.ts` | `subscription.service.ts` | — |
| 016 | Post-login selection when multiple businesses | A | owner context | `OwnerBusinessProvider` | `OwnerPortal.test.tsx` | `useOwnedBusiness.ts` | — |
| 017 | Direct open when exactly one business | A | owner context | auto-select | `OwnerPortal.test.tsx` | `OwnerBusinessProvider` | id not cited |
| 018 | Show Create Business when none exists | A | owner context | empty state | `OwnerPortal.test.tsx` | `OwnerBusinessProvider` | — |
| 019 | Business switcher from main dashboard | A | owner context | combobox | `OwnerPortal.test.tsx` | `OwnerLayout.tsx` | — |
| 020 | Active business identity visible | A | owner context | header | `OwnerPortal.test.tsx` | `OwnerLayout.tsx` | — |
| 021 | Last selected business remembered | A | owner context | `localStorage` | `OwnerPortal.test.tsx` | `OwnerBusinessProvider` | — |
| 022 | Automatic open of last business next login | A | owner context | restore | `OwnerPortal.test.tsx` | `OwnerBusinessProvider` | — |
| 023 | Deactivated/expired businesses openable | A | auth guard + warning | subscription warning UI | `http-auth.db.spec.ts` | `subscription` UI | — |

### Domain 40.2 — Authentication & roles (REQ-024 … REQ-044)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 024 | Phase 1 email/password login | A | `AuthService.login` | `LoginPage` | `http-auth.db.spec.ts`, `http-auth.spec.ts` | `auth.service.ts` | §40.2 |
| 025 | Google login not part of Phase 1 | D | absent by design | no Google button | — | — | §12.2/§43 |
| 026 | Owner email verification required | B | account created `isEmailVerified=false`; no verification flow/route/token table | no verify page | (none found) | `auth.service.ts` | needs email sender; §40.2 |
| 027 | Unverified users blocked from dashboard | B | nothing gates unverified accounts (no verification transition exists) | — | (none found) | — | depends on 026 |
| 028 | Verification links time-limited | B | no verification link exists | — | (none found) | — | — |
| 029 | Expired verification link replacement | B | no verification link exists | — | (none found) | — | — |
| 030 | Verification request rate limiting | B | no verification request endpoint exists | — | (none found) | — | — |
| 031 | New verification link invalidates previous | B | no verification link exists | — | (none found) | — | — |
| 032 | Successful verification may auto-authenticate | B | depends on absent verification slice (MAY) | — | (none found) | — | — |
| 033 | Forgot-password via email reset | B | no reset-by-email flow/endpoint | no forgot-password page | (none found) | `auth.controller.ts` | needs email sender |
| 034 | 2FA-ready Phase 1 architecture | D | session/credential model is extension-ready; 2FA not enforced | — | — | `auth.service.ts` | §43 |
| 035 | Password change logs the user out everywhere | A | `changePassword` revokes all sessions | change-password UI | `http-auth.db.spec.ts` | `auth.service.ts` | — |
| 036 | Confirmed role set | A | `ActorRole` enum | role-aware UI | `http-auth.spec.ts` | auth domain | — |
| 037 | Exactly one Super Admin | A | uniqueness enforced | — | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |
| 038 | Exactly two Admin accounts | A | ≤2 active Admins, advisory-locked | admin panel | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |
| 039 | Only Super Admin manages Admin accounts | A | `requireSuperAdmin` | SA-only panel | `http-auth.db.spec.ts` | `admin.controller.ts` | — |
| 040 | Customers have no platform account | A | anonymous public/customer flow | no login for customers | `BookingFlow.test.tsx` | `customer.controller.ts` | — |
| 041 | Super Admin platform-wide access | A | role gates | SA dashboard | `http-auth.db.spec.ts` | `admin/*` | — |
| 042 | Admin restricted administrative access | A | `requireAdminOrSuperAdmin` | admin UI | `http-auth.db.spec.ts` | `tenant-guard.ts` | id not cited |
| 043 | Owner operates only within owned businesses | A | `requireOwnedBusiness` → NOT_FOUND | owner portal | `http-api.db.spec.ts` | `tenant-guard.ts` | id not cited |
| 044 | System actor for automatic changes | A | `ActorType.SYSTEM` transitions | — | `domain-services.db.spec.ts` | `booking.service.ts` | — |

### Domain 40.3 — Public booking & notifications (REQ-045 … REQ-069)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 045 | Public booking page is the entry point | A | `public.controller` | `PublicBookingPage` | `BookingFlow.test.tsx` | `public.controller.ts` | §40.3 |
| 046 | QR points to public URL | A | QR derived from slug | QR display | owner tests | `BusinessProfilePage.tsx` | — |
| 047 | Public URL slug unique | A | unique constraint + CONFLICT mapping | — | `http-api.db.spec.ts` | `business.service.ts` | — |
| 048 | Invalid/reserved slugs rejected | A | slug validator | inline error | `http-api.spec.ts` | `business.service.ts` | — |
| 049 | Slug change updates QR target | A | `changeSlug`, QR derived | profile UI | owner tests | `BusinessProfilePage.tsx` | — |
| 050 | Available times from schedule/duration/bookings/blocks | A | `AvailabilityService` | date/time step | `availability.test.ts` | `availability.service.ts` | — |
| 051 | Selecting a time does not lock it | A | availability is read-only | selection step | `BookingFlow.test.tsx` | `availability.service.ts` | — |
| 052 | Slot remains available until proof submitted | A | lock only on proof submit | — | `domain-services.db.spec.ts` | `booking.service.ts` | id not cited |
| 053 | Second customer gets unavailable for claimed slot | A | `SLOT_UNAVAILABLE` | error state | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 054 | Customer provides name and phone | A | booking DTO | booking form | `BookingFlow.test.tsx` | `booking.dto` | — |
| 055 | Booking note optional | A | `note` nullable | optional field | `BookingFlow.test.tsx` | `booking.service.ts` | — |
| 056 | Telegram optional during booking | A | connection optional | connect step | `telegram.db.spec.ts` | `telegram-connection.service.ts` | — |
| 057 | No history on public page | A | status lookup scoped to phone | no history list | `BookingStatusPage` tests | `customer.controller.ts` | — |
| 058 | Customer cannot cancel/modify | A | no customer mutation route | no cancel/modify UI | `BookingFlow.test.tsx` | `customer.controller.ts` | — |
| 059 | No booking via Telegram | A | webhook has no create path | — | `telegram.db.spec.ts` | `telegram-webhook.service.ts` | — |
| 060 | Proof-received notification | A | outbox N01/N02 | status page | `telegram.db.spec.ts` | `notification-catalog.ts` | — |
| 061 | Accepted/confirmed notification | A | outbox | status page | `telegram.db.spec.ts` | `notification-catalog.ts` | — |
| 062 | Rejection notification with reason | A | renderer | status page | `telegram.db.spec.ts` | `notification-message-renderer` | — |
| 063 | Reminder 24h before | A | `writeDueReminders` REMINDER_24H | — | `telegram.db.spec.ts` | `notification-delivery.service.ts` | — |
| 064 | Reminder 1h before | A | REMINDER_1H | — | `telegram.db.spec.ts` | `notification-delivery.service.ts` | — |
| 065 | Owner notified on proof submission | A | owner outbox N09 | owner dashboard | `telegram.db.spec.ts` | `notification-outbox-event-bus.ts` | — |
| 066 | Owner notification content | A | renderer (allow-listed) | — | `telegram.db.spec.ts` | `notification-message-renderer` | — |
| 067 | Owner can Accept from Telegram | A | `telegram-callback.service` | owner Telegram | `telegram.db.spec.ts` | `telegram-callback.service.ts` | — |
| 068 | Owner can Reject from Telegram; reason required | A | callback reject validation | prompt flow | `telegram.db.spec.ts` | `telegram-callback.service.ts` | — |
| 069 | Owner does not receive appointment reminders | A | no owner reminder type | — | `telegram.db.spec.ts` | `notification-catalog.ts` | — |

### Domain 40.4 — Catalog: services (REQ-070 … REQ-081)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 070 | Multiple services selectable | A | selections array | service step | `BookingFlow.test.tsx` | `catalog.service.ts` | §40.4 |
| 071 | Base service price and duration | A | `service` columns | service editor | `catalog.service.spec.ts` | `catalog.service.ts` | — |
| 072 | Variations/options supported | A | `service_variation` | variation editor | `catalog.service.spec.ts` | `catalog.service.ts` | — |
| 073 | Add-ons may change price and duration | A | `add_on` | add-on editor | `catalog.service.spec.ts` | `catalog.service.ts` | — |
| 074 | Total duration is the sum | A | component sum | review step | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 075 | Total price derived | A | component sum | review step | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 076 | Existing bookings preserve snapshots | A | `booking_component` snapshots | — | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 077 | Services with future bookings cannot be hard-deleted | A | `hasServiceFutureBookings` | editor guard | `domain-services.db.spec.ts` | `catalog.service.ts` | — |
| 078 | Such services can be deactivated | A | `deactivateService` | deactivate toggle | `catalog.service.spec.ts` | `catalog.service.ts` | — |
| 079 | Deactivated services hidden/not selectable | A | `listActiveServices` | hidden in booking | `catalog.service.spec.ts` | `catalog.service.ts` | — |
| 080 | Existing bookings unchanged by deactivation | A | snapshot isolation | — | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 081 | Deactivated services can be reactivated | A | `reactivateService` | reactivate toggle | `catalog.service.spec.ts` | `catalog.service.ts` | — |

### Domain 40.5 — Scheduling & conflicts (REQ-082 … REQ-099)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 082 | Weekly working hours configurable | A | `working_period` | schedule editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | §40.5 |
| 083 | Multiple working periods per day | A | template save | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 084 | Specific periods can be blocked | A | `blocked_period` | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 085 | Whole days can be blocked | A | full-day block | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 086 | Special dates override weekly | A | `special_date` | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 087 | Special dates closed or custom hours | A | `kind CLOSED/CUSTOM` | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 088 | Booking interval configurable | A | `bookingIntervalMins` | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 089 | Full duration must fit working time | A | availability fit rule | time step | `availability.test.ts` | `availability.service.ts` | — |
| 090 | Existing bookings unchanged on schedule change | A | no cascade | — | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 091 | Schedule changes allowed despite conflicts | A | `saveTemplate` | editor | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 092 | System warns about affected bookings | A | `listOpenConflicts` | conflict panel | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 093 | Warning identifies booking/date/reason | A | conflict projection | conflict panel | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 094 | Affected-booking email generated | C | no producer; no canonical deep-link/quick-action contract | — | (none found) | — | §9/§46; blocked |
| 095 | Close changes grouped into a five-minute window | C | dependent on undefined REQ-094 producer | — | (none found) | — | blocked |
| 096 | Every affected booking individually listed | A | conflict projection | conflict list | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 097 | Notification contains name/phone/date/services | A | allow-listed projection | — | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 098 | Direct access to affected bookings | A | conflict projection | conflict panel links | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 099 | Quick actions Reschedule/Cancel/Keep | A | booking service actions | conflict panel actions | `OwnerPortal.test.tsx` | `booking.service.ts` | — |

### Domain 40.6 — Booking lifecycle (REQ-100 … REQ-109)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | Booking status modeled separately from payment | A | `BookingState` vs `PaymentState` | separate displays | `domain-services.db.spec.ts` | `booking.service.ts` | §40.6 |
| 101 | Confirmed booking state set | A | exact 6-state enum | status labels | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 102 | Confirmed becomes Completed automatically | A | `BusinessLifecycleWorker.sweepCompletions` → `BookingService.autoCompleteDueBookings` | — | `business-lifecycle.worker.spec.ts`, `domain-services.db.spec.ts` | `business-lifecycle.worker.ts` | §15.3 T4 |
| 103 | Owner can manually mark No Show | A | `markNoShow` (terminal) | booking detail | `domain-services.db.spec.ts` | `booking.service.ts` | REQ-227 notify |
| 104 | Owner can manually cancel | A | `cancelBooking` (SM-08) | booking detail | `domain-services.db.spec.ts` | `booking.service.ts` | REQ-228 notify |
| 105 | Owner can reschedule confirmed bookings | A | `reschedule` (date/time) | reschedule UI | `domain-services.db.spec.ts` | `booking.service.ts` | §46-5 scope |
| 106 | Reschedule requires an available date/time | A | availability check | reschedule picker | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 107 | Existing payment remains attached after reschedule | A | payment preserved | — | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 108 | Higher new price handled manually | A | no automatic price-difference logic | — | (by design) | `booking.service.ts` | manual by design |
| 109 | Identify booking by phone; no customer reference code | A | `customer-status.service` | status page | `BookingStatusPage` tests | `customer.controller.ts` | — |

### Domain 40.7 — Payments & proofs (REQ-110 … REQ-124)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 110 | Prepayment required per business config | A | `prepaymentMode` | prepayment editor | `domain-services.db.spec.ts` | `business.service.ts` | §40.7 |
| 111 | Owner configures percentage or fixed | A | `prepaymentPercent`/`prepaymentFixedMinor` | prepayment editor | `domain-services.db.spec.ts` | `business.service.ts` | — |
| 112 | Multiple payment methods supported | A | `PaymentMethod` enum | method select | `BookingFlow.test.tsx` | `booking.service.ts` | — |
| 113 | Manual bank transfer supported | A | `BANK_TRANSFER` | method select | `domain-services.db.spec.ts` | `booking.service.ts` | id not cited |
| 114 | Mobile-money supported | A | `TELEBIRR_MOBILE_MONEY` | method select | `BookingFlow.test.tsx` | `booking.service.ts` | — |
| 115 | Custom payment methods NOT configured | D | absent by design | no custom-method UI | — | — | §12.2/§43 |
| 116 | Customer selects a payment method | A | booking DTO | payment step | `BookingFlow.test.tsx` | `booking.service.ts` | — |
| 117 | Customer uploads proof | A | proof storage | upload UI | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 118 | Proof supports image and PDF | A | magic-byte sniff, MIME allow-list, 5 MB | upload UI | `proof-file.spec.ts` | `proof-file.ts` | — |
| 119 | Owner verifies proof in dashboard | A | proof download (tenant+booking scoped) | `BookingDetailPage` | `http-api.db.spec.ts` | `booking.service.ts` | — |
| 120 | Owner verifies proof via Telegram | A | callback accept | — | `telegram.db.spec.ts` | `telegram-callback.service.ts` | — |
| 121 | Slot claim atomic; exactly one winner | A | advisory lock + unique submission key | — | `domain-services.db.spec.ts` (race) | `booking.service.ts` | — |
| 122 | No automatic refunds; manual handling | A | no refund model | — | absence by design | — | — |
| 123 | Rejected proof keeps slot blocked | A | `LOCKED` retained | status page | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 124 | Proof rejection may include reason sent to customer | A | reason required + rendered | status page | `domain-services.db.spec.ts` | `notification-message-renderer` | — |

### Domain 40.8 — Subscription (REQ-125 … REQ-142)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 125 | One standard monthly price | A | single-price model (no amount invented) | subscription card | `http-subscription.db.spec.ts` | `subscription.service.ts` | §46-1 value unresolved |
| 126 | No subscription tiers initially | A | no tier model | — | — | `subscription.service.ts` | — |
| 127 | Independent state per business | A | subscription per business | — | `http-subscription.db.spec.ts` | `subscription.service.ts` | — |
| 128 | Trial is 30 days | A | `trialEndsAt` | card | `http-subscription.db.spec.ts` | `subscription.service.ts` | — |
| 129 | Trial grace is 3 days | A | `trialGraceEndsAt` | card | `http-subscription.db.spec.ts` | `subscription.service.ts` | — |
| 130 | Paid subscription period is 30 days | A | renewal extends 30d | card | `http-subscription.db.spec.ts` | `subscription-billing.service.ts` | — |
| 131 | Paid grace is 5 days | A | `paidGraceEndsAt` | card | `http-subscription.db.spec.ts` | `subscription-billing.service.ts` | — |
| 132 | Bookings continue during grace | A | gating in band model | card | `http-subscription.db.spec.ts` | `subscription.service.ts` | — |
| 133 | After grace new bookings disabled | A | `SUBSCRIPTION_EXPIRED` | public booking error | `http-subscription.db.spec.ts` | `booking.service.ts` | — |
| 134 | Public page remains visible | A | public availability rules | public page | `http-api.db.spec.ts` | `public.controller.ts` | — |
| 135 | Subscription paid via manual bank transfer | A | proof-based | upload UI | `http-subscription.db.spec.ts` | `subscription-billing.service.ts` | — |
| 136 | Owner uploads subscription proof | A | `submitProof` (sniffed, idempotent) | `SubscriptionCard` | `http-subscription.db.spec.ts` | `subscription-billing.service.ts` | — |
| 137 | Admin reviews; approval extends 30 days | A | `approveProof` (guarded, advisory lock) | admin panel | `http-subscription.db.spec.ts` | `subscription-billing.service.ts` | — |
| 138 | Rejection requires reason; sent to owner | A | `rejectProof` (≤800 chars) + Telegram | owner card | `http-subscription.db.spec.ts` | `subscription-billing.service.ts` | — |
| 139 | Reminders use email and business Telegram | C | no producer schedulable; `reminderLeadDays` defaults null | — | (none found) | `app-config.ts` | §46-3 unresolved |
| 140 | Exactly two Admins receive subscription notifications | A | admin-targeted outbox N17 | — | `http-subscription.db.spec.ts` | `notification-outbox-event-bus.ts` | email suppressed |
| 141 | Owner retains access/data after expiry; warning | A | `SubscriptionWarning` | warning UI | `OwnerPortal.test.tsx` | `subscription` UI | — |
| 142 | Channels are email and Telegram | A | notification catalog | — | `telegram.db.spec.ts` | `notification-catalog.ts` | email provider-dependent |

### Domain 40.9 — Pause / resume / exceptions (REQ-143 … REQ-161)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 143 | Business can pause bookings | A | `pause` | pause UI | `http-api.db.spec.ts` | `business.service.ts` | §40.9 |
| 144 | Pause indefinite or with resume date | A | `reopenAt` nullable | pause UI | `domain-services.db.spec.ts` | `business.service.ts` | id not cited |
| 145 | Resume date changeable/removable/extendable | A | pause re-invocation updates `reopenAt` | pause UI | `http-api.db.spec.ts` | `business.service.ts` | id not cited |
| 146 | Public page visible while paused | A | availability rules | public page | `http-api.db.spec.ts` | `public.controller.ts` | — |
| 147 | New bookings disabled while paused | A | `BUSINESS_PAUSED` | public booking error | `domain-services.db.spec.ts` | `booking.service.ts` | — |
| 148 | Optional pause message | A | `pauseMessage` | public page | `BookingFlow.test.tsx` | `business.service.ts` | — |
| 149 | Optional reopening date shown | A | `reopenAt` surfaced | public page | `BookingFlow.test.tsx` | `public.controller.ts` | — |
| 150 | Schedule changes while paused pending/versioned | A | PENDING version | editor | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 151 | Latest pending schedule becomes active on resume | A | resume promotes | — | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 152 | Multiple changes retained in history | A | version history | history view | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 153 | Automatic resume only if subscription active | A | `attemptAutoResume` | — | `domain-services.db.spec.ts` | `subscription.service.ts` | — |
| 154 | Expired subscription prevents automatic reopening | A | worker gate | — | `domain-services.db.spec.ts` | `business-lifecycle.worker.ts` | — |
| 155 | Renewal after pause permits automatic reopening | A | approval path | — | `domain-services.db.spec.ts` | `subscription-billing.service.ts` | — |
| 156 | Indefinite pause stays paused on renewal | A | `listDueForResume` excludes null | — | `domain-services.db.spec.ts` | `business-lifecycle.worker.ts` | — |
| 157 | Manual resume opens immediately if active | A | `resumeManual` | owner action | `http-api.db.spec.ts` | `business.service.ts` | — |
| 158 | Resume checks current schedule/availability | A | resume validation | — | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 159 | Owner may choose Keep Booking on conflict | A | exception creation | conflict panel | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 160 | Kept booking becomes approved schedule exception | A | `schedule_exception` | — | `domain-services.db.spec.ts` | `schedule.service.ts` | id not cited |
| 161 | Exception creation recorded and visible | A | exception record | conflict panel | `domain-services.db.spec.ts` | `schedule.service.ts` | id not cited |

### Domain 40.10 — Schedule history & PDF (REQ-162 … REQ-172)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 162 | Schedule versions retained | A | immutable `schedule_version` | history view | `domain-services.db.spec.ts` | `schedule.service.ts` | §40.10 |
| 163 | History records who/when/what/reason | A | version metadata | history card | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 164 | Manual reason optional | A | reason nullable | history card | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 165 | Automatic changes use System actor + reason | A | system reasons | — | `domain-services.db.spec.ts` | `schedule.service.ts` | — |
| 166 | Owner can view schedule history | A | history read | `ScheduleHistory.tsx` | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 167 | Super Admin can view schedule history | A | admin controller | — | `http-api.db.spec.ts` | `admin/schedule.controller.ts` | — |
| 168 | Admin cannot view schedule history | A | 403/role gate | — | `http-api.db.spec.ts` | `admin/schedule.controller.ts` | — |
| 169 | Owner cannot restore/revert; view-only | A | no revert route | read-only view | `OwnerPortal.test.tsx` | `schedule.service.ts` | — |
| 170 | Schedule history export as PDF | A | `renderScheduleHistoryPdf` | download action | `reporting.db.spec.ts` | `report-pdf.ts` | — |
| 171 | Export supports custom start/end | A | `parseBound` | date range | `reporting.db.spec.ts` | `report-pdf.ts` | — |
| 172 | PDF contains versions and dates/times only | A | field restriction | — | `report.spec.ts` | `report-pdf.ts` | — |

### Domain 40.11 — Booking history & reporting (REQ-173 … REQ-190)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 173 | Full booking status history retained | A | `booking_status_history` | — | `reporting.db.spec.ts` | reporting | §40.11 |
| 174 | Owner can view full history for own bookings | A | owner history read | `BookingDetailPage` | `OwnerPortal.test.tsx` | `booking.controller.ts` | — |
| 175 | Booking reports show current status | A | reporting service | admin report UI | `reporting.db.spec.ts` | `reporting.service.ts` | — |
| 176 | Admin sees current status only | A | 403 for full history | admin UI | `reporting.db.spec.ts` | `admin/report.controller.ts` | — |
| 177 | Super Admin can view full booking history | A | admin report endpoint | SA report UI | `reporting.db.spec.ts` | `admin/report.controller.ts` | — |
| 178 | Super Admin exports full history to PDF | A | `renderBookingHistoryPdf` | export action | `reporting.db.spec.ts` | `report-pdf.ts` | — |
| 179 | Export supports custom date range | A | `parseBound` | date range | `reporting.db.spec.ts` | `report-pdf.ts` | — |
| 180 | All businesses or one selected business | A | single-business filter | business picker | `reporting.db.spec.ts` | `reporting.service.ts` | — |
| 181 | Business multi-select not allowed | A | single `businessId` param | single select | `reporting.db.spec.ts` | `reporting.service.ts` | — |
| 182 | PDF: Booking ID, customer, business, status changes, dates/times, actor | A | six-column PDF | — | `report.spec.ts` | `pdf-document.ts` | — |
| 183 | PDF excludes reasons/notes | A | field allow-list | — | `report.spec.ts` | `pdf-document.ts` | — |
| 184 | Filters: status, actor, date range, business | A | filter parsing | report filters | `reporting.db.spec.ts` | `reporting.service.ts` | — |
| 185 | Filter AND/OR semantics | A | AND across / OR within | report filters | `reporting.db.spec.ts` | `reporting.service.ts` | — |
| 186 | Filters not remembered; 30-day default | A | `DEFAULT_WINDOW_DAYS` | reset default | `report.spec.ts` | `reporting.service.ts` | — |
| 187 | Default sort newest first | A | `sortBookingHistory` | report table | `report.spec.ts` | `booking-history.report.ts` | — |
| 188 | Sortable columns | A | `BOOKING_HISTORY_SORT_KEYS` | sortable headers | `report.spec.ts` | `booking-history.report.ts` | — |
| 189 | Date/time sorting rules | A | comparator | table | `report.spec.ts` | `booking-history.report.ts` | — |
| 190 | Booking ID and other-column sorting rules (CONF-001) | A | comparator | table | `report.spec.ts` | `booking-history.report.ts` | CONF-001 resolved |

### Domain 40.12 — Security & audit (REQ-191 … REQ-206)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 191 | Login success and failure recorded | A | `security_event` | — | `http-auth.db.spec.ts` | `auth.service.ts` | §40.12 |
| 192 | Records include date/time, IP, device/browser, result | A | columns | — | `http-auth.db.spec.ts` | `security-event-auth.repository.ts` | — |
| 193 | Five consecutive failures → 15-minute lock | A | lockout | — | `http-auth.db.spec.ts` | `auth.service.ts` | — |
| 194 | Successful password reset clears the lock | A | lock reset | — | `http-auth.db.spec.ts` | `auth.service.ts` | — |
| 195 | Lockout generates immediate email | B | mechanism enqueues `LOCKOUT_EMAIL`, `SUPPRESSED` | — | `http-auth.db.spec.ts` (mechanism) | `notification-outbox-event-bus.ts` | needs email sender |
| 196 | Lockout email includes IP and device/browser | B | `emailData` enrichment present; delivery suppressed | — | `http-auth.db.spec.ts` | `notification-delivery.service.ts` | id not cited |
| 197 | New/unrecognized devices recorded | A | `DEVICE_FIRST_USE` event | — | `http-auth.db.spec.ts` | `auth.service.ts` | — |
| 198 | Super Admin emergency recovery email | B | `RecoveryService` code hashed/single-use + `RECOVERY_CODE_EMAIL` (always SUPPRESSED) | recovery UI | `http-auth.db.spec.ts` | `recovery.service.ts` | needs email sender |
| 199 | Emergency recovery sends a one-time code | A | recovery code (hashed, TTL, attempt-capped) | recovery UI | `http-auth.db.spec.ts` | `recovery.service.ts` | — |
| 200 | Recovery code permits immediate password replacement | A | confirm flow | recovery UI | `http-auth.db.spec.ts` | `recovery.service.ts` | — |
| 201 | Owner views own security history | A | role-scoped history | security view | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |
| 202 | Admin views own security history | A | role-scoped | security view | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |
| 203 | Super Admin views all relevant security history | A | platform view | SA view | `http-auth.db.spec.ts` | `admin.controller.ts` | — |
| 204 | Security/activity records retained one year | A | no premature deletion | — | (manual-delete only) | `admin-management.service.ts` | availability, not purge |
| 205 | Super Admin can delete records | A | SA-only delete | SA view | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |
| 206 | Deletion itself audited | A | audit event | — | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |

### Domains 40.13–40.19 — Public page & platform operations (REQ-207 … REQ-221)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 207 | Public page customizable | A | profile fields | profile page | `OwnerPortal.test.tsx` | `business.service.ts` | §40.13 |
| 208 | One main cover photo; no gallery | A | single cover field | profile page | `OwnerPortal.test.tsx` | `BusinessProfilePage.tsx` | branding demo seam |
| 209 | Page includes business name and logo | A | profile fields | public page | `BookingFlow.test.tsx` | `public.controller.ts` | — |
| 210 | Page includes business description | A | `description` | public page | `BookingFlow.test.tsx` | `business.service.ts` | id not cited |
| 211 | Location: address + lat/long | A | `address`/`latitude`/`longitude` | profile + public | `OwnerPortal.test.tsx` | `business.service.ts` | — |
| 212 | Map access (Google/OSM) | A | coords exposed | public map link | `BookingFlow.test.tsx` | `PublicBookingPage.tsx` | — |
| 213 | Public contact is phone | A | `phonePublic` | public page | `BookingFlow.test.tsx` | `public.controller.ts` | — |
| 214 | Page content: services/prices/durations/variations/add-ons/times | A | public projection | public page | `BookingFlow.test.tsx` | `public.controller.ts` | — |
| 215 | Categories exactly Salon & Barber and Other | A | seeded `business_category` | category select | `domain-services.db.spec.ts` | `business.service.ts` | — |
| 216 | Business deactivation/closure by owner | A | `deactivate`/`reactivate` | owner action | `http-api.db.spec.ts` | `business.service.ts` | — |
| 217 | Super Admin admin-account lifecycle | A | create/reactivate/deactivate | SA admin panel | `http-auth.db.spec.ts` | `admin-management.service.ts` | — |
| 218 | Admin cannot change own password | A | role gate | — | `http-auth.db.spec.ts` | `auth.service.ts` | — |
| 219 | Super Admin can change Admin passwords | A | SA-only route | SA admin panel | `http-auth.db.spec.ts` | `admin.controller.ts` | — |
| 220 | Super Admin can force-log-out Owners/Admins | A | forced logout revokes all sessions | SA admin panel | `http-auth.db.spec.ts` | `admin.controller.ts` | — |
| 221 | Forced logout sends immediate email | B | mechanism enqueues `FORCED_LOGOUT_EMAIL`, `SUPPRESSED` | — | `http-auth.db.spec.ts` (mechanism) | `notification-outbox-event-bus.ts` | needs email sender |

### Domain 40.21 — Date / time rules (REQ-222 … REQ-226)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 222 | One global system timezone | A | single `GLOBAL_CLOCK`; identity is config (§46-2) | display helpers | `global-clock` tests | `global-clock.ts` | value unpublished |
| 223 | Businesses cannot choose a timezone | A | no timezone picker/setting | no picker | — | — | — |
| 224 | 24-hour time format | A | format helpers | all time display | frontend tests | format helpers | — |
| 225 | Date format YYYY-MM-DD | A | `formatDate` | all date display | frontend tests | format helpers | — |
| 226 | Minute precision; seconds not stored | A | DB CHECK `booking_end_minute_precision` | — | `domain-services.db.spec.ts` | `prisma/migrations` | — |

### Domain 40.22 — Approved decisions (REQ-227 … REQ-232)

| REQ | Summary | Cls | Backend evidence | Frontend evidence | Test evidence | Files | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 227 | Customer notified on No Show | A | `markNoShow` → Telegram if connected | status page | `telegram.db.spec.ts` | `booking.service.ts` | — |
| 228 | Customer notified on owner cancellation | A | `cancelBooking` → Telegram | status page | `telegram.db.spec.ts` | `booking.service.ts` | — |
| 229 | Customer notified on reschedule with new date/time | A | `reschedule` → Telegram | status page | `telegram.db.spec.ts` | `booking.service.ts` | — |
| 230 | Rejected booking: customer may resubmit proof | A | `ResubmissionService` + `TelegramVerificationCodeChannel` delivery/void | status/resubmit UI | `resubmission.service.spec.ts`, `telegram-verification-code-channel.spec.ts` | `resubmission.service.ts` | §23.3/BR-35 |
| 231 | Failed automatic resume event recorded in history | A | `attemptAutoResume` history | — | `domain-services.db.spec.ts` | `subscription.service.ts` | — |
| 232 | Product name "Werefa" | A | templates/branding | all surfaces | frontend tests | app config/UI | — |

## 8. Implemented-requirement evidence (Class A)

Class A covers 214 requirements. Each was traced to a concrete module and, where
practical, at least one automated test. The anchors are listed per domain in the
matrix above; the recurring test evidence is:

- Backend unit: `service-rules.spec.ts`, `proof-file.spec.ts`,
  `business-lifecycle.worker.spec.ts`, `catalog.service.spec.ts`, `report.spec.ts`,
  `resubmission.service.spec.ts`, `telegram-verification-code-channel.spec.ts`.
- Backend HTTP/DB: `http-auth.db.spec.ts`, `http-api.db.spec.ts`,
  `http-subscription.db.spec.ts`, `reporting.db.spec.ts`,
  `domain-services.db.spec.ts`, `telegram.db.spec.ts`.
- Frontend: `BookingFlow.test.tsx`, `OwnerPortal.test.tsx`,
  `OwnerBusinessSelection.test.tsx`, availability/report/mapper unit tests.

No Class-A row relies on a fabricated identifier; where a requirement has no
direct `REQ-###` citation in code (e.g. REQ-002/004/010/017/018/042/043/052/108/
113/144/145/160/161/196/210), its implementing code path was located and cited by
module instead.

## 9. Provider/deployment-dependent requirements (Class B)

Twelve requirements require an **approved external email sender** (for REQ-196, also
the email-content slice) — a deployment input, not a product decision:

| REQ | Summary | In-repo status | Missing piece |
| --- | --- | --- | --- |
| 026 | Owner email verification required | account created `isEmailVerified=false`; no verify flow | verification flow + email sender |
| 027 | Unverified users blocked from dashboard | no verification transition to gate on | dependency on 026 |
| 028 | Verification links time-limited | no link exists | verification flow |
| 029 | Expired link replacement | no link exists | verification flow |
| 030 | Verification request rate limiting | no request endpoint exists | verification flow |
| 031 | New link invalidates previous | no link exists | verification flow |
| 032 | Successful verification may auto-authenticate | depends on absent slice (MAY) | verification flow |
| 033 | Forgot-password via email reset | no reset-by-email flow/endpoint | reset flow + email sender |
| 195 | Lockout generates immediate email | mechanism present, delivery `SUPPRESSED` | email sender |
| 196 | Lockout email includes IP and device/browser | event carries no IP/device and no email body is rendered (`payloadRef: null`) | email sender + content slice |
| 198 | Super Admin emergency recovery email | mechanism present, delivery `SUPPRESSED` | email sender |
| 221 | Forced logout sends immediate email | mechanism present, delivery `SUPPRESSED` | email sender |

`EMAIL_PROVIDER` binds to `DisabledEmailProvider` (`isConfigured()=false`), which
deliberately never reports acceptance, so no false "delivered" state is produced.
Reports must not describe these as full external delivery.

## 10. Blocked requirements (Class C)

| REQ | Summary | Blocked on |
| --- | --- | --- |
| 094 | Affected-booking email generated | No canonical URL/route/domain/link mechanism, nor grouping/notification-identity or multi-booking persistence contract, is defined. A repo-wide search found no affected-booking email producer. |
| 095 | Close changes grouped into a five-minute window | Dependent on REQ-094's undefined producer. |
| 139 | Reminders use email and business Telegram | §46 item 3 (reminder lead time) unresolved; `reminderLeadDays` defaults `null` and nothing schedules a reminder. |

Also explicitly pending and **not implemented**: the owner booking-report PDF export
(§25.3 / §46-4) — `02-user-roles-permissions.md` records it as *pending
clarification*; only the Super Admin PDF (REQ-178) is confirmed. It has no
dedicated REQ number.

## 11. Deferred requirements (Class D)

| REQ | Summary | Deferral basis |
| --- | --- | --- |
| 025 | Google login not part of Phase 1 | §12.2 / §43 — email/password only; correctly absent |
| 034 | 2FA-ready Phase 1 architecture | §43 — no 2FA enforcement in Phase 1; session/auth model is extension-ready |
| 115 | Custom payment methods NOT configured | §12.2 / §43 — correctly absent |

Also out of Phase-1 scope by canonical decision (no dedicated REQ): online payment
gateway, customer accounts/self-service cancel/modify, per-tenant timezones, TTL
slot locks.

## 12. §46 unresolved product decisions (untouched)

All six remain unresolved and were not silently resolved:

1. Subscription monthly price (REQ-125) — single-price model only; no amount invented.
2. Global timezone identity (REQ-222) — mechanism present; value is configuration.
3. Subscription-reminder lead time (REQ-139) — defaults `null`; no producer.
4. Owner booking-report PDF export (§25.3) — not implemented.
5. Owner "modify" scope (REQ-105/109) — rescheduling only; broader modify not inferred.
6. Timezone-abbreviation display / BR-32 — not implemented.

REQ-230 is **not** in this list: the canonical specification records its channel
resolution under "Resolved/recorded during this rebuild" (§46).

## 13. Historical-report corrections

- **Report 44** claimed REQ-026–031 and REQ-033 were IMPLEMENTED. **Incorrect for
the current rebuild.** The auth surface exposes only `login`, `register`, `logout`,
`password/change`, `security`, `session`; there is no email-verification token
table and no forgot-password route. The evidence report 44 cited ("verification
tokens") actually refers to the **resubmission** verification repository, not email
verification. These are now Class B.- **Report 44** implied REQ-195, REQ-196 and REQ-221 were fully implemented; the
  current tree shows their email delivery is mechanism-only and `SUPPRESSED` (no
  external provider), and, for REQ-196, the IP/device content is not even built
  into the event. Now Class B (REQ-198 was already PARTIAL in 44). This audit
  additionally corrects the Prompt 62 baseline, which had still left REQ-196 as A.
- **Report 45** correctly established the provider/deployment boundary; no
correction needed.
- **Report 47** already recorded the report-44 correction and REQ-230 closure; this
audit re-derived the same conclusion independently and confirmed the counts.
- No historical report was rewritten; this report carries the current-state
correction.

## 14. Safe fixes performed

**Three documentation-only corrections.** Each was objectively safe: it changed no
behavior, required no product/provider/deployment decision, and only removed a
statement that contradicted the current implementation/classification.

| File | Before | After |
| --- | --- | --- |
| `frontend/src/api/types.ts` | resubmission request-code comment: "delivery is out of scope" | states the backend delivers the code to the customer's connected Telegram chat |
| `backend/src/domain/notifications/notification-outbox-event-bus.ts` (class header) | "email delivery is out of scope; no real email is ever sent" | "delivery is provider-dependent; no real email is sent until an external `EmailProvider` is configured" |
| `backend/src/domain/notifications/notification-outbox-event-bus.ts` (subscription write) | "email only, suppressed (email delivery is out of scope …)" | "email only, delivery-suppressed (no external `EmailProvider` is configured …)" |

No Class-B or Class-C finding was "fixed": doing so would require inventing product
behavior or a provider/deployment choice, which this Prompt forbids.

## 15. Security / integrity observations

- Production selector is `SessionAuthContextResolver` (opaque session cookie →
  SHA-256 token hash → live session → live user); all failures collapse to one
  `UNAUTHENTICATED`.
- The `TestAuthContextResolver` is constructed only when `AUTH_TEST_ENABLED=true`
  **and** `nodeEnv !== 'production'`, and hard-fails in production; Prompt 61 added
  a production fail-fast on the flag itself. **No test-only config is reachable in
  production.**
- Tenant isolation is application-enforced: `TenantGuard.requireOwnedBusiness`
  resolves ownership in-query and returns `NOT_FOUND` (existence not leaked). No
  DB-level RLS exists in any migration (accepted limitation, reported in 45).
- Role gates: `requireAdminOrSuperAdmin`, `requireSuperAdmin`, `requireSystem`.
  Admin cannot change its own password (REQ-218); SA-only admin management,
  recovery, security-history deletion and force-logout.
- Password change / forced logout / recovery revoke sessions; lockout = 5
  consecutive failures → 15 min. Security events persisted with IP/device/browser.
  Pino redaction covers secrets; config errors report field names only.
- Phase-2 2FA was **not** implemented.

## 16. Concurrency / idempotency observations

- Booking creation: `submission_key` unique + in-transaction re-check under
  `withBusinessAdvisoryLock` → exactly one winner; replays return the original.
- Proof submission (appointment + subscription): idempotent key; P2002 race
  resolution; guarded transitions.
- Subscription approve/reject: guarded `PENDING → APPROVED/REJECTED` inside the
  advisory lock → cannot extend twice.
- Resubmission: one-time code, hashed at rest, single-use (`markUsed` guarded), TTL,
  attempt cap, active-code cap; the REQ-230 channel voids on `NO_CHANNEL` via the
  same guarded `markUsed`.
- Telegram webhook: `update_id` exactly-once via P2002; webhook secret compared in
  constant time; callback OPEN→USED claim atomic (guarded `updateMany`).
- Outbox: stable idempotency keys (unique constraint), P2002 duplicate skip, bounded
  backoff (30s→10min cap), stale-`SENDING` reclaim (10 min), `DEAD_LETTERED` at the
  attempts cap. Domain commit precedes outbox persistence; no external API inside a
  domain transaction.
- Lifecycle worker: single unref'd timer, skipped under `NODE_ENV=test`, cleared on
  shutdown; both duties on isolated `safeRun` paths. Correctness (not efficiency) is
  preserved across concurrent sweeps by the guarded, advisory-locked transitions.

## 17. Telegram verification-code / REQ-230 verification

- **Customer Telegram connection:** `TelegramConnectionService` is deep-link-only,
  stores SHA-256 codes, 10-minute TTL, single-use, per-business/recipient binding;
  disabled unless `telegramEnabled && telegramBotHandle`.
- **Notification events:** customer N01–N08 are Telegram deliveries; unconnected
  recipients are `SUPPRESSED`; owner N09 carries Accept/Reject callback tokens bound
  to the connection (T-09).
- **Owner proof notification + Accept/Reject:** `TelegramCallbackService` claims
  `OPEN→USED` atomically, enforces chat binding, executes the same
  `BookingService.accept`/`reject`; rejection requires a reason (prompt bound to the
  chat, 10-minute TTL, never persisted).
- **Webhook security / idempotency:** constant-time secret comparison; `update_id`
  exactly-once via P2002.
- **Verification-code delivery (REQ-230):** `ResubmissionService.requestCode` calls
  `VERIFICATION_CODE_CHANNEL` after issuing the code. `TelegramVerificationCodeChannel`
  returns `CHANNEL_DISABLED` (telegram off), `NO_CHANNEL` (no connected customer chat
  or provider refusal), or `DELIVERED` (plaintext sent to the bound chat). On
  `NO_CHANNEL` the service **voids** the code via guarded `markUsed` and records the
  `BOOKING_VERIFICATION_CODE_NO_CHANNEL` security event, exactly per §23.3/BR-35.
  The plaintext is never persisted (only its SHA-256 hash) and never returned or
  logged; the API response shape is unchanged (anti-enumeration). The channel looks
  up the connection by `businessId + customerPhone + kind=CUSTOMER + state=CONNECTED`,
  so it cannot cross tenants. **Verified present and tested** in the current tree.

## 18. Email implementation / deployment boundary

The `EmailProvider` port binds to `DisabledEmailProvider`
(`isConfigured()=false`, returns `EMAIL_PROVIDER_NOT_CONFIGURED`, never reports
accepted). Outbox writers set email deliveries to `SUPPRESSED`; `RECOVERY_CODE_EMAIL`
is **always** suppressed. `emailTemplate()` covers `LOCKOUT_EMAIL`,
`FORCED_LOGOUT_EMAIL`, `SUBSCRIPTION_PROOF_SUBMITTED`, `SUBSCRIPTION_PROOF_REJECTED`;
there is **no** recovery-code template (that event is suppressed at write time).
There is **no email-verification flow, no forgot-password flow, and no email
verification token table**. Therefore REQ-026–033 and REQ-195/196/198/221 are
Class B, and no email may be described as externally delivered.

## 19. Subscription / booking-lifecycle / schedule verification

- **Subscription:** trial (30d) → trial grace (3d) → paid (30d) → paid grace (5d) →
  expired; booking gate in the band model; manual bank-transfer proof with Admin/SA
  review (approval extends 30d); scheduled pause/resume with expired-scheduled-resume
  gating; failed automatic resume recorded (REQ-231). Reminder **producer** is absent
  (REQ-139, Class C). Exactly two Admins are targeted for subscription notifications.
- **Booking lifecycle:** PAYMENT_PENDING → CONFIRMED → COMPLETED (auto, System actor,
  REQ-102) plus terminal NO_SHOW/CANCELLED/REJECTED and reschedule; payment attachment
  preserved across reschedule; slot released on completion/cancel; automatic
  completion sweep wired; customer notifications gated on a connected Telegram chat.
  No lifecycle behavior outside the specification was introduced.
- **Schedule:** weekly working hours, multiple periods, blocked periods/days, special
  dates, booking interval, fit rule, versioning while paused, conflict detection,
  history, Keep-Booking exceptions, affected-booking conflict logic. The blocked
  conflict-email producer (§94/§95) was **not** implemented.

## 20. Test evidence

After the three documentation-only edits (no behavior change):

| Gate | Result |
| --- | --- |
| Backend `npm test` | `30 passed | 10 skipped` (40 files); `199 passed | 246 skipped` (445) |
| Backend `npm run test:db` — run 1 | `28 passed` (28); `387 passed` (387) |
| Backend `npm run test:db` — run 2 | `28 passed` (28); `387 passed` (387) |
| Frontend `npm test` | `44 passed` (44); `504 passed` (504) |

DB tests were run **twice consecutively**, both clean, against the real PostgreSQL
test database. No test was weakened, deleted or skipped to obtain green results. No
pre-existing flaky failure occurred this session; report 47 documented a prior
jsdom `Not implemented: navigation (except hash changes)` flake on the frontend that
passed on re-runs — it did not recur here.

## 21. Typecheck / lint / build

| Gate | Backend | Frontend |
| --- | --- | --- |
| typecheck | PASS (`tsc --noEmit`) | PASS (`tsc -b`) |
| lint | PASS (`eslint --max-warnings=0`) | PASS (`eslint .`) |
| build | PASS (`nest build`) | PASS (`vite build`; 527.38 kB JS chunk, pre-existing >500 kB advisory) |

## 22. Browser QA status

**Browser QA unavailable.** No browser-automation harness (Playwright/Cypress/
Puppeteer) exists in the repository and this Prompt forbids adding one. Ad-hoc
screenshots under `frontend/qa-shot/` are not a harness. The audit changed no
user-facing behavior.

## 23. Final canonical specification hash

```
5494658e5be313e90720db30abbbf76a6879637f45acc33b342aecaa9b0ff00b  docs/WEREFA-COMPLETE-SPECIFICATION.md
```

Identical to the starting digest and to the required value. The specification was
read-only throughout; the `REQ-###` heading count is still **232**.

## 24. Working-tree status & no-commit confirmation

- HEAD unchanged at `80a69ff1aefcb06e5336547dd85bf23dbadf75d0`.
- Working tree: **123** uncommitted entries (the entire implementation remains
  uncommitted by design; 55 untracked).
- Files touched by this Prompt:

| File | Change |
| --- | --- |
| `docs/implementation/48-final-canonical-traceability-audit.md` | **new** — this report |
| `frontend/src/api/types.ts` | corrected stale resubmission delivery comment |
| `backend/src/domain/notifications/notification-outbox-event-bus.ts` | corrected two stale "out of scope" email comments |

**NO COMMIT MADE.** No `git add`, `git commit`, `git push`, reset, rebase, squash, or
any other history operation was performed. Work remains as uncommitted working-tree
changes only.

