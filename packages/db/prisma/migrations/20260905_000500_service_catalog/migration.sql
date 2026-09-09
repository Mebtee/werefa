-- Werefa Service Catalog (Prompt 10, Domain 8 — Services/Pricing).
-- Additive tables: Service (REQ-071/077..081), ServiceVariation (REQ-072),
-- AddOn (REQ-073). All three are tenant-owned (business_id FK, doc 04) and
-- RLS-protected (policies applied by bootstrap-rls.ts / rls.sql — the policy
-- block is re-run on a clean test DB, so table + constraint DDL lives here and
-- policies live in rls.sql).
--
-- Money representation (REQ-071): integer minor units as BIGINT (no floats,
-- no silent rounding). Only price for a service is stored, not fee/debt.
-- Duration (REQ-226): whole minutes as INTEGER; a service requires >= 1 minute,
-- add-on duration deltas >= 0 (REQ-073 AC1 — additive increases).
-- Deltas on service_variation are SIGNED (a variation may reduce the base);
-- effective totals (base + delta) are validated at the app layer
-- (>= 0 minor units / >= 1 minute). DB CHECKs cover the invariants that live
-- on the row itself; the DB is the final boundary for those.

-- ---------------------------------------------------------------------------
-- service
-- ---------------------------------------------------------------------------
CREATE TABLE "service" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_price_minor" BIGINT NOT NULL DEFAULT 0,
    "base_duration_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id"),
    -- REQ-071: a service always has a price (>= 0) and a positive duration.
    CONSTRAINT "service_base_price_minor_ck" CHECK ("base_price_minor" >= 0),
    CONSTRAINT "service_base_duration_minutes_ck" CHECK ("base_duration_minutes" > 0)
);

-- One service name per business (doc 06; names are not globally unique).
CREATE UNIQUE INDEX "service_business_id_name_key" ON "service"("business_id", "name");

-- Public-catalog lookup: active services of a business (REQ-079/214).
CREATE INDEX "service_business_id_is_active_idx" ON "service"("business_id", "is_active");

ALTER TABLE "service" ADD CONSTRAINT "service_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- service_variation
-- ---------------------------------------------------------------------------
-- A variation is an option of its parent service (REQ-072). It carries
-- SIGNED deltas relative to the service's base price/duration, per the
-- architecture model (doc 07 `service_variation`).
CREATE TABLE "service_variation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" BIGINT NOT NULL DEFAULT 0,
    "duration_delta_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_variation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_variation_service_id_name_key" ON "service_variation"("service_id", "name");
CREATE INDEX "service_variation_business_id_idx" ON "service_variation"("business_id");

ALTER TABLE "service_variation" ADD CONSTRAINT "service_variation_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_variation" ADD CONSTRAINT "service_variation_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- add_on
-- ---------------------------------------------------------------------------
-- Add-ons change the booking price and/or duration by their configured values
-- (REQ-073 AC1). Deltas are additive and non-negative; the DB guarantees the
-- non-negativity so a booking total can never be reduced below the base by an
-- add-on.
CREATE TABLE "add_on" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" BIGINT NOT NULL DEFAULT 0,
    "duration_delta_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "add_on_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "add_on_price_delta_minor_ck" CHECK ("price_delta_minor" >= 0),
    CONSTRAINT "add_on_duration_delta_minutes_ck" CHECK ("duration_delta_minutes" >= 0)
);

CREATE UNIQUE INDEX "add_on_service_id_name_key" ON "add_on"("service_id", "name");
CREATE INDEX "add_on_business_id_idx" ON "add_on"("business_id");

ALTER TABLE "add_on" ADD CONSTRAINT "add_on_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "add_on" ADD CONSTRAINT "add_on_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;