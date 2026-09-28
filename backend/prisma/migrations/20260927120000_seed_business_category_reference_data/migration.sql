-- Business category reference data (spec §12.2 / Prompt 67).
--
-- `business_category` is a lookup table: `business.category_code` is NOT NULL and
-- references `business_category(code)` ON DELETE RESTRICT. No migration had ever
-- inserted the reference rows, so a completely fresh database could not create its
-- first business — the insert failed with a Prisma P2003 foreign-key violation
-- (constraint `business_category_code_fkey`), which surfaced to the owner as an
-- opaque HTTP 500 "Internal server error" on the business setup form.
--
-- These are canonical reference rows, NOT demo data: the codes are exactly the two
-- values the API accepts (`BUSINESS_CATEGORIES` in `src/api/dto/payloads.ts`, which
-- the CreateBusiness/UpdateProfile DTOs validate with `@IsIn`). They are inserted
-- here so provisioning is part of the migration history and therefore reproducible
-- for every fresh environment (dev, test, CI, production) via `npm run prisma:deploy`.
--
-- Properties:
--   * deterministic - explicit VALUES, no clock/random/environment input;
--   * idempotent    - `ON CONFLICT (code) DO NOTHING`, so re-running never creates
--                     duplicates and never fails when the rows already exist;
--   * non-destructive - an existing row keeps its own label; the seed never
--                     overwrites operator- or locale-specific text;
--   * role-safe     - runs as the migrator role, which owns these tables (the
--                     non-privileged app role is never used for DDL/seed work).

INSERT INTO "business_category" ("code", "label")
VALUES
  ('SALON_AND_BARBER', 'Salon & Barber'),
  ('OTHER', 'Other')
ON CONFLICT ("code") DO NOTHING;
