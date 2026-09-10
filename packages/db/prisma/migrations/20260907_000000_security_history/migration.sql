-- Prompt 15 — Security history & platform administration (REQ-201..206).

-- Structured audit metadata (Prompt 15): deleted-event references on
-- SECURITY_EVENT_DELETED deletion audits (REQ-206) and purge counts on
-- SECURITY_EVENT_PURGE retention audits (doc 22 §5). Written only by platform
-- code from DB facts; the history API returns it sanitized via an explicit
-- allow-list. JSONB over a free-text column keeps the content structured and
-- queryable without stringy JSON.
ALTER TABLE "security_event" ADD COLUMN "metadata" JSONB;

-- History/audit query drives (doc 22 §6): (actor, created_at) and
-- (business, created_at) composites; the retention job still scans
-- (created_at) alone. The single-column user_id / business_id indexes are
-- replaced by the composites (leading column preserved).
DROP INDEX "security_event_user_id_idx";
DROP INDEX "security_event_business_id_idx";

CREATE INDEX "security_event_user_created_idx" ON "security_event"("user_id", "created_at");
CREATE INDEX "security_event_business_created_idx" ON "security_event"("business_id", "created_at");