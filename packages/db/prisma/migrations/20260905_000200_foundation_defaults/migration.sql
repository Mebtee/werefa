-- Ensure created_at/updated_at have server-side defaults so raw SQL inserts
-- (seeds, maintenance) do not violate NOT NULL. Prisma @updatedAt still updates
-- the column on writes via the client.
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "business" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;