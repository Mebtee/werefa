-- Subscription proof idempotency (Prompt 52; REQ-121 architecture).
-- The submission key is globally unique like payment_proof.submission_key and
-- makes a repeated owner upload exactly-once (P2002 on replay).

ALTER TABLE "subscription_proof"
  ADD COLUMN "submission_key" VARCHAR(128) NOT NULL DEFAULT '';

-- Backfill is impossible for existing rows (none exist before this migration);
-- the DEFAULT is only a safety net for the NOT NULL constraint and must be
-- removed once real writes are the only path. Existing seeds have no proofs.
UPDATE "subscription_proof" SET "submission_key" = 'seed-' || "id" WHERE "submission_key" = '';

ALTER TABLE "subscription_proof"
  ALTER COLUMN "submission_key" DROP DEFAULT;

CREATE UNIQUE INDEX "subscription_proof_submission_key_key"
  ON "subscription_proof"("submission_key");