-- Werefa Subscription & Billing domain (Prompt 14, REQ-125..141, doc 15).
-- Additive tables: subscription (1:1 per business), subscription_payment
-- (manual bank-transfer payment request with proof upload), and
-- subscription_status_history (append-only audit). All tenant-owned
-- (business_id FK, doc 04) and RLS-protected (policies applied by
-- bootstrap-rls.ts / rls.sql — the policy block is re-run on a clean test DB,
-- so table + constraint DDL lives here and policies live in rls.sql).
--
-- Money: integer minor units as BIGINT (never float, REQ-071). Timestamps are
-- minute-precision where they are business-period boundaries (REQ-226).
-- Payment proof uploads are business-scoped file references only (object
-- storage holds the bytes, doc 16); the MIME allowlist + size cap are
-- enforced at the application layer.

-- ---------------------------------------------------------------------------
-- subscription
-- ---------------------------------------------------------------------------
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'NONE','TRIAL','TRIAL_GRACE','ACTIVE','PAID_GRACE','EXPIRED'
);

CREATE TABLE "subscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "trial_started_at" TIMESTAMPTZ(6),
    "trial_ends_at" TIMESTAMPTZ(6),
    "trial_grace_ends_at" TIMESTAMPTZ(6),
    "paid_period_start_at" TIMESTAMPTZ(6),
    "paid_ends_at" TIMESTAMPTZ(6),
    "paid_grace_ends_at" TIMESTAMPTZ(6),
    "price_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_price_minor_ck" CHECK ("price_minor" >= 0),
    -- REQ-226 minute precision for every business-period boundary.
    CONSTRAINT "subscription_minute_precision_ck"
      CHECK (
        ("trial_started_at" IS NULL OR "trial_started_at" = date_trunc('minute', "trial_started_at"))
        AND ("trial_ends_at" IS NULL OR "trial_ends_at" = date_trunc('minute', "trial_ends_at"))
        AND ("trial_grace_ends_at" IS NULL OR "trial_grace_ends_at" = date_trunc('minute', "trial_grace_ends_at"))
        AND ("paid_period_start_at" IS NULL OR "paid_period_start_at" = date_trunc('minute', "paid_period_start_at"))
        AND ("paid_ends_at" IS NULL OR "paid_ends_at" = date_trunc('minute', "paid_ends_at"))
        AND ("paid_grace_ends_at" IS NULL OR "paid_grace_ends_at" = date_trunc('minute', "paid_grace_ends_at"))
      )
);
CREATE UNIQUE INDEX "subscription_business_id_key" ON "subscription"("business_id");
CREATE INDEX "subscription_status_idx" ON "subscription"("status");

ALTER TABLE "subscription" ADD CONSTRAINT "subscription_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- subscription_payment (single-use PENDING → APPROVED | REJECTED ticket)
-- ---------------------------------------------------------------------------
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING','APPROVED','REJECTED');

CREATE TABLE "subscription_payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount_minor" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "submission_key" TEXT NOT NULL,
    "note" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_payment_pkey" PRIMARY KEY ("id"),
    -- Idempotency (doc 15 §6): one submission key ever.
    CONSTRAINT "subscription_payment_submission_key_key" UNIQUE ("submission_key"),
    CONSTRAINT "subscription_payment_amount_minor_ck" CHECK ("amount_minor" >= 0),
    CONSTRAINT "subscription_payment_size_bytes_ck" CHECK ("size_bytes" >= 0)
);
CREATE INDEX "subscription_payment_business_id_status_idx"
  ON "subscription_payment"("business_id", "status");
CREATE INDEX "subscription_payment_subscription_id_idx" ON "subscription_payment"("subscription_id");
CREATE INDEX "subscription_payment_status_submitted_at_idx" ON "subscription_payment"("status", "submitted_at");
CREATE INDEX "subscription_payment_reviewed_by_user_id_idx" ON "subscription_payment"("reviewed_by_user_id");
CREATE INDEX "subscription_payment_rejection_reason_idx" ON "subscription_payment"("rejection_reason");

ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- subscription_status_history (append-only audit of status transitions)
-- ---------------------------------------------------------------------------
CREATE TABLE "subscription_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "SubscriptionStatus" NOT NULL,
    "to_status" "SubscriptionStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_status_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subscription_status_history_subscription_id_idx"
  ON "subscription_status_history"("subscription_id");
CREATE INDEX "subscription_status_history_business_id_occurred_at_idx"
  ON "subscription_status_history"("business_id", "occurred_at");

ALTER TABLE "subscription_status_history" ADD CONSTRAINT "subscription_status_history_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_status_history" ADD CONSTRAINT "subscription_status_history_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;