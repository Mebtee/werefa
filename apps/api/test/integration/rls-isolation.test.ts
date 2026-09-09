/**
 * Integration tests A, B, D (SQL layer):
 *
 *  A) A tenant cannot access another tenant's rows.
 *  B) An owner cannot access rows of businesses they do not own.
 *  D) RLS is actually enforced — the `app` role sees NOTHING without a tenant
 *     context (GUCs) even though tables exist.
 *
 * Runs against `werefa_test` (see `npm run db:test:setup`). Uses raw pg as the
 * runtime `app` role exactly like the API would.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function rootEnv(): NodeJS.ProcessEnv {
  let envRaw = '';
  try {
    envRaw = readFileSync(join(process.cwd(), '..', '..', '.env'), 'utf8');
  } catch {
    envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8');
  }
  const env: NodeJS.ProcessEnv = {};
  for (const line of envRaw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

const FILE_ENV = rootEnv();
const TEST_DB = process.env.TEST_DB_NAME ?? 'werefa_test';

function withDb(dsn: string | undefined, db: string): string | undefined {
  if (!dsn) return undefined;
  const u = new URL(dsn);
  u.pathname = '/' + db;
  return u.toString();
}

const APP_URL = withDb(process.env.DATABASE_URL ?? FILE_ENV.DATABASE_URL, TEST_DB)!;
const SUPER_URL = withDb(
  process.env.DATABASE_URL_SUPERUSER ?? FILE_ENV.DATABASE_URL_SUPERUSER,
  TEST_DB,
)!;

function uuid(): string {
  return crypto.randomUUID();
}

beforeAll(async () => {
  const setup = new Client({ connectionString: SUPER_URL });
  await setup.connect();
  // Ensure the alphabetic role for base URLs was refreshed by test-setup;
  // create deterministic owners + two businesses owned separately.
  await setup.query(`TRUNCATE business_owner, business, "user" CASCADE`);
  await setup.query(
    `INSERT INTO "user"(email, password_hash, role) VALUES
       ('it-owner-a', 'x', 'Owner'), ('it-owner-b', 'x', 'Owner') ON CONFLICT DO NOTHING`,
  );
  const [uidA, uidB] = (
    await setup.query(
      `SELECT id, email FROM "user" WHERE email IN ('it-owner-a','it-owner-b') ORDER BY email`,
    )
  ).rows.map((r) => r.id);
  const bizA = uuid();
  const bizB = uuid();
  await setup.query(
    `INSERT INTO business(id, public_slug, name) VALUES ($1,'isl-a','I A'),($2,'isl-b','I B')`,
    [bizA, bizB],
  );
  await setup.query(`INSERT INTO business_owner(business_id, user_id) VALUES ($1,$2),($3,$4)`, [
    bizA,
    uidA,
    bizB,
    uidB,
  ]);
  // Service-catalog fixtures (Prompt 10): active + inactive children under A,
  // an active service under B, hidden variation/add-on under A.
  const svcA1 = uuid();
  const svcA2 = uuid();
  const svcB1 = uuid();
  await setup.query(
    `INSERT INTO service(id, business_id, name, base_price_minor, base_duration_minutes, is_active)
       VALUES ($1,$2,'Haircut',4500,45,true),($3,$2,'Senior cut',4000,30,false),($4,$5,'Trim',2000,20,true)`,
    [svcA1, bizA, svcA2, svcB1, bizB],
  );
  const varVisible = uuid();
  const varHidden = uuid();
  const varB = uuid();
  await setup.query(
    `INSERT INTO service_variation(id, service_id, business_id, name, price_delta_minor, duration_delta_minutes, is_active)
       VALUES ($1,$2,$3,'Kids +',0,5,true),($4,$2,$3,'Kids skip',-1000,0,false),($5,$6,$7,'B only',0,0,true)`,
    [varVisible, svcA1, bizA, varHidden, varB, svcB1, bizB],
  );
  const addonVisible = uuid();
  const addonHidden = uuid();
  const addonB = uuid();
  await setup.query(
    `INSERT INTO add_on(id, service_id, business_id, name, price_delta_minor, duration_delta_minutes, is_active)
       VALUES ($1,$2,$3,'Polish',1500,15,true),($4,$2,$3,'Retired',1500,15,false),($5,$6,$7,'B towel',500,5,true)`,
    [addonVisible, svcA1, bizA, addonHidden, addonB, svcB1, bizB],
  );
  await setup.end();
  // stash ids keyed by slug for later asserts
  (globalThis as Record<string, unknown>).__isl_biz = {
    a: bizA,
    b: bizB,
    userA: uidA,
    userB: uidB,
    svcA1,
    svcA2,
    svcB1,
    varVisible,
    varHidden,
    varB,
    addonVisible,
    addonHidden,
    addonB,
  };
});

afterAll(async () => {});

describe('RLS isolation on tenant tables (tests A, B, D)', () => {
  it('D: `app` role sees no rows without a tenant context', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    const res = await client.query('SELECT count(*)::int AS c FROM business');
    const owners = await client.query('SELECT count(*)::int AS c FROM business_owner');
    await client.end();
    expect(res.rows[0].c).toBe(0);
    expect(owners.rows[0].c).toBe(0);
  });

  it('A: tenant A sees only its own business; never tenant B’s', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userA: string;
      userB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${ctx.userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);

    const visible = await client.query('SELECT public_slug FROM business ORDER BY public_slug');
    expect(visible.rows.map((r) => r.public_slug)).toEqual(['isl-a']);

    const foreign = await client.query('SELECT count(*)::int AS c FROM business WHERE id = $1', [
      ctx.b,
    ]);
    expect(foreign.rows[0].c).toBe(0);
    await client.end();
  });

  it('B: owner B cannot read/force into owner A businesses', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userA: string;
      userB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${ctx.userB}'`);
    await client.query(`SET app.scope = 'OWNER'`);
    await client.query(`SET app.business_id = '${ctx.a}'`); // spoof tenant A

    const visible = await client.query('SELECT public_slug FROM business ORDER BY public_slug');
    expect(visible.rows.map((r) => r.public_slug)).toEqual(['isl-b']);
    await client.end();
  });
});

describe('RLS isolation on the service catalog (Prompt 10, tests A/B/D)', () => {
  it('D: `app` role sees no catalog rows without a tenant context', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    const services = await client.query('SELECT count(*)::int AS c FROM service');
    const variations = await client.query('SELECT count(*)::int AS c FROM service_variation');
    const addons = await client.query('SELECT count(*)::int AS c FROM add_on');
    await client.end();
    expect(services.rows[0].c).toBe(0);
    expect(variations.rows[0].c).toBe(0);
    expect(addons.rows[0].c).toBe(0);
  });

  it('A: owner A sees only its own services, variations and add-ons', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      userA: string;
      svcA1: string;
      svcA2: string;
      svcB1: string;
      varB: string;
      addonB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${ctx.userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);

    const services = await client.query('SELECT id FROM service ORDER BY base_duration_minutes');
    expect(services.rows.map((r) => r.id).sort()).toEqual([ctx.svcA1, ctx.svcA2].sort());
    expect(services.rows.map((r) => r.id)).not.toContain(ctx.svcB1);

    // Tenant B's children of tenant B's service are invisible even by id.
    const [varRead, addonRead] = await Promise.all([
      client.query('SELECT name FROM service_variation WHERE id = $1', [ctx.varB]),
      client.query('SELECT name FROM add_on WHERE id = $1', [ctx.addonB]),
    ]);
    await client.end();
    expect(varRead.rows).toEqual([]);
    expect(addonRead.rows).toEqual([]);
  });

  it('B: owner B cannot read, spoof, update, delete or insert into owner A services', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userB: string;
      svcA1: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${ctx.userB}'`);
    await client.query(`SET app.scope = 'OWNER'`);

    // Read: shielded even though the row exists.
    const read = await client.query('SELECT name FROM service WHERE id = $1', [ctx.svcA1]);
    expect(read.rows).toEqual([]);

    // Update / delete: filtered (0 rows affected).
    const upd = await client.query("UPDATE service SET name = 'hacked' WHERE id = $1", [ctx.svcA1]);
    expect(upd.rowCount).toBe(0);
    const del = await client.query('DELETE FROM service WHERE id = $1', [ctx.svcA1]);
    expect(del.rowCount).toBe(0);

    // Insert into a business A owns: the WITH CHECK policy denies the row outright.
    let insertErr = '';
    try {
      await client.query(
        `INSERT INTO service(id, business_id, name, base_price_minor, base_duration_minutes)
         VALUES (gen_random_uuid(), $1, 'Sneak', 1000, 20)`,
        [ctx.a],
      );
    } catch (err) {
      insertErr = String((err as { message: string }).message);
    }
    expect(insertErr.toLowerCase()).toContain('row-level security');

    await client.end();
  });

  it('PUBLIC projection: active services only, read-only', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      b: string;
      svcA1: string;
      svcA2: string;
      svcB1: string;
      varVisible: string;
      varHidden: string;
      varB: string;
      addonVisible: string;
      addonHidden: string;
      addonB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'PUBLIC'`);

    // Active services of ANY business are visible to the public projection; the
    // inactive service (senior cut) is filtered out.
    const services = await client.query('SELECT id FROM service ORDER BY id');
    expect(services.rows.map((r) => r.id).sort()).toEqual([ctx.svcA1, ctx.svcB1].sort());
    expect(services.rows.map((r) => r.id)).not.toContain(ctx.svcA2);

    // Children: active rows projected across businesses; inactive ones hidden.
    const variations = await client.query('SELECT id FROM service_variation ORDER BY id');
    expect(variations.rows.map((r) => r.id).sort()).toEqual([ctx.varVisible, ctx.varB].sort());
    expect(variations.rows.map((r) => r.id)).not.toContain(ctx.varHidden);
    const addons = await client.query('SELECT id FROM add_on ORDER BY id');
    expect(addons.rows.map((r) => r.id).sort()).toEqual([ctx.addonVisible, ctx.addonB].sort());
    expect(addons.rows.map((r) => r.id)).not.toContain(ctx.addonHidden);

    // PUBLIC is SELECT-only: an insert attempt is denied by missing policy.
    let insertErr = '';
    try {
      await client.query(
        `INSERT INTO add_on(id, service_id, business_id, name, price_delta_minor, duration_delta_minutes)
         VALUES (gen_random_uuid(), $1, $2, 'Forced', 100, 5)`,
        [ctx.svcA1, ctx.b],
      );
    } catch (err) {
      insertErr = String((err as { message: string }).message);
    }
    expect(insertErr.toLowerCase()).toContain('row-level security');
    await client.end();
  });

  it('B: owner A cannot update, delete or insert owner B service_variation/add_on rows (X/Y, AE/AF/AD children)', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userA: string;
      svcB1: string;
      varB: string;
      addonB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${ctx.userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);
    await client.query(`SET app.business_id = '${ctx.a}'`); // spoof tenant A

    // UPDATE / DELETE on tenant B's variation + add-on → 0 rows affected (AE/AF).
    const [varUpd, varDel] = await Promise.all([
      client.query("UPDATE service_variation SET name = 'hacked' WHERE id = $1", [ctx.varB]),
      client.query('DELETE FROM service_variation WHERE id = $1', [ctx.varB]),
    ]);
    expect(varUpd.rowCount).toBe(0);
    expect(varDel.rowCount).toBe(0);
    const [addonUpd, addonDel] = await Promise.all([
      client.query("UPDATE add_on SET name = 'hacked' WHERE id = $1", [ctx.addonB]),
      client.query('DELETE FROM add_on WHERE id = $1', [ctx.addonB]),
    ]);
    expect(addonUpd.rowCount).toBe(0);
    expect(addonDel.rowCount).toBe(0);

    // INSERT a child into tenant B's service → the WITH CHECK policy denies (AD).
    for (const [table, cols] of [
      [
        'service_variation',
        'service_id, business_id, name, price_delta_minor, duration_delta_minutes',
      ],
      ['add_on', 'service_id, business_id, name, price_delta_minor, duration_delta_minutes'],
    ] as const) {
      let err = '';
      try {
        await client.query(
          `INSERT INTO ${table}(id, ${cols})
           VALUES (gen_random_uuid(), $1, $2, 'Sneak child', 100, 5)`,
          [ctx.svcB1, ctx.b],
        );
      } catch (e) {
        err = String((e as { message: string }).message);
      }
      expect({ table, err }).toEqual(
        expect.objectContaining({ table, err: expect.stringContaining('row-level security') }),
      );
    }

    await client.end();
  });

  it('elevated SUPER_ADMIN scope sees the full catalog (audited at the service layer)', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_biz as {
      svcA1: string;
      svcA2: string;
      svcB1: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'SUPER_ADMIN'`);
    const services = await client.query('SELECT id FROM service ORDER BY id');
    expect(services.rows.map((r) => r.id).sort()).toEqual([ctx.svcA1, ctx.svcA2, ctx.svcB1].sort());
    await client.end();
  });
});

let __bookingFixtureReady = false;
describe('RLS isolation on booking-domain tables (Prompt 11, tests A/B/D)', () => {
  beforeAll(async () => {
    if (__bookingFixtureReady) return;
    __bookingFixtureReady = true;
    const setup = new Client({ connectionString: SUPER_URL });
    await setup.connect();

    const biz = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userA: string;
      userB: string;
      svcA1: string;
      svcB1: string;
    };

    // Booking under A: PAYMENT_PENDING, with proof, lock and notification.
    const bA1 = uuid();
    const payA1 = uuid();
    const proofA1 = uuid();
    const lockA1 = uuid();
    await setup.query(
      `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date, status)
       VALUES ($1,$2,'Almaz','+251911111111',date_trunc('minute', now() + interval '3 days'), date_trunc('minute', now() + interval '3 days' + interval '45 minutes'), (now() + interval '3 days')::date, 'PAYMENT_PENDING')`,
      [bA1, biz.a],
    );
    await setup.query(
      `INSERT INTO booking_service_item(id, booking_id, business_id, service_id, name_snapshot, unit_price_minor, duration_minutes)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Haircut', 4500, 45)`,
      [bA1, biz.a, biz.svcA1],
    );
    await setup.query(
      `INSERT INTO booking_status_history(id, booking_id, business_id, from_status, to_status, actor_type)
       VALUES (gen_random_uuid(), $1, $2, 'PAYMENT_PENDING', 'PAYMENT_PENDING', 'SYSTEM')`,
      [bA1, biz.a],
    );
    await setup.query(
      `INSERT INTO payment(id, business_id, booking_id, method, status)
       VALUES ($1,$2,$3,'BANK_TRANSFER','PENDING')`,
      [payA1, biz.a, bA1],
    );
    await setup.query(
      `INSERT INTO payment_status_history(id, payment_id, business_id, from_status, to_status, actor_type)
       VALUES (gen_random_uuid(), $1, $2, 'PENDING', 'PENDING', 'SYSTEM')`,
      [payA1, biz.a],
    );
    await setup.query(
      `INSERT INTO payment_proof(id, payment_id, business_id, storage_key, mime, size_bytes, submission_key)
       VALUES ($1,$2,$3,'proof-a-1','image/png',2048,'submission-a-1')`,
      [proofA1, payA1, biz.a],
    );
    await setup.query(
      `INSERT INTO slot_lock(id, business_id, booking_id, slot_date, start_at, end_at, status)
       VALUES ($1,$2,$3,(now() + interval '3 days')::date, date_trunc('minute', now() + interval '3 days'), date_trunc('minute', now() + interval '3 days' + interval '45 minutes'), 'LOCKED')`,
      [lockA1, biz.a, bA1],
    );
    await setup.query(
      `INSERT INTO notification(id, business_id, booking_id, type, tenant_scope, payload)
       VALUES (gen_random_uuid(), $1, $2, 'BOOKING_PROOF_RECEIVED', 'BOOKING', '{"proofId":"x"}'::jsonb)`,
      [biz.a, bA1],
    );

    // Second booking under A (for resubmission phone scoping): different phone.
    const bA2 = uuid();
    const lockA2 = uuid();
    await setup.query(
      `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date, status)
       VALUES ($1,$2,'Bontu','+251922222222',date_trunc('minute', now() + interval '4 days'), date_trunc('minute', now() + interval '4 days' + interval '60 minutes'), (now() + interval '4 days')::date, 'CONFIRMED')`,
      [bA2, biz.a],
    );
    await setup.query(
      `INSERT INTO slot_lock(id, business_id, booking_id, slot_date, start_at, end_at, status)
       VALUES ($1,$2,$3,(now() + interval '4 days')::date, date_trunc('minute', now() + interval '4 days'), date_trunc('minute', now() + interval '4 days' + interval '60 minutes'), 'ALLOCATED')`,
      [lockA2, biz.a, bA2],
    );
    await setup.query(
      `INSERT INTO payment(id, business_id, booking_id, method, status)
       VALUES (gen_random_uuid(), $1, $2, 'TELEBIRR_MOBILE_MONEY', 'PENDING')`,
      [biz.a, bA2],
    );

    // Reconciliation verification under A (expires in the future).
    await setup.query(
      `INSERT INTO resubmission_verification(id, booking_id, business_id, phone, code_hash, expires_at)
       VALUES (gen_random_uuid(), $1, $2, '+251911111111', $3, now() + interval '15 minutes')`,
      [bA1, biz.a, 'x'.repeat(64)],
    );

    // Cross-tenant booking under B, plus a second verification on B.
    const bB = uuid();
    const payB = uuid();
    const proofB = uuid();
    await setup.query(
      `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date, status)
       VALUES ($1,$2,'Chaltu','+251933333333',date_trunc('minute', now() + interval '5 days'), date_trunc('minute', now() + interval '5 days' + interval '30 minutes'), (now() + interval '5 days')::date, 'PAYMENT_PENDING')`,
      [bB, biz.b],
    );
    await setup.query(
      `INSERT INTO booking_service_item(id, booking_id, business_id, service_id, name_snapshot, unit_price_minor, duration_minutes)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Trim', 2000, 20)`,
      [bB, biz.b, biz.svcB1],
    );
    await setup.query(
      `INSERT INTO payment(id, business_id, booking_id, method, status)
       VALUES ($1,$2,$3,'BANK_TRANSFER','PENDING')`,
      [payB, biz.b, bB],
    );
    await setup.query(
      `INSERT INTO payment_proof(id, payment_id, business_id, storage_key, mime, size_bytes, submission_key)
       VALUES ($1,$2,$3,'proof-b-1','application/pdf',4096,'submission-b-1')`,
      [proofB, payB, biz.b],
    );
    await setup.query(
      `INSERT INTO slot_lock(id, business_id, booking_id, slot_date, start_at, end_at, status)
       VALUES (gen_random_uuid(), $1, $2, (now() + interval '5 days')::date, date_trunc('minute', now() + interval '5 days'), date_trunc('minute', now() + interval '5 days' + interval '30 minutes'), 'LOCKED')`,
      [biz.b, bB],
    );
    await setup.query(
      `INSERT INTO notification(id, business_id, booking_id, type, tenant_scope)
       VALUES (gen_random_uuid(), $1, $2, 'BOOKING_PROOF_RECEIVED', 'BOOKING')`,
      [biz.b, bB],
    );
    await setup.query(
      `INSERT INTO resubmission_verification(id, booking_id, business_id, phone, code_hash, expires_at)
       VALUES (gen_random_uuid(), $1, $2, '+251933333333', $3, now() + interval '15 minutes')`,
      [bB, biz.b, 'y'.repeat(64)],
    );

    await setup.end();
    (globalThis as Record<string, unknown>).__isl_booking = {
      bA1,
      bA2,
      payA1,
      proofA1,
      lockA1,
      bB,
      payB,
      proofB,
    };
  });

  it('D: `app` role sees no booking-domain rows without a tenant context', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    for (const table of [
      'booking',
      'booking_service_item',
      'booking_status_history',
      'payment',
      'payment_status_history',
      'payment_proof',
      'slot_lock',
      'resubmission_verification',
      'notification',
    ]) {
      const res = await client.query(`SELECT count(*)::int AS c FROM ${table}`);
      expect(res.rows[0].c, table).toBe(0);
    }
    await client.end();
  });

  it('A: owner A sees only its own bookings, payments, locks, proofs and history', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_booking as {
      bA1: string;
      bA2: string;
      bB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(
      `SET app.user_id = '${(globalThis as Record<string, unknown>).__isl_biz['userA']}'`,
    );
    await client.query(`SET app.scope = 'OWNER'`);

    const bookings = await client.query('SELECT id FROM booking ORDER BY id');
    expect(bookings.rows.map((r) => r.id).sort()).toEqual([ctx.bA1, ctx.bA2].sort());
    expect(bookings.rows.map((r) => r.id)).not.toContain(ctx.bB);

    const payments = await client.query('SELECT booking_id FROM payment ORDER BY booking_id');
    expect(payments.rows.map((r) => r.booking_id).sort()).toEqual([ctx.bA1, ctx.bA2].sort());

    // Tenant B rows are invisible even by exact id (booked, proof, lock, etc.).
    const [foreignBooking, foreignProof, foreignLock] = await Promise.all([
      client.query('SELECT id FROM booking WHERE id = $1', [ctx.bB]),
      client.query('SELECT id FROM payment_proof WHERE submission_key = $1', ['submission-b-1']),
      client.query(`SELECT id FROM slot_lock WHERE booking_id = $1`, [ctx.bB]),
    ]);
    await client.end();
    expect(foreignBooking.rows).toEqual([]);
    expect(foreignProof.rows).toEqual([]);
    expect(foreignLock.rows).toEqual([]);
  });

  it('B: owner B cannot read, spoof, mutate or insert into any owner A booking-domain row', async () => {
    const biz = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userB: string;
    };
    const ctx = (globalThis as Record<string, unknown>).__isl_booking as {
      bA1: string;
      payA1: string;
      proofA1: string;
      lockA1: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${biz.userB}'`);
    await client.query(`SET app.scope = 'OWNER'`);

    // Spoofed tenant context does not grant access (policy checks ownership).
    await client.query(`SET app.business_id = '${biz.a}'`);

    // Reads: shielded.
    const read = await client.query('SELECT id FROM booking WHERE id = $1', [ctx.bA1]);
    expect(read.rows).toEqual([]);

    // Updates / deletes: filtered (0 rows affected) across every table.
    const [updBooking, updLock, updPayment, updProof, delHistory] = await Promise.all([
      client.query(`UPDATE booking SET customer_name = 'hacked' WHERE id = $1`, [ctx.bA1]),
      client.query(`UPDATE slot_lock SET status = 'RELEASED' WHERE id = $1`, [ctx.lockA1]),
      client.query(`UPDATE payment SET status = 'ACCEPTED' WHERE id = $1`, [ctx.payA1]),
      client.query(`UPDATE payment_proof SET mime = 'text/html' WHERE id = $1`, [ctx.proofA1]),
      client.query(`DELETE FROM booking_status_history WHERE booking_id = $1`, [ctx.bA1]),
    ]);
    expect(updBooking.rowCount).toBe(0);
    expect(updLock.rowCount).toBe(0);
    expect(updPayment.rowCount).toBe(0);
    expect(updProof.rowCount).toBe(0);
    expect(delHistory.rowCount).toBe(0);

    // Writes into A's business are denied by WITH CHECK even with spoofed GUCs.
    const attempts: Array<Promise<string>> = [
      client.query(
        `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date, status)
         VALUES (gen_random_uuid(), $1, 'Sneak', '+251900000000', date_trunc('minute', now()), date_trunc('minute', now()), now()::date, 'PAYMENT_PENDING')`,
        [biz.a],
      ),
      client.query(
        `INSERT INTO payment(id, business_id, booking_id, method) VALUES (gen_random_uuid(), $1, $2, 'BANK_TRANSFER')`,
        [biz.a, ctx.bA1],
      ),
      client.query(
        `INSERT INTO slot_lock(id, business_id, booking_id, slot_date, start_at, end_at)
         VALUES (gen_random_uuid(), $1, NULL, now()::date, now(), now() + interval '30 minutes')`,
        [biz.a],
      ),
      client.query(
        `INSERT INTO notification(id, business_id, booking_id, type) VALUES (gen_random_uuid(), $1, $2, 'BOOKING_CANCELLED')`,
        [biz.a, ctx.bA1],
      ),
    ].map((p) =>
      p.then(
        () => '',
        (e: unknown) => String((e as { message: string }).message),
      ),
    );
    const errs = await Promise.all(attempts);
    for (const err of errs) {
      expect(err.toLowerCase()).toContain('row-level security');
    }
    await client.end();
  });

  it('public booking window can only write to the marker business (booking_public marker)', async () => {
    const biz = (globalThis as Record<string, unknown>).__isl_biz as { a: string; b: string };
    const ctx = (globalThis as Record<string, unknown>).__isl_booking as {
      bA1: string;
      bB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'PUBLIC'`);
    await client.query(`SET app.booking_public = '1'`);
    await client.query(`SET app.business_id = '${biz.a}'`);

    // Can read the marker business's own booking rows (Prisma needs RETURNING).
    const read = await client.query('SELECT id FROM booking WHERE id = $1', [ctx.bA1]);
    expect(read.rows.map((r) => r.id)).toEqual([ctx.bA1]);

    // Cannot read or write another tenant's rows through the same window.
    const foreignRead = await client.query('SELECT id FROM booking WHERE id = $1', [ctx.bB]);
    expect(foreignRead.rows).toEqual([]);
    let err = '';
    try {
      await client.query(
        `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date, status)
         VALUES (gen_random_uuid(), $1, 'Sneak', '+251944444444', date_trunc('minute', now()), date_trunc('minute', now()), now()::date, 'PAYMENT_PENDING')`,
        [biz.b],
      );
    } catch (e) {
      err = String((e as { message: string }).message);
    }
    expect(err.toLowerCase()).toContain('row-level security');
    await client.end();
  });

  it('resubmission corridor is scoped to the verified phone (customer_phone marker)', async () => {
    const biz = (globalThis as Record<string, unknown>).__isl_biz as { a: string; b: string };
    const ctx = (globalThis as Record<string, unknown>).__isl_booking as {
      bA1: string;
      bA2: string;
      proofA1: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'PUBLIC'`);
    await client.query(`SET app.booking_public = '1'`);
    await client.query(`SET app.business_id = '${biz.a}'`);
    await client.query(`SET app.customer_phone = '+251911111111'`);

    // Own booking (matching phone) updated; a different customer's booking is
    // not even visible to modify.
    const own = await client.query(
      `UPDATE booking SET note = 'resubmitted' WHERE id = $1 RETURNING id`,
      [ctx.bA1],
    );
    expect(own.rows.map((r) => r.id)).toEqual([ctx.bA1]);
    const other = await client.query(`UPDATE booking SET note = 'no' WHERE id = $1 RETURNING id`, [
      ctx.bA2,
    ]);
    expect(other.rows).toEqual([]);

    // Verification rows scoped to the same phone.
    const touchVerification = await client.query(
      `UPDATE resubmission_verification SET used_at = now() WHERE phone = '+251911111111' RETURNING id`,
    );
    expect(touchVerification.rows).toHaveLength(1);

    // Tenant B's rows are shielded even when we spoof their business.
    await client.query(`SET app.business_id = '${biz.b}'`);
    const foreignProof = await client.query(
      `UPDATE payment_proof SET mime = 'application/pdf' WHERE id = $1 RETURNING id`,
      [ctx.proofA1],
    );
    expect(foreignProof.rows).toEqual([]);
    await client.end();
  });

  it('elevated SUPER_ADMIN scope sees the booking domain across tenants', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_booking as {
      bA1: string;
      bB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'SUPER_ADMIN'`);
    const bookings = await client.query('SELECT id FROM booking ORDER BY id');
    expect(bookings.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ctx.bA1, ctx.bB]));
    await client.end();
  });
});

let __scheduleFixtureReady = false;
describe('RLS isolation on schedule tables (Prompt 12, tests A/B/D)', () => {
  beforeAll(async () => {
    if (__scheduleFixtureReady) return;
    __scheduleFixtureReady = true;
    const setup = new Client({ connectionString: SUPER_URL });
    await setup.connect();

    const biz = (globalThis as Record<string, unknown>).__isl_biz as { a: string; b: string };

    // Tenant A: one ACTIVE version (with weekly + special + blocked children) and
    // one PENDING, plus a CONFIRMED booking carrying a conflict + exception so
    // every schedule table is covered. Tenant B: its own ACTIVE version.
    const svA = uuid();
    const svP = uuid();
    const svB = uuid();
    const bookingA = uuid();
    const blockA = uuid();
    await setup.query(
      `INSERT INTO schedule_version(id, business_id, status, actor_type, booking_interval_minutes)
       VALUES ($1,$2,'ACTIVE','OWNER',30),($3,$2,'PENDING','OWNER',30),($4,$5,'ACTIVE','OWNER',15)`,
      [svA, biz.a, svP, svB, biz.b],
    );
    await setup.query(
      `INSERT INTO working_period(id, schedule_version_id, business_id, day_of_week, start_minutes, end_minutes)
       VALUES (gen_random_uuid(), $1, $2, 0, 540, 1080), (gen_random_uuid(), $3, $4, 1, 480, 600), (gen_random_uuid(), $5, $6, 2, 600, 720)`,
      [svA, biz.a, svP, biz.a, svB, biz.b],
    );
    await setup.query(
      `INSERT INTO special_date(id, schedule_version_id, business_id, calendar_date, is_closed)
       VALUES (gen_random_uuid(), $1, $2, '2026-12-25', true)`,
      [svA, biz.a],
    );
    await setup.query(
      `INSERT INTO blocked_period(id, schedule_version_id, business_id, start_at, end_at)
       VALUES ($1,$2,$3, date_trunc('minute', now() + interval '10 days'), date_trunc('minute', now() + interval '10 days' + interval '60 minutes'))`,
      [blockA, svA, biz.a],
    );
    await setup.query(
      `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date, status)
       VALUES ($1,$2,'Aynalem','+251944444444',date_trunc('minute', now() + interval '3 days'), date_trunc('minute', now() + interval '3 days' + interval '30 minutes'), (now() + interval '3 days')::date, 'CONFIRMED')`,
      [bookingA, biz.a],
    );
    await setup.query(
      `INSERT INTO schedule_conflict(id, business_id, schedule_version_id, booking_id, reason)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Outside weekly working hours')`,
      [biz.a, svA, bookingA],
    );
    await setup.query(
      `INSERT INTO schedule_exception(id, business_id, booking_id, schedule_version_id)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [biz.a, bookingA, svA],
    );

    await setup.end();
    (globalThis as Record<string, unknown>).__isl_schedule = {
      svA,
      svP,
      svB,
      bookingA,
      blockA,
    };
  });

  it('D: `app` role sees no schedule rows without a tenant context', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    for (const table of [
      'schedule_version',
      'working_period',
      'special_date',
      'special_date_period',
      'blocked_period',
      'schedule_conflict',
      'schedule_exception',
    ]) {
      const res = await client.query(`SELECT count(*)::int AS c FROM ${table}`);
      expect(res.rows[0].c, table).toBe(0);
    }
    await client.end();
  });

  it('A: owner A sees only its own schedule versions and children', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_schedule as {
      svA: string;
      svP: string;
      svB: string;
    };
    const biz = (globalThis as Record<string, unknown>).__isl_biz as {
      userA: string;
      userB: string;
    };
    void biz.userB;
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${biz.userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);

    const versions = await client.query('SELECT id, status FROM schedule_version ORDER BY status');
    expect(versions.rows.map((r) => r.id).sort()).toEqual([ctx.svA, ctx.svP].sort());
    expect(versions.rows.map((r) => r.id)).not.toContain(ctx.svB);

    const foreign = await client.query('SELECT status FROM schedule_version WHERE id = $1', [
      ctx.svB,
    ]);
    expect(foreign.rows).toEqual([]);
    await client.end();
  });

  it('B: owner A cannot read, update, delete or insert into tenant B schedule rows', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_schedule as {
      svB: string;
    };
    const biz = (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userA: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${biz.userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);
    await client.query(`SET app.business_id = '${biz.a}'`); // spoof tenant A

    // Read / update / delete tenant B's version → shielded/filtered.
    const read = await client.query('SELECT id FROM schedule_version WHERE id = $1', [ctx.svB]);
    expect(read.rows).toEqual([]);
    const upd = await client.query(
      "UPDATE schedule_version SET status = 'SUPERSEDED' WHERE id = $1",
      [ctx.svB],
    );
    expect(upd.rowCount).toBe(0);
    const del = await client.query('DELETE FROM schedule_version WHERE id = $1', [ctx.svB]);
    expect(del.rowCount).toBe(0);

    // INSERT a version under tenant B → WITH CHECK policy denies outright.
    let err = '';
    try {
      await client.query(
        `INSERT INTO schedule_version(id, business_id, status, actor_type, booking_interval_minutes)
         VALUES (gen_random_uuid(), $1, 'ACTIVE', 'OWNER', 30)`,
        [biz.b],
      );
    } catch (e) {
      err = String((e as { message: string }).message);
    }
    expect(err.toLowerCase()).toContain('row-level security');
    await client.end();
  });

  it('PUBLIC projection: only the ACTIVE version of the scoped business', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_schedule as {
      svA: string;
      svP: string;
      svB: string;
    };
    const biz = (globalThis as Record<string, unknown>).__isl_biz as { a: string };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'PUBLIC'`);
    await client.query(`SET app.booking_public = '1'`);
    await client.query(`SET app.business_id = '${biz.a}'`);

    const versions = await client.query('SELECT id FROM schedule_version');
    expect(versions.rows.map((r) => r.id)).toEqual([ctx.svA]);
    expect(versions.rows.map((r) => r.id)).not.toContain(ctx.svP);
    expect(versions.rows.map((r) => r.id)).not.toContain(ctx.svB);

    // PUBLIC is SELECT-only: inserts are denied by missing policy.
    let err = '';
    try {
      await client.query(
        `INSERT INTO working_period(id, schedule_version_id, business_id, day_of_week, start_minutes, end_minutes)
         VALUES (gen_random_uuid(), $1, $2, 1, 480, 600)`,
        [ctx.svA, biz.a],
      );
    } catch (e) {
      err = String((e as { message: string }).message);
    }
    expect(err.toLowerCase()).toContain('row-level security');
    await client.end();
  });

  it('elevated SUPER_ADMIN scope sees the schedule domain across tenants', async () => {
    const ctx = (globalThis as Record<string, unknown>).__isl_schedule as {
      svA: string;
      svB: string;
    };
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'SUPER_ADMIN'`);
    const versions = await client.query('SELECT id FROM schedule_version ORDER BY id');
    expect(versions.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ctx.svA, ctx.svB]));
    const conflicts = await client.query('SELECT count(*)::int AS c FROM schedule_conflict');
    expect(conflicts.rows[0].c).toBe(1);
    await client.end();
  });
});

describe('RLS isolation on notifications & telegram (Prompt 13, tests A/B/D)', () => {
  const fx: Record<string, string> = {};

  beforeAll(async () => {
    const setup = new Client({ connectionString: SUPER_URL });
    await setup.connect();
    await setup.query(
      'TRUNCATE notification_delivery, telegram_connection, notification, booking CASCADE',
    );
    // One owned booking per tenant (A: Ada, B: Ben) with a Telegram connection
    // and a delivery intent each, mimicking the P13 flash/bind + fan-out rows.
    await setup.query(
      `INSERT INTO booking(id, business_id, customer_name, customer_phone, start_at, end_at, slot_date)
       VALUES (gen_random_uuid(), $1, 'Ada', '+251911111111', date_trunc('minute', now()),
               date_trunc('minute', now()) + interval '30 minutes', CURRENT_DATE),
              (gen_random_uuid(), $2, 'Ben', '+251922222222', date_trunc('minute', now()),
               date_trunc('minute', now()) + interval '30 minutes', CURRENT_DATE)`,
      [fxIds().a, fxIds().b],
    );
    const bookings = await setup.query<{ id: string; customer_name: string }>(
      'SELECT id, customer_name FROM booking ORDER BY customer_name',
    );
    const bookingA = bookings.rows[0].id;
    const bookingB = bookings.rows[1].id;
    fx.bookingA = bookingA;
    fx.bookingB = bookingB;

    const connA = uuid();
    const connB = uuid();
    const noteA = uuid();
    const noteB = uuid();
    const delA = uuid();
    const delB = uuid();
    fx.connA = connA;
    fx.connB = connB;
    fx.noteA = noteA;
    fx.noteB = noteB;
    fx.delA = delA;
    fx.delB = delB;
    await setup.query(
      `INSERT INTO telegram_connection(id, business_id, booking_id, status, connect_token_hash, chat_id)
       VALUES ($1, $2, $3, 'ACTIVE', NULL, 1001),
              ($4, $5, $6, 'PENDING', repeat('a', 64), NULL)`,
      [connA, fxIds().a, bookingA, connB, fxIds().b, bookingB],
    );
    await setup.query(
      `INSERT INTO notification(id, business_id, booking_id, type, payload)
       VALUES ($1, $2, $3, 'BOOKING_CONFIRMED', '{"startAt":"2026-09-09T10:00:00Z"}'),
              ($4, $5, $6, 'BOOKING_CONFIRMED', '{"startAt":"2026-09-09T11:00:00Z"}')`,
      [noteA, fxIds().a, bookingA, noteB, fxIds().b, bookingB],
    );
    await setup.query(
      `INSERT INTO notification_delivery(id, notification_id, business_id, channel, recipient, status, idempotency_key)
       VALUES ($1, $2, $3, 'TELEGRAM', '1001', 'SENT', 'isl-del-a'),
              ($4, $5, $6, 'TELEGRAM', '-', 'SUPPRESSED', 'isl-del-b')`,
      [delA, noteA, fxIds().a, delB, noteB, fxIds().b],
    );
    await setup.end();
  });

  function fxIds(): { a: string; b: string; userA: string; userB: string } {
    return (globalThis as Record<string, unknown>).__isl_biz as {
      a: string;
      b: string;
      userA: string;
      userB: string;
    };
  }

  it('D: `app` role sees no notifications/telegram rows without a tenant context', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    for (const table of ['notification_delivery', 'telegram_connection', 'notification']) {
      const res = await client.query(`SELECT count(*)::int AS c FROM ${table}`);
      expect(res.rows[0].c, table).toBe(0);
    }
    await client.end();
  });

  it('A: owner A sees only its own connection, delivery and notification rows', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${fxIds().userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);

    const conns = await client.query('SELECT id FROM telegram_connection');
    expect(conns.rows.map((r) => r.id)).toEqual([fx.connA]);
    const dels = await client.query('SELECT id FROM notification_delivery');
    expect(dels.rows.map((r) => r.id)).toEqual([fx.delA]);
    const notes = await client.query('SELECT id FROM notification');
    expect(notes.rows.map((r) => r.id)).toEqual([fx.noteA]);

    for (const [table, foreign] of [
      ['telegram_connection', fx.connB],
      ['notification_delivery', fx.delB],
      ['notification', fx.noteB],
    ] as const) {
      const res = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [foreign]);
      expect(res.rows).toEqual([]);
    }
    await client.end();
  });

  it('B: owner A cannot touch tenant B connection/delivery rows (read/update/delete/insert)', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.user_id = '${fxIds().userA}'`);
    await client.query(`SET app.scope = 'OWNER'`);
    await client.query(`SET app.business_id = '${fxIds().a}'`); // spoof tenant A

    const updConn = await client.query(
      "UPDATE telegram_connection SET status = 'REVOKED' WHERE id = $1",
      [fx.connB],
    );
    expect(updConn.rowCount).toBe(0);
    const delConn = await client.query('DELETE FROM telegram_connection WHERE id = $1', [fx.connB]);
    expect(delConn.rowCount).toBe(0);
    const updDel = await client.query(
      'UPDATE notification_delivery SET status = $2 WHERE id = $1',
      [fx.delB, 'SENT'],
    );
    expect(updDel.rowCount).toBe(0);

    // INSERT under tenant B → WITH CHECK denies (owner A owns neither).
    let err = '';
    try {
      await client.query(
        `INSERT INTO telegram_connection(id, business_id, booking_id, status)
         VALUES (gen_random_uuid(), $1, $2, 'PENDING')`,
        [fxIds().b, fx.bookingB],
      );
    } catch (e) {
      err = String((e as { message: string }).message);
    }
    expect(err.toLowerCase()).toContain('row-level security');
    await client.end();
  });

  it('PUBLIC: phone-gated connect/status projection, no cross-booking access', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'PUBLIC'`);
    await client.query(`SET app.booking_public = '1'`);
    await client.query(`SET app.business_id = '${fxIds().a}'`);
    await client.query(`SET app.customer_phone = '+251911111111'`);

    // The caller may only see the connection of THEIR (phone-verified) booking
    // inside the scoped business — tenant B's rows are always invisible.
    const visible = await client.query('SELECT id FROM telegram_connection');
    expect(visible.rows.map((r) => r.id)).toEqual([fx.connA]);
    const foreign = await client.query('SELECT id FROM telegram_connection WHERE id = $1', [
      fx.connB,
    ]);
    expect(foreign.rows).toEqual([]);

    // Correct phone → the PENDING connection can be rotated/updated…
    const okUpdate = await client.query(
      "UPDATE telegram_connection SET status = 'PENDING' WHERE id = $1",
      [fx.connA],
    );
    expect(okUpdate.rowCount).toBe(1);
    // Wrong phone → the SAME row is invisible to update (phone gate).
    const wrong = new Client({ connectionString: APP_URL });
    await wrong.connect();
    await wrong.query(`SET app.scope = 'PUBLIC'`);
    await wrong.query(`SET app.booking_public = '1'`);
    await wrong.query(`SET app.business_id = '${fxIds().a}'`);
    await wrong.query(`SET app.customer_phone = '+251900000000'`);
    const gated = await wrong.query(
      "UPDATE telegram_connection SET status = 'REVOKED' WHERE id = $1",
      [fx.connA],
    );
    expect(gated.rowCount).toBe(0);
    await wrong.end();

    // PUBLIC never inserts delivery intents (no insert policy for `app`+PUBLIC).
    let err = '';
    try {
      await client.query(
        `INSERT INTO notification_delivery(id, notification_id, business_id, channel, recipient, idempotency_key)
         VALUES (gen_random_uuid(), $1, $2, 'TELEGRAM', '1001', 'isl-del-public')`,
        [fx.noteA, fxIds().a],
      );
    } catch (e) {
      err = String((e as { message: string }).message);
    }
    expect(err.toLowerCase()).toContain('row-level security');
    await client.end();
  });

  it('SUPER_ADMIN scope sees every tenant row and can insert delivery intents', async () => {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    await client.query(`SET app.scope = 'SUPER_ADMIN'`);

    const conns = await client.query('SELECT id FROM telegram_connection');
    expect(conns.rows.map((r) => r.id).sort()).toEqual([fx.connA, fx.connB].sort());
    const dels = await client.query('SELECT id FROM notification_delivery');
    expect(dels.rows.map((r) => r.id).sort()).toEqual([fx.delA, fx.delB].sort());

    // The pipeline runs as `app` with app.scope=SUPER_ADMIN (SYSTEM actor); its
    // fan-out INSERT must be allowed by the dedicated INSERT policy.
    const noteC = uuid();
    await client.query(
      `INSERT INTO notification(id, business_id, booking_id, type)
       VALUES ($1, $2, $3, 'BOOKING_CONFIRMED')`,
      [noteC, fxIds().a, fx.bookingA],
    );
    const inserted = await client.query(
      `INSERT INTO notification_delivery(id, notification_id, business_id, channel, recipient, idempotency_key)
       VALUES (gen_random_uuid(), $1, $2, 'TELEGRAM', '1001', 'isl-del-super')`,
      [noteC, fxIds().a],
    );
    expect(inserted.rowCount).toBe(1);
    const all = await client.query('SELECT count(*)::int AS c FROM notification_delivery');
    expect(all.rows[0].c).toBe(3);
    await client.end();
  });
});
