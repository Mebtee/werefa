# 20 — Backend Domain Model & Database Schema Foundation (Prompt 40)

> **Phase:** Prompt 40 | **Status:** COMPLETE | **Date:** 2026-09-16
> Sources of truth: `docs/WEREFA-COMPLETE-SPECIFICATION.md` (canonical product spec, **not modified**) and `docs/architecture/07-database-design.md` + ADR-002/003 (approved physical design).
> Canonical-spec fingerprint check: the spec file was read-only throughout; no byte was changed (verified by `git status`/`git diff`).

---

## 1. Purpose & Scope

Establish the **real persistent domain foundation** for the Washed multi-tenant booking platform on top of the Prompt 39 backend: a Prisma domain schema, a reviewable PostgreSQL migration with defense-in-depth constraints, tenant/business isolation, and core repository boundaries with live-PostgreSQL integration tests.

**Built:** business/tenancy + owner-identity foundation, catalog (services), versioned schedule, booking aggregate (snapshots, status history, payment separation, slot-lock claims), customer Telegram/notification outbox tables, subscription foundation, schedule-exception foundation, audit/security foundation, file-registration table, Prisma-generated client, migration for dev + test, DB-gated tests, report.

**Deliberately NOT built (per Prompt 40 scope protection):** auth/login/password-reset/2FA/session/email-verification/recovery *workflows* (identity table exists only as FK foundation), real Telegram integration, real payment processing, real file storage engine, subscription billing flow, customer platform accounts, full booking REST APIs, frontend/backend integration, prompt 38 item 6, production deployment/CI/CD. The six unresolved product decisions (spec §46) are not resolved (see §23).

## 2. Sources of Truth & Conventions

- Product facts: canonical spec §29 (logical data model), §15/§16/§17 (states/methods), §39 business rules, §46 open issues, Domains 2/5–12/14–18/20–22.
- Physical design: architecture doc 07 (tables, role split, guarantees), ADR-002 (PostgreSQL+Prisma), ADR-003 (shared schema + RLS), doc 08 (concurrency/slot-lock).
- Conventions carried into DDL: `TIMESTAMPTZ(6)` on every timestamp (Prisma `DateTime` defaults to `timestamp(3)` without tz — explicitly overridden with `@db.Timestamptz(6)`); money as **bigint minor units** (no floats, ADR-002); every tenant table carries `business_id` FK (ADR-003); one global timezone — **no per-tenant/per-user timezone column** (REQ-223); `id` UUID PK default random, except `booking` (integer autoincrement ID, REQ-109/190).

## 3. Tenancy & Business Foundation

`business` (uuid PK, `public_slug` globally unique lowercase, `category_code` FK, profile/geo/contact, `deactivated_at`, `active_schedule_version_id` self-FK `SET NULL`, timestamps). `business_category` reference table seeded with exactly `SALON_AND_BARBER` + `OTHER` (REQ-215). `business_owner` (composite PK `(business_id,user_id)`, both FKs `RESTRICT`) → one owner per business (REQ-012) and one owner may manage multiple businesses (REQ-013). `business_settings` (1:1, `booking_interval_minutes`, `prepayment_mode`/`prepayment_percent`/`prepayment_fixed_minor`, pause fields). Every tenant row is scoped by `business_id` for RLS predicates (ADR-003; RLS enablement itself deferred — see §21).

## 4. Business Owner Identity Foundation

`user` (email unique lowercase, `password_hash`, `role` enum OWNER/ADMIN/SUPER_ADMIN, verified/lock flags). Auth tables/workflows (`EmailVerification`, `OneTimeToken`, `Session`, `PasswordReset`, `EmergencyRecovery`, recovery tokens) are **deliberately deferred** to the auth phase (not in schema); `user` exists so owner→business membership and actor references are FK-valid. No login/session code.

## 5. Services & Catalog

`service` (`base_price_minor`, `base_duration_minutes`, `is_active` = deactivation, REQ-077/078 deactivation-not-hard-delete; FK `business_id` RESTRICT). `service_variation` + `add_on` (relative price/duration deltas, `is_active`). Indexes on `(business_id, is_active)` and service-scoped lookups. Prices never negative (CHECK).

## 6. Schedule Foundation

Versioned schedule per doc 07: `schedule_version` (`version_no` unique per business, status PENDING/ACTIVE, `applied_at/by`, `reason`/`auto_reason`, `replaced_at`) with a **partial unique index `uq_active_schedule_version` on `business_id WHERE status='ACTIVE'`** (at most one active version). Child tables (FK `schedule_version_id` CASCADE, `business_id` RESTRICT): `working_period` (`weekday SMALLINT 1–7`, minutes-of-day ints, `end_minutes > start_minutes ≤ 1440`), `blocked_period` (nullable weekday + minutes), `special_date` (DATE, kind CLOSED/CUSTOM, unique `(schedule_version_id, date)`, minutes bounds). One shared queue per business (REQ-009).

## 7. Booking Aggregate

`booking`: integer autoincrement `id` (internal Booking ID, REQ-109/190; chronological), `business_id`, status enum default `PAYMENT_PENDING`, customer name/phone (required REQ-054), `note` optional (REQ-055), `start_at`/`end_at` TIMESTAMPTZ with minute-precision + order CHECKs (REQ-226). Child aggregate rows written only in the create transaction:
- `booking_component` — immutable snapshots of selected service/variation/add-on (REQ-076): `component_type`, `service_id` FK `SET NULL`, `name_snapshot`, `unit_price_minor`, `duration_minutes`; later catalog edits never mutate these rows (tested).
- `booking_status_history` — append-only transition log (REQ-173): `from_status`/`to_status`, `actor_type`/`actor_user_id`, no-op transition CHECK.
- `slot_lock` — $LOCKED$/$ALLOCATED$/$RELEASED$ with **partial unique index `uq_slot_lock_active` on `(business_id, slot_date, start_at) WHERE state IN ('LOCKED','ALLOCATED')`** (REQ-121; no auto-TTL per OQ-SLOT-001), release-correlation CHECK.
- `resubmission_verification` — single-use hashed expiring code bound to booking+phone (doc 08 §9, REQ-230), `attempts`, `used_at`.

Booking indexes: `(business_id, start_at)`, `(business_id, status)`, `(business_id, customer_phone)`.

## 8. Payment Foundation

`payment` (one per booking via **unique `booking_id`**; status exactly PENDING/ACCEPTED/REJECTED — REQ-100/SM-12; method exactly BANK_TRANSFER / TELEBIRR_MOBILE_MONEY — REQ-112/OQ-PAY-001; `prepaid_minor`). Booking status and payment status are **separate** columns/enums (REQ-100; tested). `payment_proof` (FK to payment; **unique `submission_key`** for idempotency REQ-121; `replaced_by_proof_id` self-FK lineage for resubmission REQ-230; optional `file_object_id`). `payment_status_history` (None→Pending→… transitions, check no-op). No refund states (REQ-122).

## 9. Customer Telegram Connection & Notification Outbox

`telegram_connection` (chat_id unique, kind BUSINESS_OWNER/CUSTOMER, state PENDING_VERIFICATION/CONNECTED/REVOKED, null tenant for platform-level). `telegram_update` (update_id PK dedupe, REQ-142). `notification` (tenant-scoped type + timestamps) and `notification_delivery` (channel EMAIL/TELEGRAM, delivery-state enum, bounded `attempts`, `next_attempt_at` queue index, **unique `idempotency_key`**, `sent_at`, `last_error`) — the outbox foundation (REQ-142; doc 13). Delivery/no-dispatch logic is a later phase.

## 10. Subscription Foundation

`subscription` (one per business via unique `business_id`; status enum NONE/TRIAL/TRIAL_GRACE/ACTIVE/PAID_GRACE/EXPIRED; trial/period/grace timestamps). `subscription_proof` (REQ-136/137/138; review state PENDING/APPROVED/REJECTED; **rejection reason required** and `approved_until` only when APPROVED — DB CHECK; Admin review-queue indexes `(business_id, review_state)` and `(review_state, created_at)`). `subscription_reminder` (unique `(business_id, kind)`, once-per-band REQ-139 — lead time left as config, §23). `subscription_status_history` (append-only). No billing.

## 11. Schedule Conflict / Booking Exception Foundation

`schedule_exception` (REQ-159…161; doc 10): FK to `schedule_version` + FK to `booking` (CASCADE), `created_by`, `created_at`; unique `(booking_id, schedule_version_id)` prevents re-flagging; persists and is attributable to the version that caused the conflict. Consumption (report label "Schedule Exception") is a later phase (REQ-160).

## 12. Audit / Security Foundation

`security_event` (user/business-scoped, type/ip/device/browser/result, indexed by user/business/type; REQ-201…/doc 22). `audit_event` (actor, role, action, business, detail-as-text payload — **no JSON blob**, §14). `file_object` (registration only: category CUSTOMER_PROOF/SUBSCRIPTION_PROOF/LOGO/COVER/REPORT_PDF, unique `storage_key`, mime/size/sha256; storage engine deferred). `report_job` (state + optional file; PDF export unresolved, §23). Security history UI/deletion and reporting are later phases.

## 13. Enum Inventory

19 Postgres enum types (values exactly per spec): `UserRole`, `BusinessType` (REQ-215), `PrepaymentMode` (REQ-111), `BookingState` (six, REQ-101), `PaymentState` (three, REQ-100), `PaymentMethod` (REQ-112), `BookingComponentType`, `SlotLockState`, `SpecialDateKind`, `ScheduleVersionStatus`, `SubscriptionStatus`, `SubscriptionReviewState`, `SubscriptionReminderKind`, `ActorType`, `TelegramConnectionKind`, `TelegramConnectionState`, `NotificationChannel`, `NotificationDeliveryState`, `FileCategory`. Invalid DB-level values are rejected by the enum type (tested).

## 14. Database Design Decisions

- **Money = bigint minor units.** `base_price_minor`, `unit_price_minor`, `prepaid_minor`, prepayment fixed etc. Exact integer arithmetic; round-trip verified for large values; non-negativity CHECKed.
- **TIMESTAMPTZ(6) everywhere.** Doc 07/ADR-002 requirement; Prisma default overridden per field. Instant round-trip tested.
- **Minute precision for user-facing times (REQ-226).** DB CHECK: `extract(second)=0 AND extract(millisecond)=0` on booking/slot `start_at`/`end_at`. `created_at`/`updated_at` keep full precision (system timestamps).
- **Time-of-day stored as minutes since midnight** (Prisma has no PG `time` type): `start_minutes`/`end_minutes` ints with bounds CHECKs; **overnight cross-midnight working periods are not supported** (documented limitation; start < end enforced — matches single-day appointment semantics).
- **No JSON blobs.** Audit `detail` is text; `scope_ref` on report jobs is a ref string. Rationale: stricter tenant/type safety and no opaque payloads at this stage.
- **citext avoided.** Prisma cannot map PG `citext` as a queryable type (only opague `Unsupported`). Case-insensitive uniqueness for slug (REQ-047) and email is instead achieved by storing **lowercase + CHECK `= lower(...)`**; the repository lowercases input. Slug uniqueness itself is enforced platform-wide by a plain unique index.
- **Sequence-based IDs** (`SERIAL`) exist for `booking` and three history tables; app role granted USAGE/SELECT.

## 15. Constraints & Guarantees — DB-enforced vs application-enforced

**DB-enforced (this migration):** enum membership; unique slug (REQ-047) incl. lowercase; one payment per booking; unique `submission_key`; active-slot-lock partial unique index (REQ-121); one ACTIVE schedule version per business; unique special date per version; unique `(booking_id, schedule_version_id)` exception; unique idempotency key; FKs (incl. tenant FKs); money non-negative; minute precision; `start < end`; working-period weekday/hours; release-correlation; prepayment-mode consistency (REQ-111); rejection-reason-required (REQ-138); no-op history transitions; attempt counters ≥ 0.

**Application-enforced (repository + later services; documented, NOT DB constraints):** slot *overlap* of different windows (partial index covers exact identity only — the advisory lock + in-transaction overlap re-check per doc 08); booking status-machine transition legality and terminal-state rules (SM-10); service deactivation-no-hard-delete policy (REQ-077); snapshot immutability policy (single-write path); customer-can't-cancel/modify (BR-07); resubmission code validation flow; tenant-context filtering (today the repository filters; RLS will be the floor — §21). This split mirrors doc 07 §3 (partial index = defense-in-depth, overlap prevented app-side).

## 16. Migration Strategy & Hand-Augmented SQL

- Created via `prisma migrate dev --create-only --name init_domain_schema`, then **hand-augmented** migration.sql appended: two partial unique indexes (`uq_slot_lock_active`, `uq_active_schedule_version`), 21 named `CHECK` constraints, `business_public_slug_lowercase`/`user_email_lowercase` checks, and the **app-role grants**:
  `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES … TO werefa_app`, `GRANT USAGE,SELECT ON ALL SEQUENCES`, plus `ALTER DEFAULT PRIVILEGES FOR ROLE werefa_migrator …` so future tables stay usable.
- Applied to `werefa_dev` (`prisma migrate dev`) and deployed to `werefa_test` (`prisma migrate deploy` with migrator URL); `prisma migrate status` = up to date on both. The empty Prompt-39 baseline was **not rewritten**; this is the first real migration file.
- Governance caveat: Prisma's diff engine cannot see partial indexes/CHECKs (not expressible in schema.prisma). A future `prisma migrate dev` against a schema change **may generate DROP statements** for them. Recommended follow-through: author schema changes with `prisma migrate diff --from-migrations` for review, keep these hand objects annotated in the migration SQL, and verify `migrate status` before/after. This is the only residual risk introduced deliberately.

## 17. Repository Boundary (HTTP → service → repository → Prisma → PG)

`DomainModule` (`src/domain/domain.module.ts`) exports three repository ports + Prisma implementations (`src/domain/repositories/`), each `@Inject(PRISMA_CLIENT)`:
- **BusinessRepository** — `createForOwner` (nested settings + owner in one tx), `findBySlug` (case-insensitive, includes owners + category), `findById`, `listByOwner` (multi-business REQ-013).
- **BookingRepository** — `createBooking` (whole aggregate in a caller-provided `Prisma.TransactionClient`: booking + components + initial history + payment + proof + LOCKED slot lock), `findById`/`listByBusiness` (business-scoped, optional status/time filters), `appendStatusHistory` (REQ-173).
- **ScheduleRepository** — `createPendingVersion` (nested working periods / blocked periods / special dates), `applyVersion` (→ACTIVE; partial index guards), `getActiveVersion` (with details), `listVersions`.

Only the core business/booking/schedule boundaries are wired now; no dozens of empty repositories (§21). DI tokens live in `repositories/tokens.ts`.

## 18. Integration Test Strategy (DB-gated)

- Runner `npm run test:db` → `scripts/run-db-tests.mjs` now runs `npx vitest run src/database src/domain` with `RUN_DB_TESTS=true` + `TEST_DATABASE_URL` (werefa_test, host 5433). Without those envs the suites `describe.skipIf(!RUN)` → deterministic `npm test` stays DB-free.
- `src/domain/domain.repositories.db.spec.ts` (27 tests) validates: base tables/enums; partial-index presence; app-role DML (grants); global slug uniqueness case-insensitively (REQ-047); lowercase CHECKs; one-owner + multi-business (REQ-011/012/013); atomic booking aggregate (components/history/payment/proof/LOCKED lock — REQ-076/100/121/173); integer chronological booking ID (REQ-109/190); one-payment-per-booking; snapshot immutability vs later catalog edits (REQ-076/080); append-only status history with actor (REQ-173); separate booking vs payment status (REQ-100); active-slot partial unique index + release re-open (REQ-121, no TTL); release-correlation CHECK; one ACTIVE schedule version (partial index) with many PENDING; version-scoped template validation (weekday/hours); special-date uniqueness; schedule-exception persistence + unique (+FK requires real booking); minute precision + start<end (REQ-226); invalid enum rejection; money exact bigint round-trip + non-negative; timestamptz instant round-trip; prepayment-mode consistency (REQ-111); subscription-proof rejection reason (REQ-138); unique submission_key idempotency; tenant scoping of repository reads; notification idempotency key.
- Test isolation: only `werefa_test` is touched; test data is wiped (`DELETE` in FK order) at suite start and end; the dev database is never reset; PG 18 is not present; port stays 5433.

## 19. Verification & Gates

- Backend unit `npm test`: **38 passed / 30 skipped** (DB suites skipped deterministically) — unchanged baseline.
- Backend lint `npm run lint`: clean. Typecheck `npm run typecheck`: clean. Build `nest build`: succeeds (dist).
- Live DB `npm run test:db`: **32 passed** (27 domain + 3 database integration + 2 PrismaDatabase unit), run **three times** (all green).
- `prisma generate` (6.19.3) regenerated client; `prisma validate` clean; `prisma migrate status` = up to date on dev and test.
- Frontend regression (untouched code): `npm test` **275 passed**; `tsc -b` clean; `eslint .` clean; production build succeeds.

## 20. Product Decisions Intentionally Left Unresolved (spec §46)

1. Subscription monthly price (REQ-125) — no column/value invented; `subscription` carries status/timestamps only.
2. Global timezone identity (REQ-222) — no per-tenant column and no chosen value; `slot_date` derivation in the repository uses a **clearly non-normative UTC placeholder** (labeled in code comments) until the Product Owner confirms the timezone.
3. Subscription-reminder lead time (REQ-139) — `subscription_reminder` records once-per-band `sent_at`; the lead value stays in config (`.env.example`).
4. Owner booking-report PDF export — only `report_job` skeleton + `FileObject` REPORT_PDF category exist; no export feature.
5. Owner "modify" scope incl. services/components — no modify write-path beyond append-status-history; schema is future-compatible only.
6. Timezone-abbreviation display (BR-32) — no display code; single global TZ assumption noted.

## 21. Known Limitations & Future-Proofing

- **RLS not yet enabled.** ADR-003/RLS policies require a per-request `app.business_id` session context that does not exist without auth-middleware. Enabling it now would break every app-role insert in tests. The schema (business_id on every tenant table + grants) is RLS-ready; enabling is a follow-up phase with its own policy migration.
- **Auth entities deferred** (session/tokens/recovery tables). `user` exists; the rest land with the auth phase.
- **Overlap detection app-side** (exact-identity partial index is DB defense-in-depth only; doc 08).
- **`slot_date` timezone placeholder** (see §20 #2).
- **Repo breadth limited** to business/booking/schedule — intentional per "no dozens of empty repos".
- **Prisma-vs-hand-SQL drift risk** documented in §16.
- Overnight working periods unsupported (single-day semantics).

## 22. Files Changed

**Backend (new):** `prisma/migrations/20260916123842_init_domain_schema/migration.sql`, `prisma/migrations/migration_lock.toml`, `src/domain/domain.module.ts`, `src/domain/repositories/{tokens.ts, business.repository.port.ts, booking.repository.port.ts, schedule.repository.port.ts, prisma-business.repository.ts, prisma-booking.repository.ts, prisma-schedule.repository.ts}`, `src/domain/domain.repositories.db.spec.ts`.
**Backend (modified):** `prisma/schema.prisma` (foundation → full domain model), `src/app.module.ts` (DomainModule import), `scripts/run-db-tests.mjs` (adds `src/domain`).
**Frontend:** none.
**Docs:** this report. **Spec:** untouched.

## 23. Git & Change Control / Final Verification

- No commits created; no history rewritten; no force-push. Working tree retains only Prompt-38 pre-existing frontend changes plus Prompt-40 backend additions (all new files untracked; HEAD unchanged at `868e071`).
- Verification performed: spec byte-unchanged (`git status`/`git diff` show no modification); `prisma migrate status` up-to-date (dev + test); migration name `20260916123842_init_domain_schema`; DB-gated suite run repeatedly (3× green); backend + frontend gates all green.
- Final state deliverable ends with the Prompt 40 completion sentence.