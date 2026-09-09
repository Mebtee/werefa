-- Werefa Scheduling Management domain (PROMPT 12 — Domains 12/13/16, docs
-- 10/13/21). Additive tables: schedule_version (ACTIVE/PENDING/SUPERSEDED),
-- working_period (weekly), special_date + special_date_period, blocked_period,
-- schedule_conflict, schedule_exception. All tenant-owned (business_id FK,
-- doc 04) and RLS-protected (policies applied by bootstrap-rls.ts / rls.sql —
-- the policy block is re-run on a clean test DB, so table + constraint DDL
-- lives here and policies live in rls.sql).
--
-- Concurrency (doc 10 §8): every schedule save / activation runs inside an
-- interactive transaction under `pg_advisory_xact_lock(hashtext(business_id))`
-- and RE-EVALUATES affected bookings inside the lock; availability creation
-- uses the SAME lock, so a save cannot interleave a booking creation.
--
-- Semantics:
--   * At most ONE ACTIVE version per business (partial unique index); the app
--     supersedes the current ACTIVE *before* inserting a replacement.
--   * Multiple PENDING versions are allowed while paused (REQ-152); resume
--     (manual + auto, REQ-151/158) activates the LATEST pending and
--     supersedes the older ones.
--   * day_of_week is 0 = Sunday (JS convention); start/end are minutes-of-day
--     within [0, 1440), start < end (REQ-083/084, docs 10 §3).
--   * All instants are minute-precision timestamptz (REQ-226); calendar days
--     are local dates represented as their UTC-midnight instant and mapped by
--     the fixed global UTC+3 offset (no per-business timezone, doc 10 §2).
--   * schedule_conflict is a durable audit + email trigger row; the exposed
--     affected-booking list is recomputed FRESH by the engine on every read so
--     reschedule/cancel self-heal. unique(schedule_version_id, booking_id).
--   * schedule_exception is the owner "keep" marker (REQ-160): unique per
--     booking (single active exception, UPSERT on repeat keep) and NEVER makes
--     a time generally bookable (doc 10 §4).
--   * A business with NO ACTIVE version keeps the legacy all-day availability
--     (doc 10 §2/§8) — schedule constraints only bind once a version is saved.

-- ---------------------------------------------------------------------------
-- schedule_version
-- ---------------------------------------------------------------------------
CREATE TYPE "ScheduleVersionStatus" AS ENUM ('ACTIVE','PENDING','SUPERSEDED');
CREATE TYPE "ScheduleConflictStatus" AS ENUM ('OPEN','RESOLVED_KEPT');

CREATE TABLE "schedule_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "status" "ScheduleVersionStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "booking_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_version_pkey" PRIMARY KEY ("id"),
    -- REQ-088. Lower bound keeps basis-of-time grids sane; upper bound avoids
    -- slots longer than a full day.
    CONSTRAINT "schedule_version_booking_interval_minutes_ck"
      CHECK ("booking_interval_minutes" >= 5 AND "booking_interval_minutes" <= 240)
);

-- Defense-in-depth: exactly one ACTIVE version per business. The app
-- supersedes the current ACTIVE before inserting a replacement inside the
-- transaction, so this never blocks a legitimately serialized save.
CREATE UNIQUE INDEX "uq_schedule_version_active_one"
  ON "schedule_version"("business_id") WHERE "status" = 'ACTIVE';

CREATE INDEX "schedule_version_business_id_status_idx"
  ON "schedule_version"("business_id", "status");
CREATE INDEX "schedule_version_business_id_created_at_idx"
  ON "schedule_version"("business_id", "created_at");

ALTER TABLE "schedule_version" ADD CONSTRAINT "schedule_version_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- working_period (weekly hours, REQ-082/083)
-- ---------------------------------------------------------------------------
CREATE TABLE "working_period" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_minutes" SMALLINT NOT NULL,
    "end_minutes" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "working_period_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "working_period_bounds_ck"
      CHECK (
        "day_of_week" BETWEEN 0 AND 6
        AND "start_minutes" >= 0 AND "end_minutes" <= 1440
        AND "start_minutes" < "end_minutes"
      )
);
CREATE INDEX "working_period_schedule_version_id_idx" ON "working_period"("schedule_version_id");
CREATE INDEX "working_period_business_id_idx" ON "working_period"("business_id");

ALTER TABLE "working_period" ADD CONSTRAINT "working_period_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "working_period" ADD CONSTRAINT "working_period_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- special_date + special_date_period (override day for a specific date,
-- REQ-085/086). is_closed ==> closed override; otherwise the per-day periods
-- apply. Overrides weekly hours entirely for that date (doc 10 §3).
-- ---------------------------------------------------------------------------
CREATE TABLE "special_date" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "calendar_date" DATE NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "special_date_pkey" PRIMARY KEY ("id"),
    -- At most one override per date in a version.
    CONSTRAINT "special_date_schedule_version_id_calendar_date_key"
      UNIQUE ("schedule_version_id", "calendar_date")
);
CREATE INDEX "special_date_business_id_idx" ON "special_date"("business_id");

ALTER TABLE "special_date" ADD CONSTRAINT "special_date_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "special_date" ADD CONSTRAINT "special_date_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "special_date_period" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "special_date_id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "start_minutes" SMALLINT NOT NULL,
    "end_minutes" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "special_date_period_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "special_date_period_bounds_ck"
      CHECK (
        "start_minutes" >= 0 AND "end_minutes" <= 1440
        AND "start_minutes" < "end_minutes"
      )
);
CREATE INDEX "special_date_period_special_date_id_idx" ON "special_date_period"("special_date_id");
CREATE INDEX "special_date_period_schedule_version_id_idx" ON "special_date_period"("schedule_version_id");
CREATE INDEX "special_date_period_business_id_idx" ON "special_date_period"("business_id");

ALTER TABLE "special_date_period" ADD CONSTRAINT "special_date_period_special_date_id_fkey"
  FOREIGN KEY ("special_date_id") REFERENCES "special_date"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "special_date_period" ADD CONSTRAINT "special_date_period_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "special_date_period" ADD CONSTRAINT "special_date_period_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- blocked_period (arbitrary date/time block-out, REQ-084)
-- ---------------------------------------------------------------------------
CREATE TABLE "blocked_period" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_version_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocked_period_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blocked_period_minute_precision_ck"
      CHECK (
        "start_at" = date_trunc('minute', "start_at")
        AND "end_at" = date_trunc('minute', "end_at")
      ),
    CONSTRAINT "blocked_period_end_after_start_ck"
      CHECK ("end_at" > "start_at")
);
CREATE INDEX "blocked_period_schedule_version_id_idx" ON "blocked_period"("schedule_version_id");
CREATE INDEX "blocked_period_business_id_start_at_idx" ON "blocked_period"("business_id", "start_at");

ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- schedule_conflict (durable audit + email trigger, REQ-093/094/133)
-- ---------------------------------------------------------------------------
CREATE TABLE "schedule_conflict" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ScheduleConflictStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    CONSTRAINT "schedule_conflict_pkey" PRIMARY KEY ("id"),
    -- Dedupe: one conflict row per (version, booking).
    CONSTRAINT "schedule_conflict_schedule_version_id_booking_id_key"
      UNIQUE ("schedule_version_id", "booking_id")
);
CREATE INDEX "schedule_conflict_business_id_idx" ON "schedule_conflict"("business_id");
CREATE INDEX "schedule_conflict_booking_id_idx" ON "schedule_conflict"("booking_id");

ALTER TABLE "schedule_conflict" ADD CONSTRAINT "schedule_conflict_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_conflict" ADD CONSTRAINT "schedule_conflict_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_conflict" ADD CONSTRAINT "schedule_conflict_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- schedule_exception (owner "keep" marker, REQ-160/161).
-- Single active exception per booking (UPSERT on repeat keep). NEVER makes a
-- time generally bookable — only exempts THIS booking from conflict warnings.
-- ---------------------------------------------------------------------------
CREATE TABLE "schedule_exception" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "schedule_version_id" UUID NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_exception_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "schedule_exception_booking_id_key" UNIQUE ("booking_id")
);
CREATE INDEX "schedule_exception_business_id_idx" ON "schedule_exception"("business_id");
CREATE INDEX "schedule_exception_schedule_version_id_idx" ON "schedule_exception"("schedule_version_id");

ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_exception" ADD CONSTRAINT "schedule_exception_schedule_version_id_fkey"
  FOREIGN KEY ("schedule_version_id") REFERENCES "schedule_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;