-- CreateEnum
CREATE TYPE "TelegramTokenState" AS ENUM ('ISSUED', 'REDEEMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TelegramCallbackState" AS ENUM ('OPEN', 'USED');

-- DropIndex
DROP INDEX "telegram_connection_business_id_state_idx";

-- DropIndex
DROP INDEX "telegram_connection_chat_id_key";

-- AlterTable
ALTER TABLE "telegram_connection" ADD COLUMN     "customer_phone" VARCHAR(32);

-- CreateTable
CREATE TABLE "telegram_connection_token" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "TelegramConnectionKind" NOT NULL,
    "customer_phone" VARCHAR(32),
    "user_id" UUID,
    "code_hash" VARCHAR(64) NOT NULL,
    "state" "TelegramTokenState" NOT NULL DEFAULT 'ISSUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_connection_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_callback" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "state" "TelegramCallbackState" NOT NULL DEFAULT 'OPEN',
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_callback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telegram_connection_token_business_id_kind_state_idx" ON "telegram_connection_token"("business_id", "kind", "state");

-- CreateIndex
CREATE INDEX "telegram_connection_token_code_hash_idx" ON "telegram_connection_token"("code_hash");

-- CreateIndex
CREATE INDEX "telegram_callback_booking_id_idx" ON "telegram_callback"("booking_id");

-- CreateIndex
CREATE INDEX "telegram_callback_connection_id_state_idx" ON "telegram_callback"("connection_id", "state");

-- CreateIndex
CREATE INDEX "telegram_connection_business_id_kind_state_idx" ON "telegram_connection"("business_id", "kind", "state");

-- CreateIndex
CREATE INDEX "telegram_connection_business_id_customer_phone_kind_state_idx" ON "telegram_connection"("business_id", "customer_phone", "kind", "state");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connection_chat_id_business_id_key" ON "telegram_connection"("chat_id", "business_id");

-- AddForeignKey
ALTER TABLE "telegram_connection_token" ADD CONSTRAINT "telegram_connection_token_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_callback" ADD CONSTRAINT "telegram_callback_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_callback" ADD CONSTRAINT "telegram_callback_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "telegram_connection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_callback" ADD CONSTRAINT "telegram_callback_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

