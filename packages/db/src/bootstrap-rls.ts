import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Phase 2 — apply RLS policies (run AFTER migrations have created tables).
 * Must be run as a role that owns the tables (migrator) or a superuser.
 * Requires DATABASE_URL (runtime/app DSN is fine as connection, but the SQL
 * side must have ownership — use DATABASE_URL_SUPERUSER when possible).
 *
 * This script makes the policy block in rls.sql re-runnable by dropping any
 * existing policy names first (idempotent).
 */
const DB_URL = process.env.DATABASE_URL_SUPERUSER ?? process.env.DATABASE_URL;
const RLS_SQL_PATH =
  process.env.RLS_SQL_PATH ??
  join(process.cwd(), 'prisma', 'migrations', '20260905_000000_foundation', 'rls.sql');

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Idempotency: drop known policy names so re-running is safe.
  const drops = `
    DROP POLICY IF EXISTS "business_owner_select" ON "business";
    DROP POLICY IF EXISTS "business_owner_update" ON "business";
    DROP POLICY IF EXISTS "business_owner_create" ON "business";
    DROP POLICY IF EXISTS "business_public_select" ON "business";
    DROP POLICY IF EXISTS "business_superadmin_update" ON "business";
    DROP POLICY IF EXISTS "business_superadmin_all" ON "business";
    DROP POLICY IF EXISTS "owner_membership_select" ON "business_owner";
    DROP POLICY IF EXISTS "owner_membership_insert" ON "business_owner";
    DROP POLICY IF EXISTS "owner_membership_delete" ON "business_owner";
    DROP POLICY IF EXISTS "owner_membership_superadmin_all" ON "business_owner";
    DROP POLICY IF EXISTS "service_owner_select" ON "service";
    DROP POLICY IF EXISTS "service_public_select" ON "service";
    DROP POLICY IF EXISTS "service_owner_insert" ON "service";
    DROP POLICY IF EXISTS "service_owner_update" ON "service";
    DROP POLICY IF EXISTS "service_owner_delete" ON "service";
    DROP POLICY IF EXISTS "service_superadmin_all" ON "service";
    DROP POLICY IF EXISTS "service_variation_owner_select" ON "service_variation";
    DROP POLICY IF EXISTS "service_variation_public_select" ON "service_variation";
    DROP POLICY IF EXISTS "service_variation_owner_insert" ON "service_variation";
    DROP POLICY IF EXISTS "service_variation_owner_update" ON "service_variation";
    DROP POLICY IF EXISTS "service_variation_owner_delete" ON "service_variation";
    DROP POLICY IF EXISTS "service_variation_superadmin_all" ON "service_variation";
    DROP POLICY IF EXISTS "add_on_owner_select" ON "add_on";
    DROP POLICY IF EXISTS "add_on_public_select" ON "add_on";
    DROP POLICY IF EXISTS "add_on_owner_insert" ON "add_on";
    DROP POLICY IF EXISTS "add_on_owner_update" ON "add_on";
    DROP POLICY IF EXISTS "add_on_owner_delete" ON "add_on";
    DROP POLICY IF EXISTS "add_on_superadmin_all" ON "add_on";
    DROP POLICY IF EXISTS "booking_owner_select" ON "booking";
    DROP POLICY IF EXISTS "booking_owner_insert" ON "booking";
    DROP POLICY IF EXISTS "booking_owner_update" ON "booking";
    DROP POLICY IF EXISTS "booking_owner_delete" ON "booking";
    DROP POLICY IF EXISTS "booking_public_insert" ON "booking";
    DROP POLICY IF EXISTS "booking_public_select" ON "booking";
    DROP POLICY IF EXISTS "booking_public_update" ON "booking";
    DROP POLICY IF EXISTS "booking_superadmin_all" ON "booking";
    DROP POLICY IF EXISTS "booking_service_item_owner_select" ON "booking_service_item";
    DROP POLICY IF EXISTS "booking_service_item_owner_insert" ON "booking_service_item";
    DROP POLICY IF EXISTS "booking_service_item_public_insert" ON "booking_service_item";
    DROP POLICY IF EXISTS "booking_service_item_public_select" ON "booking_service_item";
    DROP POLICY IF EXISTS "booking_service_item_superadmin_all" ON "booking_service_item";
    DROP POLICY IF EXISTS "booking_status_history_owner_select" ON "booking_status_history";
    DROP POLICY IF EXISTS "booking_status_history_owner_insert" ON "booking_status_history";
    DROP POLICY IF EXISTS "booking_status_history_public_insert" ON "booking_status_history";
    DROP POLICY IF EXISTS "booking_status_history_public_select" ON "booking_status_history";
    DROP POLICY IF EXISTS "booking_status_history_superadmin_all" ON "booking_status_history";
    DROP POLICY IF EXISTS "payment_owner_select" ON "payment";
    DROP POLICY IF EXISTS "payment_owner_insert" ON "payment";
    DROP POLICY IF EXISTS "payment_owner_update" ON "payment";
    DROP POLICY IF EXISTS "payment_public_insert" ON "payment";
    DROP POLICY IF EXISTS "payment_public_select" ON "payment";
    DROP POLICY IF EXISTS "payment_public_update" ON "payment";
    DROP POLICY IF EXISTS "payment_superadmin_all" ON "payment";
    DROP POLICY IF EXISTS "payment_status_history_owner_select" ON "payment_status_history";
    DROP POLICY IF EXISTS "payment_status_history_owner_insert" ON "payment_status_history";
    DROP POLICY IF EXISTS "payment_status_history_public_insert" ON "payment_status_history";
    DROP POLICY IF EXISTS "payment_status_history_public_select" ON "payment_status_history";
    DROP POLICY IF EXISTS "payment_status_history_superadmin_all" ON "payment_status_history";
    DROP POLICY IF EXISTS "payment_rejection_event_owner_select" ON "payment_rejection_event";
    DROP POLICY IF EXISTS "payment_rejection_event_owner_insert" ON "payment_rejection_event";
    DROP POLICY IF EXISTS "payment_rejection_event_public_insert" ON "payment_rejection_event";
    DROP POLICY IF EXISTS "payment_rejection_event_public_select" ON "payment_rejection_event";
    DROP POLICY IF EXISTS "payment_rejection_event_superadmin_all" ON "payment_rejection_event";
    DROP POLICY IF EXISTS "payment_proof_owner_select" ON "payment_proof";
    DROP POLICY IF EXISTS "payment_proof_owner_insert" ON "payment_proof";
    DROP POLICY IF EXISTS "payment_proof_public_insert" ON "payment_proof";
    DROP POLICY IF EXISTS "payment_proof_public_select" ON "payment_proof";
    DROP POLICY IF EXISTS "payment_proof_superadmin_all" ON "payment_proof";
    DROP POLICY IF EXISTS "slot_lock_owner_select" ON "slot_lock";
    DROP POLICY IF EXISTS "slot_lock_owner_insert" ON "slot_lock";
    DROP POLICY IF EXISTS "slot_lock_owner_update" ON "slot_lock";
    DROP POLICY IF EXISTS "slot_lock_public_insert" ON "slot_lock";
    DROP POLICY IF EXISTS "slot_lock_public_select" ON "slot_lock";
    DROP POLICY IF EXISTS "slot_lock_superadmin_all" ON "slot_lock";
    DROP POLICY IF EXISTS "resubmission_verification_owner_select" ON "resubmission_verification";
    DROP POLICY IF EXISTS "resubmission_verification_owner_insert" ON "resubmission_verification";
    DROP POLICY IF EXISTS "resubmission_verification_public_insert" ON "resubmission_verification";
    DROP POLICY IF EXISTS "resubmission_verification_public_select" ON "resubmission_verification";
    DROP POLICY IF EXISTS "resubmission_verification_public_update" ON "resubmission_verification";
    DROP POLICY IF EXISTS "resubmission_verification_superadmin_all" ON "resubmission_verification";
    DROP POLICY IF EXISTS "notification_owner_select" ON "notification";
    DROP POLICY IF EXISTS "notification_owner_insert" ON "notification";
    DROP POLICY IF EXISTS "notification_owner_update" ON "notification";
    DROP POLICY IF EXISTS "notification_public_insert" ON "notification";
    DROP POLICY IF EXISTS "notification_public_select" ON "notification";
    DROP POLICY IF EXISTS "notification_superadmin_all" ON "notification";
    DROP POLICY IF EXISTS "schedule_version_owner_select" ON "schedule_version";
    DROP POLICY IF EXISTS "schedule_version_owner_insert" ON "schedule_version";
    DROP POLICY IF EXISTS "schedule_version_owner_update" ON "schedule_version";
    DROP POLICY IF EXISTS "schedule_version_owner_delete" ON "schedule_version";
    DROP POLICY IF EXISTS "schedule_version_public_select" ON "schedule_version";
    DROP POLICY IF EXISTS "schedule_version_superadmin_all" ON "schedule_version";
    DROP POLICY IF EXISTS "working_period_owner_select" ON "working_period";
    DROP POLICY IF EXISTS "working_period_owner_insert" ON "working_period";
    DROP POLICY IF EXISTS "working_period_owner_update" ON "working_period";
    DROP POLICY IF EXISTS "working_period_owner_delete" ON "working_period";
    DROP POLICY IF EXISTS "working_period_public_select" ON "working_period";
    DROP POLICY IF EXISTS "working_period_superadmin_all" ON "working_period";
    DROP POLICY IF EXISTS "special_date_owner_select" ON "special_date";
    DROP POLICY IF EXISTS "special_date_owner_insert" ON "special_date";
    DROP POLICY IF EXISTS "special_date_owner_update" ON "special_date";
    DROP POLICY IF EXISTS "special_date_owner_delete" ON "special_date";
    DROP POLICY IF EXISTS "special_date_public_select" ON "special_date";
    DROP POLICY IF EXISTS "special_date_superadmin_all" ON "special_date";
    DROP POLICY IF EXISTS "special_date_period_owner_select" ON "special_date_period";
    DROP POLICY IF EXISTS "special_date_period_owner_insert" ON "special_date_period";
    DROP POLICY IF EXISTS "special_date_period_owner_update" ON "special_date_period";
    DROP POLICY IF EXISTS "special_date_period_owner_delete" ON "special_date_period";
    DROP POLICY IF EXISTS "special_date_period_public_select" ON "special_date_period";
    DROP POLICY IF EXISTS "special_date_period_superadmin_all" ON "special_date_period";
    DROP POLICY IF EXISTS "blocked_period_owner_select" ON "blocked_period";
    DROP POLICY IF EXISTS "blocked_period_owner_insert" ON "blocked_period";
    DROP POLICY IF EXISTS "blocked_period_owner_update" ON "blocked_period";
    DROP POLICY IF EXISTS "blocked_period_owner_delete" ON "blocked_period";
    DROP POLICY IF EXISTS "blocked_period_public_select" ON "blocked_period";
    DROP POLICY IF EXISTS "blocked_period_superadmin_all" ON "blocked_period";
    DROP POLICY IF EXISTS "schedule_conflict_owner_select" ON "schedule_conflict";
    DROP POLICY IF EXISTS "schedule_conflict_owner_insert" ON "schedule_conflict";
    DROP POLICY IF EXISTS "schedule_conflict_owner_update" ON "schedule_conflict";
    DROP POLICY IF EXISTS "schedule_conflict_owner_delete" ON "schedule_conflict";
    DROP POLICY IF EXISTS "schedule_conflict_superadmin_all" ON "schedule_conflict";
    DROP POLICY IF EXISTS "schedule_exception_owner_select" ON "schedule_exception";
    DROP POLICY IF EXISTS "schedule_exception_owner_insert" ON "schedule_exception";
    DROP POLICY IF EXISTS "schedule_exception_owner_update" ON "schedule_exception";
    DROP POLICY IF EXISTS "schedule_exception_owner_delete" ON "schedule_exception";
    DROP POLICY IF EXISTS "schedule_exception_superadmin_all" ON "schedule_exception";
    DROP POLICY IF EXISTS "telegram_connection_owner_select" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_owner_insert" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_owner_update" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_owner_delete" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_public_insert" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_public_select" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_public_update" ON "telegram_connection";
    DROP POLICY IF EXISTS "telegram_connection_superadmin_all" ON "telegram_connection";
    DROP POLICY IF EXISTS "notification_delivery_owner_select" ON "notification_delivery";
    DROP POLICY IF EXISTS "notification_delivery_owner_update" ON "notification_delivery";
    DROP POLICY IF EXISTS "notification_delivery_superadmin_all" ON "notification_delivery";
    DROP POLICY IF EXISTS "notification_delivery_superadmin_insert" ON "notification_delivery";
  `;
  await client.query(drops);

  const rlsSql = readFileSync(RLS_SQL_PATH, 'utf8');
  await client.query(rlsSql);
  await client.end();
  console.log('[rls] RLS policies applied');
}

main().catch((err) => {
  console.error('[rls] bootstrap failed:', err);
  process.exit(1);
});
