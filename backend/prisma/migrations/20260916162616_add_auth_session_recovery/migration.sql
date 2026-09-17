-- AlterTable
ALTER TABLE "user" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_deactivated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_login_at" TIMESTAMPTZ(6),
ADD COLUMN     "password_changed_at" TIMESTAMPTZ(6),
ADD COLUMN     "recovery_email" VARCHAR(320);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "ip" VARCHAR(64),
    "device" VARCHAR(200),
    "browser" VARCHAR(200),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_recovery" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_expires_at_idx" ON "session"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "session_user_id_revoked_at_idx" ON "session"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "emergency_recovery_user_id_used_at_idx" ON "emergency_recovery"("user_id", "used_at");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_recovery" ADD CONSTRAINT "emergency_recovery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-augmented guarantees (Prompt 43; architecture doc 07 §1/§4):
--  1. Session expiry / lockout sanity are DB-enforced with CHECK constraints.
--  2. 'app' role DML grants for the new auth tables (migrator owns DDL).
-- ===========================================================================

-- Session tokens are 64-char hex sha-256 digests of opaque tokens.
ALTER TABLE "session" ADD CONSTRAINT "session_token_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- Recovery codes are 64-char hex sha-256 digests of 6-digit numeric codes.
ALTER TABLE "emergency_recovery" ADD CONSTRAINT "emergency_recovery_code_hash_hex" CHECK ("code_hash" ~ '^[0-9a-f]{64}$');

-- Attempt counters are never negative.
ALTER TABLE "emergency_recovery" ADD CONSTRAINT "emergency_recovery_attempts_nonnegative" CHECK ("attempts" >= 0);

-- Session expiry is strictly after creation.
ALTER TABLE "session" ADD CONSTRAINT "session_expires_after_created" CHECK ("expires_at" > "created_at");

-- Runtime 'app' role: DML on the new auth tables (default privileges extended
-- to future tables by the init migration's ALTER DEFAULT PRIVILEGES).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "session" TO "werefa_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "emergency_recovery" TO "werefa_app";
