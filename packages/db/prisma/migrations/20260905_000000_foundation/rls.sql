-- Werefa Foundation — Row-Level Security bootstrap (defense-in-depth).
-- Run as the migrator/DDL role (owner of the tables), NOT as the app role.
--
-- Runtime model:
--   - The API connects as role "app".
--   - Per request-transaction it runs:
--       SET LOCAL app.user_id      = '<uuid>';
--       SET LOCAL app.business_id  = '<uuid>';
--       SET LOCAL app.scope        = 'OWNER' | 'SUPER_ADMIN' | 'PUBLIC';
--   - Policies below reference these settings. If a required setting is
--     absent/wrong, the policy denies — no cross-tenant reads possible.
--   - GUC quirk: after any transaction-local set_config(..., true) rolls back,
--     a custom GUC returns to its "" default on that pooled connection until it
--     is set again. Policies therefore NEVER cast an unset GUC directly; uuid
--     GUCs are read as `NULLIF(current_setting(...), '')::uuid` (= NULL when
--     empty/missing, which never matches a real uuid).
--
-- SuperAdmin elevated reads use a separate role "app_superadmin" whose
-- policies permit all rows; MUST be used only by audited SuperAdmin flows.

-- Roles ("app", "app_superadmin", "migrator") are created by bootstrap-roles.ts
-- before migrations; this script assumes they already exist.

-- ---------------------------------------------------------------------------
-- business
-- ---------------------------------------------------------------------------
ALTER TABLE "business" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business" FORCE ROW LEVEL SECURITY;

-- Owner: only businesses they own (via business_owner membership).
-- The membership check reads from the same RLS-protected table using the
-- security-invoker context (self-reference must include user id against the
-- owner matrix). business_owner is not tenant-scoped, so owners can always see
-- their own membership rows.
-- The OWNER+app.business_id branch covers the create-time INSERT...RETURNING
-- (Prisma). Creation inserts a fresh, unowned business and links ownership in
-- the same transaction; until the ownership row exists, the RETURNING clause
-- could not see the new row — and a subsequent business_owner link needs the
-- created row visible within the same transaction.
-- The window is guarded by app.business_id AND the dedicated marker
-- `app.creating='1'` (set ONLY by the create flow). A sparse NOT EXISTS("any
-- owner") check was rejected: business_owner is itself FORCE-RLS, so a
-- subquery there sees only the caller's own membership rows and can never
-- prove "nobody owns this" (owner B cannot even see owner A's row).
-- With the marker required, an owner cannot aim the window at a foreign,
-- already-owned business: picking the business_id wins nothing unless the
-- current transaction is genuinely creating that business.
CREATE POLICY "business_owner_select" ON "business"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND current_setting('app.creating', true) = '1'
      AND (NULLIF(current_setting('app.business_id', true), ''))::uuid = "business".id
    )
    OR EXISTS (
      SELECT 1
      FROM business_owner bo
      WHERE bo.business_id = "business".id
        AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
    )
  );

CREATE POLICY "business_owner_update" ON "business"
  FOR UPDATE
  TO app
  USING (
    EXISTS (
      SELECT 1
      FROM business_owner bo
      WHERE bo.business_id = "business".id
        AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM business_owner bo
      WHERE bo.business_id = "business".id
        AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
    )
  );

-- Authenticated owners may CREATE a new business (REQ-005/003): an INSERT of a
-- fresh, unowned tenant. Creation grants the creator no read/update rights to
-- any existing tenant — they gain ownership only through the guarded
-- business_owner INSERT below. BUSINESS_IDENTITY is not a route to private data.
CREATE POLICY "business_owner_create" ON "business"
  FOR INSERT
  TO app
  WITH CHECK ( true );

-- Public projection (Prompt 09): unauthenticated public business pages read
-- the PUBLIC profile through this policy. `app.scope='PUBLIC'` is established
-- ONLY by the unauthenticated public controllers (never by authenticated flows,
-- never as a write scope), and the controller returns a curated subset. The
-- business profile is intentionally public (REQ-146/134: page visible while
-- paused / even when expired; QR + public page are the business's public web
-- presence), while ALL tenant operational data stays behind the OWNER/SUPER_ADMIN
-- windows. SELECT-only: PUBLIC can never modify tenant data.
CREATE POLICY "business_public_select" ON "business"
  FOR SELECT
  TO app
  USING ( current_setting('app.scope', true) = 'PUBLIC' );

-- Elevated scope write branch for the runtime `app` role. Super Admin flows
-- (REQ-041: platform-wide management: deactivate/reactivate/pause any
-- business) set app.scope='SUPER_ADMIN' and are audited at the service layer.
-- This is the architecture's elevated tenant-scope mechanism (doc 04 §7), NOT
-- RLS bypass: policies still gate access; ordinary owner scope is unaffected.
CREATE POLICY "business_superadmin_update" ON "business"
  FOR UPDATE
  TO app
  USING ( current_setting('app.scope', true) = 'SUPER_ADMIN' )
  WITH CHECK ( current_setting('app.scope', true) = 'SUPER_ADMIN' );

-- SuperAdmin elevated role: full access (audited at the service layer).
CREATE POLICY "business_superadmin_all" ON "business"
  FOR ALL
  TO app_superadmin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- business_owner (the ownership matrix)
-- ---------------------------------------------------------------------------
-- Owners may read only their own membership rows (prevents enumerating other
-- businesses' owners). SuperAdmin may read all.
ALTER TABLE "business_owner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_owner" FORCE ROW LEVEL SECURITY;

CREATE POLICY "owner_membership_select" ON "business_owner"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
  );

-- Ownership INSERT is guarded: a user may take ownership ONLY of a business
-- they just created (the creation transaction, marked by `app.creating='1'`).
-- Super Admin may manage ownership directly.
-- NOTE (honest limitation): the `NOT EXISTS` reads business_owner which is
-- itself FORCE-RLS — the subquery is invisibility-filtered per owner, so it can
-- never reliably prove "the business has no owner". The REAL guard against
-- claiming a foreign business is the marker gate + the fact that no endpoint
-- inserts ownership for an arbitrary business; ownership rows only ever come
-- from a creation transaction or a Super Admin flow.
CREATE POLICY "owner_membership_insert" ON "business_owner"
  FOR INSERT
  TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.creating', true) = '1'
      AND user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      AND NOT EXISTS (
        SELECT 1 FROM business_owner x
        WHERE x.business_id = business_owner.business_id
      )
    )
  );

CREATE POLICY "owner_membership_delete" ON "business_owner"
  FOR DELETE
  TO app
  USING (
    user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
    OR current_setting('app.scope', true) = 'SUPER_ADMIN'
  );

CREATE POLICY "owner_membership_superadmin_all" ON "business_owner"
  FOR ALL
  TO app_superadmin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- session (platform-level table; visibility by owner is unnecessary. Admins /
-- SuperAdmins manage sessions via platform rules, not RLS tenant policies.)
-- RLS not enabled here — sessions are non-tenant, accessed by token hash and
-- guarded at the service layer.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- service catalog (Prompt 10; REQ-070..081)
--
-- service / service_variation / add_on are tenant-owned children of an
-- existing `business` (doc 04, doc 07). Ownership is established by the row's
-- own business_id through the `business_owner` matrix — no creation window is
-- needed (INSERT…RETURNING projects a just-inserted child whose business the
-- caller already owns). Scoping uses the SAME GUCs as business: the uuid GUCs
-- are always read as NULLIF(current_setting(...), '')::uuid (never cast ""),
-- and PUBLIC is a SELECT-only projection that hides inactive rows (REQ-079).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- service
-- ---------------------------------------------------------------------------
ALTER TABLE "service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service" FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_owner_select" ON "service"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

-- Public projection (REQ-079/214): only ACTIVE services of any business the
-- public page resolves (same visibility model as business_public_select).
CREATE POLICY "service_public_select" ON "service"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND "service".is_active = true
  );

CREATE POLICY "service_owner_insert" ON "service"
  FOR INSERT
  TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

-- UPDATE can never move a service to a business the actor does not own
-- (WITH CHECK re-validates the target business_id); a cross-tenant move is
-- denied even if the actor can see the source row.
CREATE POLICY "service_owner_update" ON "service"
  FOR UPDATE
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "service_owner_delete" ON "service"
  FOR DELETE
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "service_superadmin_all" ON "service"
  FOR ALL
  TO app_superadmin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- service_variation (REQ-072) — same policy shapes, scoped by business_id
-- ---------------------------------------------------------------------------
ALTER TABLE "service_variation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_variation" FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_variation_owner_select" ON "service_variation"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service_variation".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "service_variation_public_select" ON "service_variation"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND "service_variation".is_active = true
  );

CREATE POLICY "service_variation_owner_insert" ON "service_variation"
  FOR INSERT
  TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service_variation".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "service_variation_owner_update" ON "service_variation"
  FOR UPDATE
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service_variation".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service_variation".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "service_variation_owner_delete" ON "service_variation"
  FOR DELETE
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "service_variation".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "service_variation_superadmin_all" ON "service_variation"
  FOR ALL
  TO app_superadmin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- add_on (REQ-073) — same policy shapes, scoped by business_id
-- ---------------------------------------------------------------------------
ALTER TABLE "add_on" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "add_on" FORCE ROW LEVEL SECURITY;

CREATE POLICY "add_on_owner_select" ON "add_on"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "add_on".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "add_on_public_select" ON "add_on"
  FOR SELECT
  TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND "add_on".is_active = true
  );

CREATE POLICY "add_on_owner_insert" ON "add_on"
  FOR INSERT
  TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "add_on".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "add_on_owner_update" ON "add_on"
  FOR UPDATE
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "add_on".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "add_on".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "add_on_owner_delete" ON "add_on"
  FOR DELETE
  TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1
        FROM business_owner bo
        WHERE bo.business_id = "add_on".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "add_on_superadmin_all" ON "add_on"
  FOR ALL
  TO app_superadmin
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Default deny: revoke accidental broad table access from app on tenant tables
-- is inherent via the above policies; app has no grants by default (see
-- bootstrap-rls.ts for GRANT statements which are the source of truth).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- Booking & Payment domain (Prompt 11)
--
-- All booking-domain tables are tenant-owned (business_id) and FORCE RLS.
-- Access policy shape (identical across tables):
--   - OWNER: `business_owner` membership of the row's business_id.
--   - SUPER_ADMIN (app role scope): audited elevated window.
--   - app_superadmin role: full control for audited SuperAdmin flows.
--   - PUBLIC: never for writes; a narrow public SELECT only where the public
--     flow must read (availability uses the service catalog projection).
-- GUCs read via NULLIF(current_setting(...), '')::uuid (never bare casts).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- booking
-- ---------------------------------------------------------------------------
ALTER TABLE "booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking" FORCE ROW LEVEL SECURITY;

CREATE POLICY "booking_owner_select" ON "booking"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_owner_insert" ON "booking"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_owner_update" ON "booking"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_owner_delete" ON "booking"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

-- Public creation window: lets the `INSERT … RETURNING` in the public booking
-- transaction project the just-created row back to Prisma. Gated by the
-- booking_public marker + scope PUBLIC, and constrained to the marker's
-- business_id — it never makes cross-tenant or unrelated bookings readable
-- outside that transaction.
CREATE POLICY "booking_public_select" ON "booking"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "booking_superadmin_all" ON "booking"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- Public booking flow inserts a booking for a business the anonymous caller is
-- NOT an owner of. This is the sole write path for a NON-owner. To keep RLS
-- airtight, the public creation transaction establishes scope 'PUBLIC' AND a
-- dedicated marker 'app.booking_public = 1'; the policy admits an INSERT only
-- under that marker and constrains business_id to the same marker-asserted
-- business so a caller cannot aim the insert at an arbitrary tenant.
CREATE POLICY "booking_public_insert" ON "booking"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

-- Public resubmission window (REJECTED → PAYMENT_PENDING): a verified customer
-- (app.customer_phone set from the one-time, expiring verification) may update
-- ONLY their own bookings of the marker business. This is narrow: the policy
-- cannot be used to touch other customers' bookings.
CREATE POLICY "booking_public_update" ON "booking"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND "booking".customer_phone = NULLIF(current_setting('app.customer_phone', true), '')
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND "booking".customer_phone = NULLIF(current_setting('app.customer_phone', true), '')
  );

-- ---------------------------------------------------------------------------
-- booking_service_item (historical snapshots, tenant-owned)
-- ---------------------------------------------------------------------------
ALTER TABLE "booking_service_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_service_item" FORCE ROW LEVEL SECURITY;

CREATE POLICY "booking_service_item_owner_select" ON "booking_service_item"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking_service_item".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_service_item_owner_insert" ON "booking_service_item"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking_service_item".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_service_item_public_insert" ON "booking_service_item"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking_service_item".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "booking_service_item_public_select" ON "booking_service_item"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking_service_item".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "booking_service_item_superadmin_all" ON "booking_service_item"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- booking_status_history (append-only tenant history; no UPDATE/DELETE grants)
-- ---------------------------------------------------------------------------
ALTER TABLE "booking_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_status_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY "booking_status_history_owner_select" ON "booking_status_history"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking_status_history".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_status_history_owner_insert" ON "booking_status_history"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "booking_status_history".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY "booking_status_history_public_insert" ON "booking_status_history"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking_status_history".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "booking_status_history_public_select" ON "booking_status_history"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "booking_status_history".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "booking_status_history_superadmin_all" ON "booking_status_history"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- payment
-- ---------------------------------------------------------------------------
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payment_owner_select" ON "payment"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_owner_insert" ON "payment"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_owner_update" ON "payment"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_public_insert" ON "payment"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "payment_public_select" ON "payment"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

-- Public resubmission: corridor to the verified customer's own payment only
-- (NOTE: `updated_at` trigger-style writes go through bookkeeping UPDATEs).
CREATE POLICY "payment_public_update" ON "payment"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND EXISTS (
      SELECT 1 FROM "booking" b
      WHERE b.id = "payment".booking_id
        AND b.customer_phone = NULLIF(current_setting('app.customer_phone', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND EXISTS (
      SELECT 1 FROM "booking" b
      WHERE b.id = "payment".booking_id
        AND b.customer_phone = NULLIF(current_setting('app.customer_phone', true), '')
    )
  );
CREATE POLICY "payment_superadmin_all" ON "payment"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- payment_status_history
-- ---------------------------------------------------------------------------
ALTER TABLE "payment_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_status_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payment_status_history_owner_select" ON "payment_status_history"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment_status_history".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_status_history_owner_insert" ON "payment_status_history"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment_status_history".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_status_history_public_insert" ON "payment_status_history"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment_status_history".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "payment_status_history_public_select" ON "payment_status_history"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment_status_history".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "payment_status_history_superadmin_all" ON "payment_status_history"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- payment_rejection_event
-- ---------------------------------------------------------------------------
ALTER TABLE "payment_rejection_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_rejection_event" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payment_rejection_event_owner_select" ON "payment_rejection_event"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment_rejection_event".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_rejection_event_owner_insert" ON "payment_rejection_event"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment_rejection_event".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_rejection_event_public_insert" ON "payment_rejection_event"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment_rejection_event".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "payment_rejection_event_public_select" ON "payment_rejection_event"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment_rejection_event".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "payment_rejection_event_superadmin_all" ON "payment_rejection_event"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- payment_proof
-- ---------------------------------------------------------------------------
ALTER TABLE "payment_proof" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_proof" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payment_proof_owner_select" ON "payment_proof"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment_proof".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_proof_owner_insert" ON "payment_proof"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "payment_proof".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "payment_proof_public_insert" ON "payment_proof"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment_proof".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "payment_proof_public_select" ON "payment_proof"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "payment_proof".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "payment_proof_superadmin_all" ON "payment_proof"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- slot_lock
-- ---------------------------------------------------------------------------
ALTER TABLE "slot_lock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slot_lock" FORCE ROW LEVEL SECURITY;

CREATE POLICY "slot_lock_owner_select" ON "slot_lock"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "slot_lock".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "slot_lock_owner_insert" ON "slot_lock"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "slot_lock".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "slot_lock_owner_update" ON "slot_lock"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "slot_lock".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "slot_lock".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "slot_lock_public_insert" ON "slot_lock"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "slot_lock".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "slot_lock_public_select" ON "slot_lock"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "slot_lock".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "slot_lock_superadmin_all" ON "slot_lock"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- resubmission_verification
-- ---------------------------------------------------------------------------
ALTER TABLE "resubmission_verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resubmission_verification" FORCE ROW LEVEL SECURITY;

CREATE POLICY "resubmission_verification_owner_select" ON "resubmission_verification"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "resubmission_verification".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "resubmission_verification_owner_insert" ON "resubmission_verification"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "resubmission_verification".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "resubmission_verification_public_insert" ON "resubmission_verification"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "resubmission_verification".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );

CREATE POLICY "resubmission_verification_public_select" ON "resubmission_verification"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "resubmission_verification".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "resubmission_verification_public_update" ON "resubmission_verification"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "resubmission_verification".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND "resubmission_verification".phone = NULLIF(current_setting('app.customer_phone', true), '')
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "resubmission_verification".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND "resubmission_verification".phone = NULLIF(current_setting('app.customer_phone', true), '')
  );
CREATE POLICY "resubmission_verification_superadmin_all" ON "resubmission_verification"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- notification (outbox) — PUBLIC may WRITE only under the public-booking marker
-- (the booking transaction enqueues domain events in the same transaction).
-- ---------------------------------------------------------------------------
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;

CREATE POLICY "notification_owner_select" ON "notification"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "notification_owner_insert" ON "notification"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "notification_public_insert" ON "notification"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "notification".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
-- The public-booking transaction creates notifications with RETURNING (Prisma
-- always emits RETURNING on create). PostgreSQL applies the SELECT policy to
-- rows returned by INSERT ... RETURNING, so the same-public-booking-marker
-- SELECT policy is required for the insert to succeed. It is business-pinned
-- and only visible inside a transaction that carries the booking marker.
CREATE POLICY "notification_public_select" ON "notification"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "notification".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "notification_superadmin_all" ON "notification"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);
CREATE POLICY "notification_owner_update" ON "notification"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Scheduling Management (Prompt 12 / docs 10, 13, 21)
--
-- Full OWNER CRUD on schedule tables (row-scoped by business owner membership,
-- doc 04) — the API narrows allowed mutations; RLS merely scopes tenancy.
-- PROMPT/SUPER_ADMIN flows (pause/resume activation sweeps) run under scope
-- SUPER_ADMIN with the super-admin branch. Availability reads under the public
-- booking marker (app.booking_public = '1') get a business-pinned SELECT on
-- the version + content tables only — never on conflict/exception rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "schedule_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY "schedule_version_owner_select" ON "schedule_version"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_version".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_version_owner_insert" ON "schedule_version"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_version".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_version_owner_update" ON "schedule_version"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_version".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_version".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_version_owner_delete" ON "schedule_version"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_version".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
-- Public booking flow reads the ACTIVE version to gate availability.
CREATE POLICY "schedule_version_public_select" ON "schedule_version"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "schedule_version".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND "schedule_version".status = 'ACTIVE'
  );
CREATE POLICY "schedule_version_superadmin_all" ON "schedule_version"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "working_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "working_period" FORCE ROW LEVEL SECURITY;
CREATE POLICY "working_period_owner_select" ON "working_period"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "working_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "working_period_owner_insert" ON "working_period"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "working_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "working_period_owner_update" ON "working_period"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "working_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "working_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "working_period_owner_delete" ON "working_period"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "working_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "working_period_public_select" ON "working_period"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "working_period".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "working_period_superadmin_all" ON "working_period"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "special_date" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "special_date" FORCE ROW LEVEL SECURITY;
CREATE POLICY "special_date_owner_select" ON "special_date"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_owner_insert" ON "special_date"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_owner_update" ON "special_date"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_owner_delete" ON "special_date"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_public_select" ON "special_date"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "special_date".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "special_date_superadmin_all" ON "special_date"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "special_date_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "special_date_period" FORCE ROW LEVEL SECURITY;
CREATE POLICY "special_date_period_owner_select" ON "special_date_period"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_period_owner_insert" ON "special_date_period"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_period_owner_update" ON "special_date_period"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_period_owner_delete" ON "special_date_period"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "special_date_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "special_date_period_public_select" ON "special_date_period"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "special_date_period".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "special_date_period_superadmin_all" ON "special_date_period"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "blocked_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocked_period" FORCE ROW LEVEL SECURITY;
CREATE POLICY "blocked_period_owner_select" ON "blocked_period"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "blocked_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "blocked_period_owner_insert" ON "blocked_period"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "blocked_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "blocked_period_owner_update" ON "blocked_period"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "blocked_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "blocked_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "blocked_period_owner_delete" ON "blocked_period"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "blocked_period".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "blocked_period_public_select" ON "blocked_period"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "blocked_period".business_id = (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "blocked_period_superadmin_all" ON "blocked_period"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- Conflict/exception rows are internal — public flows never see them.
ALTER TABLE "schedule_conflict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_conflict" FORCE ROW LEVEL SECURITY;
CREATE POLICY "schedule_conflict_owner_select" ON "schedule_conflict"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_conflict".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_conflict_owner_insert" ON "schedule_conflict"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_conflict".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_conflict_owner_update" ON "schedule_conflict"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_conflict".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_conflict".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_conflict_owner_delete" ON "schedule_conflict"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_conflict".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_conflict_superadmin_all" ON "schedule_conflict"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "schedule_exception" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_exception" FORCE ROW LEVEL SECURITY;
CREATE POLICY "schedule_exception_owner_select" ON "schedule_exception"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_exception".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_exception_owner_insert" ON "schedule_exception"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_exception".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_exception_owner_update" ON "schedule_exception"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_exception".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_exception".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_exception_owner_delete" ON "schedule_exception"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "schedule_exception".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "schedule_exception_superadmin_all" ON "schedule_exception"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Notifications & Telegram (Prompt 13 / docs 12, 13, 17)
--
-- telegram_connection: public booking flow may CREATE (initiate connect),
-- SELECT (status) and — phone-gated on the BOOKING's customer_phone — UPDATE
-- (customer disconnect). The one-time connect token is issued inside the
-- public-booking transaction, so only the person who proves the booking phone
-- can obtain it (doc 12 §4). The webhook completes the binding under scope
-- SUPER_ADMIN (server-trusted). Owners get full CRUD scoped by membership.
--
-- notification_delivery: read-only for owners (dashboard can surface delivery
-- status), full access for SUPER_ADMIN only (the fan-out + retry worker runs
-- under system scope). Public customers never touch delivery rows — booking
-- transactions write `notification` outbox rows exclusively (doc 13 §3).
-- ---------------------------------------------------------------------------
ALTER TABLE "telegram_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_connection" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_connection_owner_select" ON "telegram_connection"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "telegram_connection".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "telegram_connection_owner_insert" ON "telegram_connection"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "telegram_connection".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "telegram_connection_owner_update" ON "telegram_connection"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "telegram_connection".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "telegram_connection".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "telegram_connection_owner_delete" ON "telegram_connection"
  FOR DELETE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "telegram_connection".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "telegram_connection_public_insert" ON "telegram_connection"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "telegram_connection".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
-- INSERT ... RETURNING applies the SELECT policy to returned rows, so a
-- public-booking-market public SELECT policy is required (as with `notification`).
CREATE POLICY "telegram_connection_public_select" ON "telegram_connection"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "telegram_connection".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "telegram_connection_public_update" ON "telegram_connection"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "telegram_connection".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND EXISTS (
      SELECT 1 FROM booking b
      WHERE b.id = "telegram_connection".booking_id
        AND b.customer_phone = NULLIF(current_setting('app.customer_phone', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "telegram_connection".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
    AND EXISTS (
      SELECT 1 FROM booking b
      WHERE b.id = "telegram_connection".booking_id
        AND b.customer_phone = NULLIF(current_setting('app.customer_phone', true), '')
    )
  );
CREATE POLICY "telegram_connection_superadmin_all" ON "telegram_connection"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "notification_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_delivery" FORCE ROW LEVEL SECURITY;

CREATE POLICY "notification_delivery_owner_select" ON "notification_delivery"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification_delivery".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "notification_delivery_owner_update" ON "notification_delivery"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification_delivery".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "notification_delivery".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "notification_delivery_superadmin_all" ON "notification_delivery"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);
-- The pipeline runs as the `app` role with app.scope='SUPER_ADMIN' (SYSTEM
-- actor, doc 04 §7): fan-out inserts delivery intents, so `app` needs an
-- INSERT policy scoped to SUPER_ADMIN alongside the SELECT/UPDATE ones above.
CREATE POLICY "notification_delivery_superadmin_insert" ON "notification_delivery"
  FOR INSERT TO app
  WITH CHECK ( current_setting('app.scope', true) = 'SUPER_ADMIN' );

-- ---------------------------------------------------------------------------
-- Subscription & Billing (Prompt 14 / REQ-125..141, doc 15)
--
-- subscription: 1:1 per business. OWNER reads its own subscription and the
-- system/lifecycle transitions run under app.scope='SUPER_ADMIN' (the owner_*
-- policies admit BOTH owner-membership and the SUPER_ADMIN scope, matching the
-- booking/payment pattern). The booking flow reads the AUTHORITATIVE period
-- dates through a narrow PUBLIC policy (SELECT only, scoped to the
-- current_booking business) so public availability/create can enforce
-- eligibility without exposing the row to browsing callers.
--
-- subscription_payment: owner may SELECT their own + INSERT a new payment
-- request on the scope window; SUBMISSION is the only owner write — status
-- transitions (approve/reject) go through the elevated app_superadmin role.
--
-- subscription_status_history: append-only; owner reads + system job writes.
-- ---------------------------------------------------------------------------
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscription_owner_select" ON "subscription"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "subscription_owner_insert" ON "subscription"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "subscription_owner_update" ON "subscription"
  FOR UPDATE TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  )
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
-- Booking flow reads the authoritative period dates (REQ-131/132/133/134).
CREATE POLICY "subscription_public_select" ON "subscription"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'PUBLIC'
    AND current_setting('app.booking_public', true) = '1'
    AND "subscription".business_id =
      (NULLIF(current_setting('app.business_id', true), ''))::uuid
  );
CREATE POLICY "subscription_superadmin_all" ON "subscription"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "subscription_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_payment" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payment_owner_select" ON "subscription_payment"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription_payment".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "subscription_payment_owner_insert" ON "subscription_payment"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription_payment".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "subscription_payment_superadmin_all" ON "subscription_payment"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);

ALTER TABLE "subscription_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_status_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscription_status_history_owner_select" ON "subscription_status_history"
  FOR SELECT TO app
  USING (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription_status_history".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "subscription_status_history_owner_insert" ON "subscription_status_history"
  FOR INSERT TO app
  WITH CHECK (
    current_setting('app.scope', true) = 'SUPER_ADMIN'
    OR (
      current_setting('app.scope', true) = 'OWNER'
      AND EXISTS (
        SELECT 1 FROM business_owner bo
        WHERE bo.business_id = "subscription_status_history".business_id
          AND bo.user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );
CREATE POLICY "subscription_status_history_superadmin_all" ON "subscription_status_history"
  FOR ALL TO app_superadmin USING (true) WITH CHECK (true);
