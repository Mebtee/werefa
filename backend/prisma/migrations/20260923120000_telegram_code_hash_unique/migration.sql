-- The redemption path (`TelegramConnectionService.redeem`) looks connection
-- codes up by their SHA-256 digest via `findUnique`. The original index was
-- non-unique, which would have tripped Prisma's runtime assertion; the digest
-- of a CSPRNG-issued code is unique by construction, so the index may be UNIQUE.

-- DropIndex
DROP INDEX "telegram_connection_token_code_hash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connection_token_code_hash_key" ON "telegram_connection_token"("code_hash");