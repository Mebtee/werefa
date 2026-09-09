-- Werefa Notifications & Telegram domain (PROMPT 13 — Domains 7/16, docs
-- 12/13/17). Additive tables: telegram_connection (one-time connect token +
-- chat binding per booking), notification_delivery (durable send intent),
-- telegram_update (webhook dedup). Delivery + connection rows are tenant-owned
-- (business_id FK, doc 04) and RLS-protected (policies in rls.sql, applied by
-- bootstrap-rls.ts; this file carries table + constraint DDL only).
--
-- Telegram connection semantics (doc 12 §3/§4, REQ-056):
--   * At most one row per booking (unique booking_id) — the app rotates the
--     row's PENDING token rather than inserting a second connection.
--   * A chat links to at most one connection (unique chat_id; multiple NULLs
--     for the not-yet-connected rows are fine in Postgres).
--   * connect_token_hash is a sha256 hex of a per-issue 256-bit random token
--     (non-guessable, one-time, TTL 30 min default); the raw token is never
--     stored. Fields are cleared the instant the chat is bound.
--   * status lifecycle: PENDING -> ACTIVE (webhook verified chat) | EXPIRED
--     (token TTL elapsed) | REVOKED (customer disconnects, phone-gated).
--
-- Delivery semantics (doc 13 §3/§4, doc 17):
--   * idempotency_key UNIQUE = reruns of the fan-out / worker are no-ops.
--   * PENDING -> SENDING -> SENT | FAILED (retryable, next_attempt_at via
--     exponential backoff) | DEAD_LETTERED (permanent or attempts exhausted) |
--     SUPPRESSED (no recipient / channel unavailable / stale reminder).
--   * status,next_attempt_at index = the notification-retry sweep's queue.

-- ---------------------------------------------------------------------------
-- telegram_connection
-- ---------------------------------------------------------------------------
CREATE TYPE "TelegramConnectionStatus" AS ENUM ('PENDING','ACTIVE','REVOKED','EXPIRED');

CREATE TABLE "telegram_connection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "status" "TelegramConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "connect_token_hash" CHAR(64),
    "connect_token_expires_at" TIMESTAMPTZ(6),
    "chat_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_connection_booking_id_key"
  ON "telegram_connection"("booking_id");
CREATE UNIQUE INDEX "telegram_connection_chat_id_key"
  ON "telegram_connection"("chat_id");
CREATE INDEX "telegram_connection_business_id_idx"
  ON "telegram_connection"("business_id");
CREATE INDEX "telegram_connection_status_idx"
  ON "telegram_connection"("status");

ALTER TABLE "telegram_connection" ADD CONSTRAINT "telegram_connection_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_connection" ADD CONSTRAINT "telegram_connection_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- notification_delivery
-- ---------------------------------------------------------------------------
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL','TELEGRAM');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM
  ('PENDING','SENDING','SENT','FAILED','DEAD_LETTERED','SUPPRESSED');

CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_delivery_idempotency_key_key"
  ON "notification_delivery"("idempotency_key");
CREATE INDEX "notification_delivery_status_next_attempt_at_idx"
  ON "notification_delivery"("status", "next_attempt_at");
CREATE INDEX "notification_delivery_business_id_idx"
  ON "notification_delivery"("business_id");
CREATE INDEX "notification_delivery_notification_id_channel_idx"
  ON "notification_delivery"("notification_id", "channel");

ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- telegram_update (webhook at-most-once, platform-level, OPEN no RLS)
-- ---------------------------------------------------------------------------
CREATE TABLE "telegram_update" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "update_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_update_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_update_update_id_key"
  ON "telegram_update"("update_id");