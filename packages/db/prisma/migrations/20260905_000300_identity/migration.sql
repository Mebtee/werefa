-- Werefa Identity — login attempts / lockout, password reset tokens,
-- Super Admin emergency recovery codes, Admin deactivation (REQ-191..206, 217..221).
-- All columns/tables additive; platform-level (non-tenant) — no RLS (doc 14).

-- Account lock state (REQ-193): 5 consecutive failures -> 15-minute lock
-- enforced by is_locked_until; failed_login_count tracks consecutive failures.
ALTER TABLE "user" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;

-- Admin deactivation (REQ-217 'deactivate'). NULL = active.
ALTER TABLE "user" ADD COLUMN "disabled_at" TIMESTAMPTZ(6);

-- Password reset tokens (REQ-033). Only the SHA-256 hash is stored; single
-- active per user enforced at the service layer (REQ-031 analog); one-time use.
CREATE TABLE "password_reset_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- Super Admin emergency recovery codes (REQ-198/199/200). Hashed like reset
-- tokens; separate table keeps the emergency boundary independent of normal
-- password-reset behaviour.
CREATE TABLE "recovery_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "super_admin_user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "recovery_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");
CREATE INDEX "password_reset_token_user_id_idx" ON "password_reset_token"("user_id");
CREATE UNIQUE INDEX "recovery_token_code_hash_key" ON "recovery_token"("code_hash");
CREATE INDEX "recovery_token_super_admin_user_id_idx" ON "recovery_token"("super_admin_user_id");

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recovery_token" ADD CONSTRAINT "recovery_token_super_admin_user_id_fkey"
  FOREIGN KEY ("super_admin_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;