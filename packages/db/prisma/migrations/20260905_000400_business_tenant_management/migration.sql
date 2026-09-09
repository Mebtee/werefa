-- Werefa Business & Tenant Management (Prompt 09).
-- Additive business profile/lifecycle/pause columns, business-category string,
-- media key references, a per-new-business trial marker, and business-scoped
-- security events. Tenant-owned data remains on the existing `business` table
-- (already RLS-protected); the only new tenant-owned columns live there.
--
-- RLS policy changes are applied separately by bootstrap-rls.ts (rls.sql) so
-- they are re-applied on a clean test DB rebuild.

-- Business profile + category (REQ-003/004/215, REQ-208..213).
-- category is a validated VARCHAR (app-level allowlist) so the category set can
-- grow in the future without a schema/enum migration.
ALTER TABLE "business" ADD COLUMN "category" VARCHAR(50);
ALTER TABLE "business" ADD COLUMN "description" TEXT;
ALTER TABLE "business" ADD COLUMN "phone" TEXT;
ALTER TABLE "business" ADD COLUMN "contact_email" CITEXT;
ALTER TABLE "business" ADD COLUMN "address" TEXT;
ALTER TABLE "business" ADD COLUMN "latitude" DECIMAL(9,6);
ALTER TABLE "business" ADD COLUMN "longitude" DECIMAL(9,6);
ALTER TABLE "business" ADD COLUMN "google_maps_link" TEXT;
ALTER TABLE "business" ADD COLUMN "open_street_map_link" TEXT;

-- Media references (REQ-208): exactly one logo and one cover photo, stored as
-- business-scoped object-storage keys. No gallery is modelled.
ALTER TABLE "business" ADD COLUMN "logo_key" TEXT;
ALTER TABLE "business" ADD COLUMN "cover_key" TEXT;

-- Lifecycle + pause (REQ-143..149, REQ-153..157, REQ-216).
-- is_paused: true while bookings are paused (indefinite or scheduled).
-- paused_until: the scheduled resume time; NULL when paused indefinitely.
-- pause_message / reopen messaging (REQ-148/149).
-- deactivated_at: pre-existing lifecycle column (REQ-216).
-- trial_ends_at: REQ-006/128 30-day free trial per new business (subscription
-- boundary placeholder; the real subscription module will supersede it).
ALTER TABLE "business" ADD COLUMN "is_paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "business" ADD COLUMN "paused_until" TIMESTAMPTZ(6);
ALTER TABLE "business" ADD COLUMN "pause_message" TEXT;
ALTER TABLE "business" ADD COLUMN "trial_ends_at" TIMESTAMPTZ(6);

-- Business-scoped audit (doc 04 §11, doc 22): a nullable business_id lets
-- business-management security events carry tenant scope. Platform events that
-- are unrelated to a tenant leave this NULL. Not tenant-RLS-gated: security
-- events are platform-level (doc 04 §3).
ALTER TABLE "security_event" ADD COLUMN "business_id" UUID;

-- Index for the public-slug lookup (unique already exists) + business-scoped
-- security events.
CREATE INDEX "security_event_business_id_idx" ON "security_event"("business_id");

-- AddForeignKey (soft: ON DELETE SET NULL so history survives owner removal)
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
