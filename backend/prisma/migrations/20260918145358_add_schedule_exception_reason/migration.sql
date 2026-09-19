-- ===========================================================================
-- Prompt 47: schedule exception reason (REQ-160/161).
--
-- The 'Keep Booking' exception records the owner's free-text reason so the
-- audit trail explains why the conflict was kept. Nullable, cap-shaped after
-- the booking status history reason; no grants needed because the migrator
-- owns the DDL and app-role grants are table-wide, not column-scoped.
-- ===========================================================================

ALTER TABLE "schedule_exception" ADD COLUMN "reason" VARCHAR(2000);