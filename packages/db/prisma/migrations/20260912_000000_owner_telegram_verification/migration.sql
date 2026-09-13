-- Owner payment-proof verification over Telegram (REQ-065/066/067/068/120,
-- Prompt 23). Additive tables for the owner Telegram verification workflow:
--
-- business_owner_telegram_connection
--   One active chat binding per (owner, business) pair. A shared bot serves
--   every business, so a single chatId may legitimately appear for several
--   businesses (one owner managing many) — hence NO global chatId uniqueness.
--   The connect token is stored only as sha256 (PENDING → ACTIVE on /start).
--
-- owner_telegram_action
--   Single-use, expiring Accept/Reject action tokens embedded as inline
--   callback_data in the new-proof notification. Raw tokens are random 256-bit
--   base64url, hashed to sha256 at rest. Reject is two-step (ISSUED →
--   AWAITING_REASON → CONSUMED). RLS: system scope only (see rls.sql).
--
-- RLS for both tables is defined in the shared rls.sql policy block
-- (applied idempotently by bootstrap-rls.ts AFTER this migration runs).

-- business_owner_telegram_connection
CREATE TABLE "business_owner_telegram_connection" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "TelegramConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "connect_token_hash" CHAR(64),
  "connect_token_expires_at" TIMESTAMPTZ(6),
  "chat_id" BIGINT,
  "connected_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_owner_telegram_connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_owner_telegram_connection_user_id_business_id_key"
  ON "business_owner_telegram_connection"("user_id", "business_id");
CREATE UNIQUE INDEX "business_owner_telegram_connection_user_id_chat_id_key"
  ON "business_owner_telegram_connection"("user_id", "chat_id");
CREATE INDEX "business_owner_telegram_connection_business_id_idx"
  ON "business_owner_telegram_connection"("business_id");
CREATE INDEX "business_owner_telegram_connection_status_idx"
  ON "business_owner_telegram_connection"("status");

ALTER TABLE "business_owner_telegram_connection"
  ADD CONSTRAINT "business_owner_telegram_connection_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "public"."business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_owner_telegram_connection"
  ADD CONSTRAINT "business_owner_telegram_connection_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- owner_telegram_action
CREATE TABLE "owner_telegram_action" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "proof_id" UUID NOT NULL,
  "chat_id" BIGINT NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "reason" VARCHAR(500),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_telegram_action_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_telegram_action_token_hash_key"
  ON "owner_telegram_action"("token_hash");
CREATE INDEX "owner_telegram_action_business_id_idx"
  ON "owner_telegram_action"("business_id");
CREATE INDEX "owner_telegram_action_chat_id_status_idx"
  ON "owner_telegram_action"("chat_id", "status");
CREATE INDEX "owner_telegram_action_expires_at_idx"
  ON "owner_telegram_action"("expires_at");

ALTER TABLE "owner_telegram_action"
  ADD CONSTRAINT "owner_telegram_action_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "public"."business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_telegram_action"
  ADD CONSTRAINT "owner_telegram_action_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- kind/status sanity: only ever the verifier actions we issue.
ALTER TABLE "owner_telegram_action"
  ADD CONSTRAINT "owner_telegram_action_kind_ck"
  CHECK ("kind" IN ('ACCEPT', 'REJECT'));

ALTER TABLE "owner_telegram_action"
  ADD CONSTRAINT "owner_telegram_action_status_ck"
  CHECK ("status" IN ('ISSUED', 'AWAITING_REASON', 'CONSUMED', 'EXPIRED'));

-- A reject reason may only ever be recorded for reject actions.
ALTER TABLE "owner_telegram_action"
  ADD CONSTRAINT "owner_telegram_action_reason_ck"
  CHECK ("kind" != 'REJECT' OR "reason" IS NULL OR length("reason") BETWEEN 1 AND 500);