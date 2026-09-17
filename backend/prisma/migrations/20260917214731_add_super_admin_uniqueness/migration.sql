-- ===========================================================================
-- Prompt 43: exactly one Super Admin (REQ-037) — database-level defense-in-depth.
--
-- The platform seeds a single Super Admin; no application path creates another.
-- This partial unique index makes a second SUPER_ADMIN row impossible at the
-- database level on top of the application rule. (Not representable in the
-- Prisma schema language, so it is hand-augmented like the auth CHECKs in the
-- previous migration.)
-- ===========================================================================

CREATE UNIQUE INDEX "user_one_super_admin_idx"
    ON "user" ("role")
    WHERE "role" = 'SUPER_ADMIN';