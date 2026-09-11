-- Werefa Owner self-service registration — email verification tokens (Prompt 17,
-- REQ-005/026..032). Whole tokens stored as SHA-256 hashes; single active per
-- user enforced at the service layer; one-time use; 30-minute expiry.
-- Platform-level (non-tenant) like password_reset_token/recovery_token — no RLS
-- (doc 14); the app role receives privileges via migrator default privileges.

CREATE TABLE "email_verification_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "email_verification_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_token_token_hash_key" ON "email_verification_token"("token_hash");
CREATE INDEX "email_verification_token_user_id_idx" ON "email_verification_token"("user_id");

-- AddForeignKey
ALTER TABLE "email_verification_token" ADD CONSTRAINT "email_verification_token_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;