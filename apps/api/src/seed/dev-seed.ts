/**
 * DEVELOPMENT-ONLY seed. Creates well-known dev identities + two test
 * businesses. Refuses to run when APP_ENV=production.
 *
 * Identity constraints (REQ-037/038): exactly one Super Admin and exactly two
 * Admin accounts. The Super Admin has a distinct recovery email (REQ-198).
 *
 * Passwords contain no real secrets (dev placeholders) and hold NO production
 * value.
 */
import 'reflect-metadata';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';

const DEV_PASSWORD = 'DevPass-12345'; // dev-only, never used in production

async function main(): Promise<void> {
  if ((process.env.APP_ENV ?? 'development') === 'production') {
    throw new Error('dev-seed refuses to run in production.');
  }
  // Seeding runs as the migrator role (BYPASSRLS); app is RLS-enforced and has
  // no INSERT policy on tenant tables by design.
  const url = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();

  const passwordHash = await hash(DEV_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  // Super Admin — exactly one, with a distinct emergency recovery email.
  const superAdmin = await createUser(
    client,
    'dev-superadmin@werefa.local',
    'SuperAdmin',
    passwordHash,
    { recoveryEmail: 'recovery-superadmin@werefa.local' },
  );

  // Admins — exactly two (REQ-038).
  await createUser(client, 'dev-admin@werefa.local', 'Admin', passwordHash);
  await createUser(client, 'dev-admin2@werefa.local', 'Admin', passwordHash);

  const owner = await createUser(client, 'dev-owner@werefa.local', 'Owner', passwordHash);

  const bizA = await upsertBusiness(client, 'dawn-salon', "Dawn's Barber & Salon", {
    category: 'Salon & Barber',
    description: 'Barbering & salon studio in the city centre.',
    phone: '+251911000001',
    address: 'Addis Ababa, Bole Road',
  });
  const bizB = await upsertBusiness(client, 'lumina-beauty', 'Lumina Beauty Studio', {
    category: 'Other',
    description: 'Beauty studio — cosmetics, nails and lashes.',
    phone: '+251911000002',
    contactEmail: 'hello@lumina.example',
  });

  // Prompt 14: every business owns exactly one subscription row (doc 15 §1).
  await seedSubscription(client, bizA);
  await seedSubscription(client, bizB);

  await client.query(
    `INSERT INTO business_owner(business_id, user_id) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (business_id, user_id) DO NOTHING`,
    [bizA, owner, bizB, owner],
  );

  // Sample service catalogs (Prompt 10) so the demo dashboard + public page
  // render real content. Idempotent keyed by (business_id, name).
  const haircut = await upsertService(client, bizA, 'Haircut & Style', 4500, 45);
  await upsertService(client, bizA, 'Beard Trim', 2000, 20);
  await upsertService(client, bizA, 'Color & Style', 9000, 90);
  await upsertService(client, bizB, 'Classic Manicure', 3000, 30);

  await upsertVariation(client, haircut, 'Kids (under 12)', -1000, -10);
  await upsertVariation(client, haircut, 'Premium styling', 1500, 15);
  await upsertAddOn(client, haircut, 'Styling products', 500, 5);

  // Booking fixtures (Prompt 11) across every status so the owner dashboard
  // and demo data show the full lifecycle. Deterministic UUID ids keep the
  // seed idempotent.
  await seedBookings(client, bizA, bizB);

  // Schedule fixtures (Prompt 12): an ACTIVE version per demo business so the
  // scheduling dashboard and public availability are driven by real schedules.
  await seedSchedules(client, bizA, bizB);

  await client.end();
  console.log(
    '[seed] dev data seeded. Accounts: dev-owner@ / dev-admin@ / dev-admin2@ / dev-superadmin@werefa.local (recovery: recovery-superadmin@werefa.local)',
    `superAdminId=${superAdmin}`,
  );
}

async function upsertService(
  client: Client,
  businessId: string,
  name: string,
  basePriceMinor: number,
  baseDurationMinutes: number,
): Promise<string> {
  const existing = await client.query(
    `SELECT id FROM service WHERE business_id = $1 AND name = $2`,
    [businessId, name],
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const ins = await client.query(
    `INSERT INTO service(business_id, name, base_price_minor, base_duration_minutes)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [businessId, name, basePriceMinor, baseDurationMinutes],
  );
  return ins.rows[0].id as string;
}

async function upsertVariation(
  client: Client,
  serviceId: string,
  name: string,
  priceDeltaMinor: number,
  durationDeltaMinutes: number,
): Promise<void> {
  await client.query(
    `INSERT INTO service_variation(service_id, business_id, name, price_delta_minor, duration_delta_minutes)
     SELECT id, business_id, $2, $3, $4 FROM service WHERE id = $1
     ON CONFLICT (service_id, name) DO NOTHING`,
    [serviceId, name, priceDeltaMinor, durationDeltaMinutes],
  );
}

async function upsertAddOn(
  client: Client,
  serviceId: string,
  name: string,
  priceDeltaMinor: number,
  durationDeltaMinutes: number,
): Promise<void> {
  await client.query(
    `INSERT INTO add_on(service_id, business_id, name, price_delta_minor, duration_delta_minutes)
     SELECT id, business_id, $2, $3, $4 FROM service WHERE id = $1
     ON CONFLICT (service_id, name) DO NOTHING`,
    [serviceId, name, priceDeltaMinor, durationDeltaMinutes],
  );
}

async function upsertBusiness(
  client: Client,
  slug: string,
  name: string,
  profile: {
    category?: string;
    description?: string;
    phone?: string;
    contactEmail?: string;
    address?: string;
  } = {},
): Promise<string> {
  const existing = await client.query(`SELECT id FROM business WHERE public_slug = $1`, [slug]);
  if (existing.rows[0]) return existing.rows[0].id as string;
  const ins = await client.query(
    `INSERT INTO business(public_slug, name, category, description, phone, contact_email, address, trial_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '30 days') RETURNING id`,
    [
      slug,
      name,
      profile.category ?? 'Other',
      profile.description ?? null,
      profile.phone ?? null,
      profile.contactEmail ?? null,
      profile.address ?? null,
    ],
  );
  return ins.rows[0].id as string;
}

/**
 * Prompt 14: one subscription row per business (doc 15 §1). Mirrors the
 * seeded business.trial_ends_at so the booking gates and demo data agree
 * exactly with the derived model. Idempotent on the business_id PK.
 */
async function seedSubscription(client: Client, businessId: string): Promise<void> {
  await client.query(
    `INSERT INTO subscription(business_id, status, trial_started_at, trial_ends_at, price_minor)
     VALUES ($1, 'TRIAL', date_trunc('minute', now()), date_trunc('minute', now() + interval '30 days'), 150000)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId],
  );
}

async function createUser(
  client: Client,
  email: string,
  role: 'Owner' | 'Admin' | 'SuperAdmin',
  passwordHash: string,
  opts: { recoveryEmail?: string } = {},
): Promise<string> {
  const res = await client.query(
    `INSERT INTO "user"(email, password_hash, role, is_email_verified, recovery_email)
     VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (email) DO UPDATE
       SET role = EXCLUDED.role,
           is_email_verified = true,
           recovery_email = COALESCE(EXCLUDED.recovery_email, "user".recovery_email)
     RETURNING id`,
    [email, passwordHash, role, opts.recoveryEmail ?? null],
  );
  return res.rows[0].id as string;
}

function wholeMinute(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

function atHour(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function slotDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface BookingSeedLine {
  serviceId: string;
  name: string;
  unitPriceMinor: number;
  durationMinutes: number;
}

interface BookingSeed {
  id: string;
  customerName: string;
  customerPhone: string;
  note: string | null;
  status: 'PAYMENT_PENDING' | 'CONFIRMED' | 'REJECTED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  startAt: Date;
  lines: BookingSeedLine[];
  payment: {
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    method: 'BANK_TRANSFER' | 'TELEBIRR_MOBILE_MONEY';
    prepaidMinor: number;
  } | null;
  slot: { status: 'LOCKED' | 'ALLOCATED' | 'RELEASED' } | null;
  history: {
    fromStatus: string;
    toStatus: string;
    actorType: 'OWNER' | 'ADMIN' | 'SUPER_ADMIN' | 'SYSTEM';
    reason: string | null;
  }[];
  proofs?: { storageKey: string; mime: string; sizeBytes: number; submissionKey: string }[];
  notifications?: { type: string }[];
}

async function insertBookingSeed(
  client: Client,
  businessId: string,
  b: BookingSeed,
  lockId: string,
): Promise<void> {
  const endAt = addMinutes(
    b.startAt,
    b.lines.reduce((n, l) => n + l.durationMinutes, 0),
  );

  await client.query(
    `INSERT INTO booking(id, business_id, customer_name, customer_phone, note,
        start_at, end_at, slot_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"BookingStatus")
     ON CONFLICT (id) DO NOTHING`,
    [
      b.id,
      businessId,
      b.customerName,
      b.customerPhone,
      b.note,
      wholeMinute(b.startAt),
      wholeMinute(endAt),
      slotDateOf(b.startAt),
      b.status,
    ],
  );

  for (const line of b.lines) {
    await client.query(
      `INSERT INTO booking_service_item(booking_id, business_id, service_id, name_snapshot, unit_price_minor, duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [b.id, businessId, line.serviceId, line.name, line.unitPriceMinor, line.durationMinutes],
    );
  }

  if (b.payment) {
    await client.query(
      `INSERT INTO payment(business_id, booking_id, status, method, prepaid_minor)
       VALUES ($1, $2, $3::"PaymentStatus", $4::"PaymentMethod", $5)
       ON CONFLICT (booking_id) DO NOTHING`,
      [businessId, b.id, b.payment.status, b.payment.method, b.payment.prepaidMinor],
    );
    await client.query(
      `INSERT INTO payment_status_history(payment_id, business_id, from_status, to_status, actor_type, occurred_at)
       SELECT id, business_id, 'PENDING', status, 'SYSTEM', created_at FROM payment WHERE booking_id = $1
       ON CONFLICT (id) DO NOTHING`,
      [b.id],
    );
  }

  if (b.slot) {
    await client.query(
      `INSERT INTO slot_lock(id, business_id, booking_id, slot_date, start_at, end_at, status,
         released_at, released_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::"SlotLockStatus",
         $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        lockId,
        businessId,
        b.id,
        slotDateOf(b.startAt),
        wholeMinute(b.startAt),
        wholeMinute(endAt),
        b.slot.status,
        b.slot.status === 'RELEASED' ? wholeMinute(new Date()) : null,
        b.slot.status === 'RELEASED' ? 'system-seed' : null,
      ],
    );
  }

  for (const h of b.history) {
    await client.query(
      `INSERT INTO booking_status_history(booking_id, business_id, from_status, to_status, actor_type, reason)
       VALUES ($1, $2, $3::"BookingStatus", $4::"BookingStatus", $5::"ActorType", $6)`,
      [b.id, businessId, h.fromStatus, h.toStatus, h.actorType, h.reason],
    );
  }

  for (const p of b.proofs ?? []) {
    await client.query(
      `INSERT INTO payment_proof(payment_id, business_id, storage_key, mime, size_bytes, submission_key)
       SELECT id, $2, $3, $4, $5, $6 FROM payment WHERE booking_id = $1
       ON CONFLICT (submission_key) DO NOTHING`,
      [b.id, businessId, p.storageKey, p.mime, p.sizeBytes, p.submissionKey],
    );
  }

  for (const n of b.notifications ?? []) {
    await client.query(
      `INSERT INTO notification(business_id, booking_id, type)
       VALUES ($1, $2, $3)`,
      [businessId, b.id, n.type],
    );
  }
}

/**
 * Booking fixtures: one booking per lifecycle state plus a multi-service
 * booking, so the owner dashboard and public demo flow show real content.
 * Deterministic ids → idempotent across re-runs. Slots are distinct and
 * future (or past for completed/no-show) with minute precision.
 */
async function seedBookings(client: Client, bizA: string, bizB: string): Promise<void> {
  // Fixtures are one-shot reference data: if any seed booking already exists for
  // either business, skip entirely (history/proof rows have no natural keys).
  const existing = await client.query(
    `SELECT 1 FROM booking WHERE business_id = $1 OR business_id = $2 LIMIT 1`,
    [bizA, bizB],
  );
  if (existing.rows[0]) return;

  const getService = async (businessId: string, name: string) => {
    const r = await client.query(
      `SELECT id, name, base_price_minor::int, base_duration_minutes FROM service
       WHERE business_id = $1 AND name = $2`,
      [businessId, name],
    );
    return r.rows[0] as {
      id: string;
      name: string;
      base_price_minor: number;
      base_duration_minutes: number;
    };
  };

  const haircut = await getService(bizA, 'Haircut & Style');
  const beard = await getService(bizA, 'Beard Trim');
  const color = await getService(bizA, 'Color & Style');
  const manicure = await getService(bizB, 'Classic Manicure');

  const now = new Date();
  const todayMinutes = addMinutes(wholeMinute(now), 60);

  // CONFIRMED — upcoming this week, slot ALLOCATED, payment accepted.
  await insertBookingSeed(
    client,
    bizA,
    {
      id: 'b1e00001-0000-4000-8000-000000000001',
      customerName: 'Hanna Tesfaye',
      customerPhone: '+251911100001',
      note: 'First-time client, please book near the window seat.',
      status: 'CONFIRMED',
      startAt: atHour(addDays(todayMinutes, 2), 10),
      lines: [
        {
          serviceId: haircut.id,
          name: 'Haircut & Style',
          unitPriceMinor: 4500,
          durationMinutes: 45,
        },
      ],
      payment: { status: 'ACCEPTED', method: 'TELEBIRR_MOBILE_MONEY', prepaidMinor: 4500 },
      slot: { status: 'ALLOCATED' },
      history: [
        {
          fromStatus: 'PAYMENT_PENDING',
          toStatus: 'CONFIRMED',
          actorType: 'OWNER',
          reason: 'Payment verified',
        },
      ],
      proofs: [
        {
          storageKey: 'seeds/hanna-tesfaye.png',
          mime: 'image/png',
          sizeBytes: 48213,
          submissionKey: 'seed-proof-0001',
        },
      ],
      notifications: [{ type: 'BOOKING_CREATE' }, { type: 'BOOKING_REMINDER_24H' }],
    },
    'a2f00001-0000-4000-8000-000000000001',
  );

  // PAYMENT_PENDING — proof waiting, slot LOCKED.
  await insertBookingSeed(
    client,
    bizA,
    {
      id: 'b1e00002-0000-4000-8000-000000000002',
      customerName: 'Solomon Girma',
      customerPhone: '+251911100002',
      note: null,
      status: 'PAYMENT_PENDING',
      startAt: atHour(addDays(todayMinutes, 3), 14),
      lines: [
        { serviceId: beard.id, name: 'Beard Trim', unitPriceMinor: 2000, durationMinutes: 20 },
      ],
      payment: { status: 'PENDING', method: 'BANK_TRANSFER', prepaidMinor: 0 },
      slot: { status: 'LOCKED' },
      history: [],
    },
    'a2f00002-0000-4000-8000-000000000002',
  );

  // COMPLETED — past, terminal; past service remains deletable (REQ-077).
  await insertBookingSeed(
    client,
    bizA,
    {
      id: 'b1e00003-0000-4000-8000-000000000003',
      customerName: 'Meron Alemu',
      customerPhone: '+251911100003',
      note: 'Loved the result — please redo the same next month.',
      status: 'COMPLETED',
      startAt: atHour(addDays(todayMinutes, -5), 16),
      lines: [
        { serviceId: color.id, name: 'Color & Style', unitPriceMinor: 9000, durationMinutes: 90 },
      ],
      payment: { status: 'ACCEPTED', method: 'TELEBIRR_MOBILE_MONEY', prepaidMinor: 9000 },
      slot: { status: 'RELEASED' },
      history: [
        {
          fromStatus: 'PAYMENT_PENDING',
          toStatus: 'CONFIRMED',
          actorType: 'OWNER',
          reason: 'Payment verified',
        },
        {
          fromStatus: 'CONFIRMED',
          toStatus: 'COMPLETED',
          actorType: 'SYSTEM',
          reason: 'auto-completed',
        },
      ],
    },
    'a2f00003-0000-4000-8000-000000000003',
  );

  // NO_SHOW — terminal, slot released.
  await insertBookingSeed(
    client,
    bizA,
    {
      id: 'b1e00004-0000-4000-8000-000000000004',
      customerName: 'Yonas Bekele',
      customerPhone: '+251911100004',
      note: null,
      status: 'NO_SHOW',
      startAt: atHour(addDays(todayMinutes, -2), 11),
      lines: [
        {
          serviceId: haircut.id,
          name: 'Haircut & Style (Premium styling)',
          unitPriceMinor: 6000,
          durationMinutes: 60,
        },
      ],
      payment: { status: 'ACCEPTED', method: 'BANK_TRANSFER', prepaidMinor: 6000 },
      slot: { status: 'RELEASED' },
      history: [
        {
          fromStatus: 'PAYMENT_PENDING',
          toStatus: 'CONFIRMED',
          actorType: 'OWNER',
          reason: 'Payment verified',
        },
        {
          fromStatus: 'CONFIRMED',
          toStatus: 'NO_SHOW',
          actorType: 'OWNER',
          reason: 'customer absent',
        },
      ],
    },
    'a2f00004-0000-4000-8000-000000000004',
  );

  // CANCELLED — terminal, slot released (SM-06).
  await insertBookingSeed(
    client,
    bizA,
    {
      id: 'b1e00005-0000-4000-8000-000000000005',
      customerName: 'Leul Haile',
      customerPhone: '+251911100005',
      note: null,
      status: 'CANCELLED',
      startAt: atHour(addDays(todayMinutes, 6), 15),
      lines: [
        { serviceId: beard.id, name: 'Beard Trim', unitPriceMinor: 2000, durationMinutes: 20 },
      ],
      payment: { status: 'ACCEPTED', method: 'BANK_TRANSFER', prepaidMinor: 2000 },
      slot: { status: 'RELEASED' },
      history: [
        {
          fromStatus: 'PAYMENT_PENDING',
          toStatus: 'CONFIRMED',
          actorType: 'OWNER',
          reason: 'Payment verified',
        },
        {
          fromStatus: 'CONFIRMED',
          toStatus: 'CANCELLED',
          actorType: 'OWNER',
          reason: 'cancelled by owner',
        },
      ],
    },
    'a2f00005-0000-4000-8000-000000000005',
  );

  // REJECTED — proof rejected; slot stays LOCKED (SM-08) pending resubmission.
  await insertBookingSeed(
    client,
    bizA,
    {
      id: 'b1e00006-0000-4000-8000-000000000006',
      customerName: 'Selam Wubshet',
      customerPhone: '+251911100006',
      note: null,
      status: 'REJECTED',
      startAt: atHour(addDays(todayMinutes, 7), 9),
      lines: [
        {
          serviceId: haircut.id,
          name: 'Haircut & Style',
          unitPriceMinor: 4500,
          durationMinutes: 45,
        },
      ],
      payment: { status: 'REJECTED', method: 'TELEBIRR_MOBILE_MONEY', prepaidMinor: 0 },
      slot: { status: 'LOCKED' },
      history: [
        {
          fromStatus: 'PAYMENT_PENDING',
          toStatus: 'REJECTED',
          actorType: 'OWNER',
          reason: 'Receipt is unreadable, please resubmit',
        },
      ],
    },
    'a2f00006-0000-4000-8000-000000000006',
  );

  // Multi-service booking (REQ-070): two services → composed totals.
  await insertBookingSeed(
    client,
    bizB,
    {
      id: '0b0b0007-0000-4000-8000-000000000007',
      customerName: 'Ruth Megersa',
      customerPhone: '+251911100007',
      note: 'Coming straight from work, 10 min late is possible.',
      status: 'PAYMENT_PENDING',
      startAt: atHour(addDays(todayMinutes, 2), 12),
      lines: [
        {
          serviceId: manicure.id,
          name: 'Classic Manicure',
          unitPriceMinor: 3000,
          durationMinutes: 30,
        },
      ],
      payment: { status: 'PENDING', method: 'BANK_TRANSFER', prepaidMinor: 0 },
      slot: { status: 'LOCKED' },
      history: [],
      notifications: [{ type: 'BOOKING_CREATE' }],
    },
    'a2f00007-0000-4000-8000-000000000007',
  );
}

/**
 * Schedule fixtures (Prompt 12): one ACTIVE schedule per demo business so the
 * scheduling dashboard and public booking availability are driven by real
 * schedules. Deterministic ids → idempotent across re-runs; skips entirely
 * when either demo business already has a schedule version.
 *
 * bizA "Dawn's" — Mon–Sat 09:00–18:00 (30-minute grid).
 * bizB "Lumina" — Mon–Fri 09:00–17:00 (15-minute grid).
 */
async function seedSchedules(client: Client, bizA: string, bizB: string): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM schedule_version WHERE business_id = $1 OR business_id = $2 LIMIT 1`,
    [bizA, bizB],
  );
  if (existing.rows[0]) return;

  const versionA = '5a000001-0000-4000-8000-000000000000';
  const versionB = '5a000002-0000-4000-8000-000000000000';

  await client.query(
    `INSERT INTO schedule_version(id, business_id, status, actor_type, booking_interval_minutes, reason)
     VALUES ($1, $2, 'ACTIVE'::"ScheduleVersionStatus", 'OWNER'::"ActorType", 30, $3)`,
    [versionA, bizA, 'Standard weekly hours (seed)'],
  );
  await client.query(
    `INSERT INTO schedule_version(id, business_id, status, actor_type, booking_interval_minutes, reason)
     VALUES ($1, $2, 'ACTIVE'::"ScheduleVersionStatus", 'OWNER'::"ActorType", 15, $3)`,
    [versionB, bizB, 'Weekly studio hours (seed)'],
  );

  for (let day = 1; day <= 6; day += 1) {
    await client.query(
      `INSERT INTO working_period(schedule_version_id, business_id, day_of_week, start_minutes, end_minutes)
       VALUES ($1, $2, $3, 540, 1080)`,
      [versionA, bizA, day],
    );
  }
  for (let day = 1; day <= 5; day += 1) {
    await client.query(
      `INSERT INTO working_period(schedule_version_id, business_id, day_of_week, start_minutes, end_minutes)
       VALUES ($1, $2, $3, 540, 1020)`,
      [versionB, bizB, day],
    );
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
