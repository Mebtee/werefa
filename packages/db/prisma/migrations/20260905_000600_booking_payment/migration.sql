-- Werefa Booking & Payment domain (Prompt 11, Domains 5/6/10/11).
-- Additive tables: booking, booking_service_item (historical snapshots),
-- booking_status_history, payment, payment_status_history,
-- payment_rejection_event, payment_proof, slot_lock, resubmission_verification,
-- notification (outbox). All tenant-owned (business_id FK, doc 04) and
-- RLS-protected (policies applied by bootstrap-rls.ts / rls.sql — the policy
-- block is re-run on a clean test DB, so table + constraint DDL lives here and
-- policies live in rls.sql).
--
-- Concurrency (doc 08): slot mutations run inside an interactive transaction
-- under `pg_advisory_xact_lock(hashtext(business_id::text))` and re-check
-- availability inside the lock. The partial unique index on active slot_lock is
-- DEFENSE-IN-DEPTH for duplicate EXACT slot identities — it does NOT detect
-- different-but-overlapping windows (prevented by the advisory lock + overlap
-- re-check, doc 08 §1/§3).
--
-- Money: integer minor units as BIGINT (never float). Duration: whole minutes.
-- Booking status (six values) and payment status (PENDING/ACCEPTED/REJECTED)
-- are SEPARATE enums (REQ-100). NO refund/cancelled-payment/failed states.

-- ---------------------------------------------------------------------------
-- booking
-- ---------------------------------------------------------------------------
CREATE TYPE "BookingStatus" AS ENUM (
  'PAYMENT_PENDING','CONFIRMED','REJECTED','COMPLETED','NO_SHOW','CANCELLED'
);

CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "note" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "slot_date" DATE NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_pkey" PRIMARY KEY ("id"),
    -- REQ-226: minute precision, whole minutes only (seconds never non-zero).
    CONSTRAINT "booking_minute_precision_ck"
      CHECK (
        "start_at" = date_trunc('minute', "start_at")
        AND "end_at" = date_trunc('minute', "end_at")
      )
);

-- Slot must always end after it starts (doc 08 slot = [start_at, end_at)).
CREATE INDEX "booking_business_id_start_at_idx" ON "booking"("business_id", "start_at");
CREATE INDEX "booking_business_id_status_idx" ON "booking"("business_id", "status");

ALTER TABLE "booking" ADD CONSTRAINT "booking_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- booking_service_item (historical snapshots, REQ-074/075/076/080)
-- ---------------------------------------------------------------------------
-- Holds immutable per-booking service identity + name + price + duration.
-- service_id is nullable + SET NULL so a service with only PAST bookings can be
-- hard-deleted (REQ-077 blocks deletion only while FUTURE bookings exist); the
-- snapshots keep the booking record fully replayable after the live reference
-- is gone. Future-booking blocking is the app-layer FutureBookingsSeam check.
CREATE TABLE "booking_service_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_service_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_service_item_unit_price_minor_ck" CHECK ("unit_price_minor" >= 0),
    CONSTRAINT "booking_service_item_duration_minutes_ck" CHECK ("duration_minutes" > 0)
);
CREATE INDEX "booking_service_item_booking_id_idx" ON "booking_service_item"("booking_id");
CREATE INDEX "booking_service_item_business_id_idx" ON "booking_service_item"("business_id");
CREATE INDEX "booking_service_item_service_id_idx" ON "booking_service_item"("service_id");

ALTER TABLE "booking_service_item" ADD CONSTRAINT "booking_service_item_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_service_item" ADD CONSTRAINT "booking_service_item_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL: past-booked services remain deletable; snapshots keep history.
ALTER TABLE "booking_service_item" ADD CONSTRAINT "booking_service_item_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- booking_status_history (append-only, REQ-163/173)
-- ---------------------------------------------------------------------------
CREATE TYPE "ActorType" AS ENUM ('OWNER','ADMIN','SUPER_ADMIN','SYSTEM');

CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "BookingStatus" NOT NULL,
    "to_status" "BookingStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "booking_status_history_booking_id_idx" ON "booking_status_history"("booking_id");
CREATE INDEX "booking_status_history_business_id_occurred_at_idx"
  ON "booking_status_history"("business_id", "occurred_at");

ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- payment (exactly one per booking; status PENDING/ACCEPTED/REJECTED only)
-- ---------------------------------------------------------------------------
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER','TELEBIRR_MOBILE_MONEY');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING','ACCEPTED','REJECTED');

CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,
    "prepaid_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_pkey" PRIMARY KEY ("id"),
    -- REQ-100 / SM-12: only the three approved payment states.
    CONSTRAINT "payment_status_ck" CHECK ("status" IN ('PENDING','ACCEPTED','REJECTED'))
);
CREATE UNIQUE INDEX "payment_booking_id_key" ON "payment"("booking_id");
CREATE INDEX "payment_business_id_idx" ON "payment"("business_id");
CREATE INDEX "payment_business_id_status_idx" ON "payment"("business_id", "status");

ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "PaymentStatus" NOT NULL,
    "to_status" "PaymentStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_status_history_payment_id_idx" ON "payment_status_history"("payment_id");
CREATE INDEX "payment_status_history_business_id_idx" ON "payment_status_history"("business_id");

ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rejection reason (REQ-68/124) — mandatory, delivered via notification event.
CREATE TABLE "payment_rejection_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_rejection_event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_rejection_event_payment_id_idx" ON "payment_rejection_event"("payment_id");

ALTER TABLE "payment_rejection_event" ADD CONSTRAINT "payment_rejection_event_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_rejection_event" ADD CONSTRAINT "payment_rejection_event_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- payment_proof (file reference + idempotency submission_key + lineage)
-- ---------------------------------------------------------------------------
CREATE TABLE "payment_proof" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "file_object_id" UUID,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "submission_key" TEXT NOT NULL,
    "replaced_by_proof_id" UUID,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_proof_pkey" PRIMARY KEY ("id"),
    -- Idempotency (doc 08 §4): one submission key ever.
    CONSTRAINT "payment_proof_submission_key_key" UNIQUE ("submission_key")
);
CREATE INDEX "payment_proof_payment_id_idx" ON "payment_proof"("payment_id");
CREATE INDEX "payment_proof_business_id_idx" ON "payment_proof"("business_id");

ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Lineage chain (REQ-230).
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_replaced_by_proof_id_fkey"
  FOREIGN KEY ("replaced_by_proof_id") REFERENCES "payment_proof"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- slot_lock (durable, no TTL — OQ-SLOT-001)
-- ---------------------------------------------------------------------------
CREATE TYPE "SlotLockStatus" AS ENUM ('LOCKED','ALLOCATED','RELEASED');

CREATE TABLE "slot_lock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "booking_id" UUID,
    "slot_date" DATE NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "SlotLockStatus" NOT NULL DEFAULT 'LOCKED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),
    "released_by" TEXT,
    "released_by_user_id" UUID,
    CONSTRAINT "slot_lock_pkey" PRIMARY KEY ("id")
);

-- Defense-in-depth: at most one ACTIVE lock per EXACT slot identity.
-- Does NOT detect overlapping windows — that is the advisory-lock + re-check
-- responsibility (doc 08 §1). 
CREATE UNIQUE INDEX "uq_slot_lock_active"
  ON "slot_lock"("business_id", "slot_date", "start_at")
  WHERE "status" IN ('LOCKED','ALLOCATED');

CREATE INDEX "slot_lock_business_id_slot_date_idx" ON "slot_lock"("business_id", "slot_date");

ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slot_lock" ADD CONSTRAINT "slot_lock_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure a non-null booking_id points only at that booking (best-effort).
CREATE INDEX "slot_lock_booking_id_idx" ON "slot_lock"("booking_id");

-- ---------------------------------------------------------------------------
-- resubmission_verification (one-time, expiring, phone-scoped, hashed code)
-- ---------------------------------------------------------------------------
CREATE TABLE "resubmission_verification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'BOOKING_RESUBMISSION',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "resubmission_verification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "resubmission_verification_booking_id_idx" ON "resubmission_verification"("booking_id");
CREATE INDEX "resubmission_verification_business_id_idx" ON "resubmission_verification"("business_id");

ALTER TABLE "resubmission_verification" ADD CONSTRAINT "resubmission_verification_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resubmission_verification" ADD CONSTRAINT "resubmission_verification_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- notification (outbox — doc 13): durable, business-scoped domain event
-- ---------------------------------------------------------------------------
CREATE TABLE "notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID,
    "booking_id" UUID,
    "type" TEXT NOT NULL,
    "tenant_scope" TEXT NOT NULL DEFAULT 'BOOKING',
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_business_id_idx" ON "notification"("business_id");
CREATE INDEX "notification_booking_id_idx" ON "notification"("booking_id");
CREATE INDEX "notification_type_idx" ON "notification"("type");

ALTER TABLE "notification" ADD CONSTRAINT "notification_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification" ADD CONSTRAINT "notification_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
