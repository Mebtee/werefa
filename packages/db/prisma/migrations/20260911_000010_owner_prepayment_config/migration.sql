-- Owner prepayment configuration (REQ-110/111, Prompt 21).
-- Additive columns on the existing `business` table. Default is DISABLED
-- for all existing businesses — no booking behaviour changes until an owner
-- explicitly opts in.
--
-- prepayment_enabled: master toggle (false = no deposit required).
-- prepayment_type:    'PERCENTAGE' | 'FIXED' (nullable while disabled).
-- prepayment_percentage: 1..100 (set only when type = PERCENTAGE).
-- prepayment_fixed_minor: positive minor units (set only when type = FIXED).
--
-- RLS is already inherited from the existing `business` table policies — no
-- new policies needed.

ALTER TABLE "business" ADD COLUMN "prepayment_enabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "business" ADD COLUMN "prepayment_type"     VARCHAR(20);
ALTER TABLE "business" ADD COLUMN "prepayment_percentage" INTEGER;
ALTER TABLE "business" ADD COLUMN "prepayment_fixed_minor" BIGINT;

-- CHECK constraints: exactly one value set when type is non-null.
ALTER TABLE "business"
  ADD CONSTRAINT "business_prepayment_ck"
  CHECK (
    "prepayment_enabled" = false
    OR "prepayment_type" IN ('PERCENTAGE', 'FIXED')
  );

ALTER TABLE "business"
  ADD CONSTRAINT "business_prepayment_pct_ck"
  CHECK (
    "prepayment_type" != 'PERCENTAGE'
    OR ("prepayment_percentage" BETWEEN 1 AND 100)
  );

ALTER TABLE "business"
  ADD CONSTRAINT "business_prepayment_fixed_ck"
  CHECK (
    "prepayment_type" != 'FIXED'
    OR ("prepayment_fixed_minor" IS NOT NULL AND "prepayment_fixed_minor" > 0)
  );

-- Mutually exclusive: when PERCENTAGE, fixed must be null; when FIXED, pct must be null.
ALTER TABLE "business"
  ADD CONSTRAINT "business_prepayment_exclusive_ck"
  CHECK (
    "prepayment_type" IS NULL
    OR (
      ("prepayment_type" = 'PERCENTAGE' AND "prepayment_percentage" IS NOT NULL AND "prepayment_fixed_minor" IS NULL)
      OR
      ("prepayment_type" = 'FIXED' AND "prepayment_fixed_minor" IS NOT NULL AND "prepayment_percentage" IS NULL)
    )
  );
