/**
 * Prompt 14 — Subscription & billing integration tests over HTTP + the
 * delivery pipeline (doc 15, REQ-125..141):
 *
 *  A) Owner flow: business create materializes a TRIAL subscription; overview,
 *     proof-upload payment submission (REQ-136), idempotent replay, presigned
 *     proof read, empty history.
 *  B) Admin review: pending queue/detail, approval extends the paid period +30d
 *     and writes history + security events, second review is a Conflict.
 *  C) Rejection with reason; owner receives the reason email.
 *  D) Reviewer can never review their own business (403).
 *  E) RLS/scope isolation: foreign tenant access 403, Admin exposes no audit,
 *     Super Admin audit reads everything.
 *  F) Delivery pipeline: payment submission fans out to exactly two Admin
 *     EMAILs (REQ-140); approval/rejection reach the owner contact; reminders
 *     are stale-safe (stale → SUPPRESSED, due → SENT).
 *  G) Lifecycle: derived EXPIRED blocks public availability + resume (402 /
 *     409 SUBSCRIPTION_EXPIRED), the status job persists the transition, the
 *     reminder job dedups (7-day window), auto-resume is denied while EXPIRED
 *     and succeeds after an approval.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { BusinessService } from '../../src/business/business.service';
import { SubscriptionLifecycleJob } from '../../src/jobs/subscription-lifecycle.job';
import { MailService } from '../../src/notifications/mail.service';
import { NotificationDispatcher } from '../../src/notifications/notification-dispatcher';
import {
  TEST_EMAILS,
  TEST_PASSWORDS,
  extractSessionToken,
  resetIdentityDatabaseAndSeed,
} from './identity.helpers';

function rootEnv(): NodeJS.ProcessEnv {
  let raw = '';
  try {
    raw = readFileSync(join(process.cwd(), '..', '..', '.env'), 'utf8');
  } catch {
    raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
  }
  const env: NodeJS.ProcessEnv = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

const FILE_ENV = rootEnv();
const TEST_DB = process.env.TEST_DB_NAME ?? 'werefa_test';
const withDb = (dsn: string | undefined, db: string): string | undefined => {
  if (!dsn) return undefined;
  const u = new URL(dsn);
  u.pathname = '/' + db;
  return u.toString();
};

const CSRF = { 'x-requested-with': 'fetch' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PaymentDto {
  id: string;
  status: string;
  amountMinor: string;
  note: string | null;
  mime: string;
  sizeBytes: number;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let superuser: Client;
let mail: MailService;
let dispatcher: NotificationDispatcher;
let businesses: BusinessService;
let job: SubscriptionLifecycleJob;
let ownerToken: string;
let owner2Token: string;
let admin1Token: string;
let admin2Token: string;
let saToken: string;

async function login(email: string, password: string): Promise<string> {
  const res = await supertest(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .set(CSRF);
  const token = extractSessionToken(res.header?.['set-cookie'] as string[] | undefined);
  if (!token) throw new Error(`Login failed for ${email}`);
  return token;
}

function auth(token: string): { Cookie: string; 'x-requested-with': string } {
  return { Cookie: `wrf.sid=${token}`, 'x-requested-with': 'fetch' };
}

/** Whole-minute ISO timestamps are required (REQ-226). */
function wholeMinuteInFuture(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setSeconds(0, 0);
  return d.toISOString();
}

async function createBusiness(contactEmail?: string): Promise<{ id: string; slug: string }> {
  const slug = `sub-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const res = await supertest(server)
    .post('/api/v1/businesses')
    .send({
      name: `Subscription Biz ${slug}`,
      publicSlug: slug,
      ...(contactEmail ? { contactEmail } : {}),
    })
    .set(auth(ownerToken));
  expect(res.status).toBe(201);
  return { id: (res.body.business as { id: string }).id, slug };
}

async function submitPayment(businessId: string, submissionKey?: string): Promise<PaymentDto> {
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/subscription/payments`)
    .field('submissionKey', submissionKey ?? crypto.randomUUID())
    .field('note', 'Bank transfer reference 1234')
    .attach('file', PNG, 'proof.png')
    .set(auth(ownerToken));
  expect(res.status).toBe(201);
  return (res.body as { payment: PaymentDto }).payment;
}

async function fanOutAndProcess(): Promise<void> {
  await dispatcher.fanOutDue();
  await dispatcher.processDue();
}

function deliveryRows(businessId: string, type: string) {
  return superuser.query<{
    status: string;
    recipient: string;
    channel: string;
    last_error: string | null;
  }>(
    `SELECT nd.status, nd.recipient, nd.channel, nd.last_error
       FROM notification_delivery nd
       JOIN notification n ON n.id = nd.notification_id
      WHERE n.business_id = $1 AND n.type = $2
      ORDER BY nd.created_at ASC`,
    [businessId, type],
  );
}

function securityEventCount(type: string): Promise<number> {
  return superuser
    .query<{ c: number }>(`SELECT count(*)::int AS c FROM security_event WHERE type = $1`, [type])
    .then((r) => r.rows[0].c);
}

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_PROVIDER = 'memory';
  process.env.AUTH_RATE_LIMIT_MAX = '100';
  process.env.COOKIE_SECURE = 'false';
  process.env.TELEGRAM_ENABLED = 'true';
  process.env.TG_BOT_USERNAME = 'werefa_test_bot';
  process.env.TG_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.DATABASE_URL = withDb(process.env.DATABASE_URL ?? FILE_ENV.DATABASE_URL, TEST_DB)!;
  process.env.DATABASE_MIGRATOR_URL = withDb(
    process.env.DATABASE_MIGRATOR_URL ?? FILE_ENV.DATABASE_MIGRATOR_URL ?? FILE_ENV.DATABASE_URL,
    TEST_DB,
  )!;
  process.env.DATABASE_URL_SUPERUSER = withDb(
    process.env.DATABASE_URL_SUPERUSER ?? FILE_ENV.DATABASE_URL_SUPERUSER,
    TEST_DB,
  )!;
  process.env.REDIS_URL = process.env.REDIS_URL ?? FILE_ENV.REDIS_URL ?? 'redis://localhost:6379/0';

  const { bootstrapApp } = await import('./bootstrap-app');
  app = await bootstrapApp();
  await app.init();
  server = app.getHttpServer();
  mail = app.get(MailService);
  dispatcher = app.get(NotificationDispatcher);
  businesses = app.get(BusinessService);
  job = app.get(SubscriptionLifecycleJob);

  const supertestModule = await import('supertest');
  supertest = (supertestModule.default ?? supertestModule) as typeof import('supertest');

  await resetIdentityDatabaseAndSeed(process.env.DATABASE_MIGRATOR_URL!);

  const { Client } = await import('pg');
  superuser = new Client({ connectionString: process.env.DATABASE_URL_SUPERUSER! });
  await superuser.connect();

  // Seed a second Owner so cross-tenant isolation can be exercised.
  await superuser.query(
    `INSERT INTO "user"(email, password_hash, role, is_email_verified)
     SELECT 'owner2@werefa.test', password_hash, 'Owner', true FROM "user" WHERE email = $1`,
    [TEST_EMAILS.owner],
  );

  ownerToken = await login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
  owner2Token = await login('owner2@werefa.test', TEST_PASSWORDS.owner);
  admin1Token = await login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
  admin2Token = await login(TEST_EMAILS.admin2, TEST_PASSWORDS.admin);
  saToken = await login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);
});

afterAll(async () => {
  await superuser?.end();
  await app?.close();
});

beforeEach(async () => {
  // NOTE: business/business_owner are NOT truncated here — `session`
  // references business (active_business_id, ON DELETE SET NULL) and a CASCADE
  // TRUNCATE would silently revoke every login taken in beforeAll. Each test
  // creates its own uniquely-slugged business, so no cross-test interference.
  await superuser.query(
    'TRUNCATE "subscription_payment", "subscription_status_history", "subscription", ' +
      '"notification_delivery", "notification", "security_event" CASCADE',
  );
  mail.captured.length = 0;
});

describe('A: owner subscription flow (REQ-125/128/129/136)', () => {
  it('business create materializes a TRIAL subscription with the operator price', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    const res = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    const sub = res.body.subscription as {
      status: string;
      canAcceptBookings: boolean;
      priceMinor: string;
      paidEndsAt: string | null;
    };
    expect(sub.status).toBe('TRIAL');
    expect(sub.canAcceptBookings).toBe(true);
    expect(sub.priceMinor).toBe('150000');
    expect(sub.paidEndsAt).toBeNull();
    expect((res.body.payments as unknown[]).length).toBe(0);
  });

  it('submits a PENDING payment, replays idempotently, and presigns the proof', async () => {
    const { id } = await createBusiness();
    const key = crypto.randomUUID();
    const payment = await submitPayment(id, key);
    expect(payment.status).toBe('PENDING');
    expect(payment.amountMinor).toBe('150000');
    expect(payment.note).toBe('Bank transfer reference 1234');
    expect(payment.mime).toBe('image/png');

    const replay = await supertest(server)
      .post(`/api/v1/businesses/${id}/subscription/payments`)
      .field('submissionKey', key)
      .field('note', 'second attempt')
      .attach('file', PNG, 'proof.png')
      .set(auth(ownerToken));
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({ created: false });
    expect((replay.body as { payment: PaymentDto }).payment.id).toBe(payment.id);
    const count = await superuser.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM subscription_payment WHERE business_id = $1 AND submission_key = $2',
      [id, key],
    );
    expect(count.rows[0].c).toBe(1);

    const proof = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription/payments/${payment.id}/proof`)
      .set(auth(ownerToken));
    expect(proof.status).toBe(200);
    expect((proof.body as { url: string }).url).toMatch(/^memory:\/\//);

    expect(await securityEventCount('SUBSCRIPTION_PAYMENT_SUBMITTED')).toBe(1);
    const outbox = await superuser.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM notification WHERE business_id = $1 AND type = 'SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN'",
      [id],
    );
    expect(outbox.rows[0].c).toBe(1);

    const overview = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(ownerToken));
    expect((overview.body.payments as unknown[]).length).toBe(1);
  });

  it('rejects a payment without a proof file', async () => {
    const { id } = await createBusiness();
    const res = await supertest(server)
      .post(`/api/v1/businesses/${id}/subscription/payments`)
      .field('submissionKey', crypto.randomUUID())
      .set(auth(ownerToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('history is empty until a transition is recorded', async () => {
    const { id } = await createBusiness();
    const res = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription/history`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('TRIAL');
    expect((res.body as { history: unknown[] }).history).toEqual([]);
  });
});

describe('B: admin review & approval (REQ-137/140)', () => {
  it('lists, details and approves a pending payment, extending +30d', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    const payment = await submitPayment(id);

    const list = await supertest(server)
      .get('/api/v1/admin/subscriptions/payments?status=PENDING')
      .set(auth(admin1Token));
    expect(list.status).toBe(200);
    expect(list.body.payments).toHaveLength(1);
    expect(list.body.payments[0]).toMatchObject({
      businessId: id,
      businessName: expect.stringContaining('Subscription Biz'),
      ownerEmail: 'owner@werefa.test',
      status: 'PENDING',
      amountMinor: '150000',
    });

    const detail = await supertest(server)
      .get(`/api/v1/admin/subscriptions/payments/${payment.id}`)
      .set(auth(admin1Token));
    expect(detail.status).toBe(200);
    expect((detail.body.payment as { proofUrl: string }).proofUrl).toMatch(/^memory:\/\//);

    const before = new Date();
    const approve = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(admin1Token));
    expect(approve.status).toBe(200);
    const sub = approve.body.subscription as {
      status: string;
      canAcceptBookings: boolean;
      paidEndsAt: string;
      paidGraceEndsAt: string;
    };
    expect(sub.status).toBe('ACTIVE');
    expect(sub.canAcceptBookings).toBe(true);
    const paidEndsAt = new Date(sub.paidEndsAt).getTime();
    const minExpected = new Date(before.getTime() + 29 * 86_400_000).getTime();
    const maxExpected = new Date(before.getTime() + 31 * 86_400_000).getTime();
    expect(paidEndsAt).toBeGreaterThan(minExpected);
    expect(paidEndsAt).toBeLessThan(maxExpected);
    expect(new Date(sub.paidGraceEndsAt).getTime()).toBe(paidEndsAt + 5 * 86_400_000);

    const history = await superuser.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM subscription_status_history
        WHERE business_id = $1 AND from_status='TRIAL' AND to_status='ACTIVE' AND actor_type='ADMIN'`,
      [id],
    );
    expect(history.rows[0].count).toBe(1);
    expect(await securityEventCount('SUBSCRIPTION_PAYMENT_APPROVED')).toBe(1);

    const ownerView = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(ownerToken));
    expect((ownerView.body.subscription as { status: string }).status).toBe('ACTIVE');
    expect((ownerView.body.subscription as { paidEndsAt: string }).paidEndsAt).not.toBeNull();
  });

  it('rejects a second review of the same payment with a Conflict', async () => {
    const { id } = await createBusiness();
    const payment = await submitPayment(id);
    const first = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(admin1Token));
    expect(first.status).toBe(200);
    const second = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(admin2Token));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');

    const rows = await superqueryPaymentStatus(payment.id);
    expect(rows.rows[0].reviewed_by_user_id).toBeTruthy();
  });

  it('a concurrent double-approve settles exactly one winner', async () => {
    const { id } = await createBusiness();
    const payment = await submitPayment(id);
    const [a, b] = await Promise.all([
      supertest(server)
        .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
        .set(auth(admin1Token)),
      supertest(server)
        .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
        .set(auth(admin2Token)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const rows = await superqueryPaymentStatus(payment.id);
    expect(rows.rows[0].status).toBe('APPROVED');
  });
});

describe('C: rejection with reason (REQ-138)', () => {
  it('rejects a payment, keeps the subscription TRIAL, and notifies the owner', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    const payment = await submitPayment(id);

    const reject = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/reject`)
      .send({ reason: 'Proof image is unreadable' })
      .set(auth(admin1Token));
    expect(reject.status).toBe(200);
    expect((reject.body.payment as { status: string }).status).toBe('REJECTED');
    const full = await superqueryPaymentStatus(payment.id);
    expect(full.rows[0].rejection_reason).toBe('Proof image is unreadable');
    expect(await securityEventCount('SUBSCRIPTION_PAYMENT_REJECTED')).toBe(1);

    const rejectionReplay = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/reject`)
      .send({ reason: 'again' })
      .set(auth(admin2Token));
    expect(rejectionReplay.status).toBe(409);

    const ownerView = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(ownerToken));
    expect((ownerView.body.subscription as { status: string }).status).toBe('TRIAL');

    await fanOutAndProcess();
    const email = mail.captured.find((m) => m.subject === 'Your subscription payment was rejected');
    expect(email).toBeDefined();
    expect(email!.to).toBe('owner@werefa.test');
    expect(email!.text).toContain('Proof image is unreadable');
    const locals = await deliveryRows(id, 'SUBSCRIPTION_PAYMENT_REJECTED_OWNER');
    expect(locals.rows).toHaveLength(1);
    expect(locals.rows[0].status).toBe('SENT');
  });

  it('rejects an invalid rejection reason', async () => {
    const { id } = await createBusiness();
    const payment = await submitPayment(id);
    const res = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/reject`)
      .send({ reason: 'no' })
      .set(auth(admin1Token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('D: a reviewer can never review their own business', () => {
  it('returns 403 FORBIDDEN', async () => {
    const { id } = await createBusiness();
    const adminUserId = await superuser
      .query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [TEST_EMAILS.admin1])
      .then((r) => r.rows[0].id);
    await superuser.query('INSERT INTO business_owner (business_id, user_id) VALUES ($1, $2)', [
      id,
      adminUserId,
    ]);
    const payment = await submitPayment(id);

    const approve = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(admin1Token));
    expect(approve.status).toBe(403);
    expect(approve.body.error.code).toBe('FORBIDDEN');

    const ownerView = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(ownerToken));
    expect((ownerView.body.subscription as { status: string }).status).toBe('TRIAL');
  });
});

describe('E: RLS & scope isolation (doc 15 §7)', () => {
  it('blocks a foreign owner and keeps audit Super-Admin only', async () => {
    const { id } = await createBusiness();
    const payment = await submitPayment(id);

    const foreign = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(owner2Token));
    expect(foreign.status).toBe(403);

    const ownerOnQueue = await supertest(server)
      .get('/api/v1/admin/subscriptions/payments')
      .set(auth(ownerToken));
    expect(ownerOnQueue.status).toBe(403);

    const adminOnAudit = await supertest(server)
      .get(`/api/v1/super-admin/subscriptions/payments/${payment.id}`)
      .set(auth(admin1Token));
    expect(adminOnAudit.status).toBe(403);

    const sa = await supertest(server)
      .get(`/api/v1/super-admin/subscriptions/payments/${payment.id}`)
      .set(auth(saToken));
    expect(sa.status).toBe(200);
    const audit = sa.body as {
      payment: { businessName: string };
      subscription: { status: string } | null;
      history: unknown[];
    };
    expect(audit.payment.businessName).toContain('Subscription Biz');
    expect(audit.subscription?.status).toBe('TRIAL');
    expect(audit.history).toEqual([]);
  });

  it('lets Super Admin approve and records a SUPER_ADMIN actor type', async () => {
    const { id } = await createBusiness();
    const payment = await submitPayment(id);
    const approve = await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(saToken));
    expect(approve.status).toBe(200);
    const history = await superuser.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM subscription_status_history
        WHERE business_id = $1 AND actor_type='SUPER_ADMIN'`,
      [id],
    );
    expect(history.rows[0].count).toBe(1);
  });
});

describe('F: notification delivery (REQ-139/140)', () => {
  it('fans a payment submission out to exactly two Admin EMAILs', async () => {
    const { id } = await createBusiness();
    await submitPayment(id);
    await fanOutAndProcess();

    const rows = await deliveryRows(id, 'SUBSCRIPTION_PAYMENT_SUBMITTED_ADMIN');
    expect(rows.rows).toHaveLength(2);
    const recipients = rows.rows.map((r) => r.recipient).sort();
    expect(recipients).toEqual([TEST_EMAILS.admin1, TEST_EMAILS.admin2].sort());
    expect(rows.rows.every((r) => r.status === 'SENT')).toBe(true);

    const emails = mail.captured.filter((m) => m.subject?.startsWith('New subscription payment:'));
    expect(emails).toHaveLength(2);
    expect(emails.every((m) => m.text.includes('ETB 1500.00'))).toBe(true);
  });

  it('delivers an approval email to the business contact', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    const payment = await submitPayment(id);
    await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(admin1Token));
    await fanOutAndProcess();

    const email = mail.captured.find((m) => m.subject === 'Your subscription payment was approved');
    expect(email).toBeDefined();
    expect(email!.to).toBe('owner@werefa.test');

    const rows = await deliveryRows(id, 'SUBSCRIPTION_PAYMENT_APPROVED_OWNER');
    expect(rows.rows[0].status).toBe('SENT');
  });

  it('suppresses a reminder that is no longer due (stale-safe)', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    await superuser.query(
      `INSERT INTO notification (business_id, tenant_scope, type, payload)
       VALUES ($1, 'SUBSCRIPTION', 'SUBSCRIPTION_REMINDER_PAID_END', '{}'::jsonb)`,
      [id],
    );
    await fanOutAndProcess();
    const rows = await deliveryRows(id, 'SUBSCRIPTION_REMINDER_PAID_END');
    expect(rows.rows[0].status).toBe('SUPPRESSED');
    expect(rows.rows[0].last_error).toBe('stale subscription reminder');
    expect(mail.captured.length).toBe(0);
  });

  it('queues and delivers a due PAID_END reminder exactly once', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    await superuser.query(
      `UPDATE subscription SET
         paid_period_start_at = date_trunc('minute', now()) - interval '29 days',
         paid_ends_at = date_trunc('minute', now()) + interval '1 day',
         paid_grace_ends_at = date_trunc('minute', now()) + interval '6 days',
         status = 'ACTIVE', updated_at = now()
       WHERE business_id = $1`,
      [id],
    );
    expect(await job.queueDueReminders()).toBe(1);
    expect(await job.queueDueReminders()).toBe(0); // dedup window (7d)

    await fanOutAndProcess();
    const email = mail.captured.find(
      (m) => m.subject === 'Your subscription period is ending soon',
    );
    expect(email).toBeDefined();
    expect(email!.to).toBe('owner@werefa.test');
    const rows = await deliveryRows(id, 'SUBSCRIPTION_REMINDER_PAID_END');
    expect(rows.rows[0].status).toBe('SENT');
  });
});

describe('G: lifecycle & booking gating (REQ-131/134/157)', () => {
  it('blocks availability + resume when EXPIRED and persists the transition', async () => {
    const { id, slug } = await createBusiness();
    const service = await supertest(server)
      .post(`/api/v1/businesses/${id}/services`)
      .send({ name: 'Cut & Style', basePriceMinor: 4500, baseDurationMinutes: 30 })
      .set(auth(ownerToken));
    expect([200, 201]).toContain(service.status);
    const serviceId = (service.body.service as { id: string }).id;
    await superuser.query(
      `UPDATE subscription SET trial_ends_at = date_trunc('minute', now()) - interval '5 days',
         paid_period_start_at = NULL, paid_ends_at = NULL, paid_grace_ends_at = NULL,
         status = 'TRIAL'
       WHERE business_id = $1`,
      [id],
    );

    const expired = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription`)
      .set(auth(ownerToken));
    expect((expired.body.subscription as { status: string }).status).toBe('EXPIRED');
    expect((expired.body.subscription as { canAcceptBookings: boolean }).canAcceptBookings).toBe(
      false,
    );

    const availability = await supertest(server)
      .post(`/api/v1/public/businesses/${slug}/bookings/availability`)
      .send({
        startAt: wholeMinuteInFuture(2),
        services: [{ serviceId, addOnIds: [] }],
      })
      .set(CSRF);
    expect(availability.status).toBe(409);
    expect(availability.body.error.code).toBe('SUBSCRIPTION_EXPIRED');

    await supertest(server).post(`/api/v1/businesses/${id}/pause`).send({}).set(auth(ownerToken));
    expect((await superqueryIsPaused(id)).rows[0].is_paused).toBe(true);

    const resume = await supertest(server)
      .post(`/api/v1/businesses/${id}/resume`)
      .set(auth(ownerToken));
    expect(resume.status).toBe(402);
    expect(resume.body.error.code).toBe('SUBSCRIPTION_EXPIRED');

    expect(await job.refreshStatuses()).toBeGreaterThanOrEqual(1);
    const persisted = await superuser.query<{ status: string }>(
      'SELECT status FROM subscription WHERE business_id = $1',
      [id],
    );
    expect(persisted.rows[0].status).toBe('EXPIRED');
    const hist = await superuser.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM subscription_status_history
        WHERE business_id = $1 AND from_status='TRIAL' AND to_status='EXPIRED' AND actor_type='SYSTEM'`,
      [id],
    );
    expect(hist.rows[0].count).toBe(1);

    const history = await supertest(server)
      .get(`/api/v1/businesses/${id}/subscription/history`)
      .set(auth(ownerToken));
    expect((history.body as { history: unknown[] }).history).toHaveLength(1);
  });

  it('auto-resume respects the subscription (denied → reopened after approval)', async () => {
    const { id } = await createBusiness('owner@werefa.test');
    await supertest(server).post(`/api/v1/businesses/${id}/pause`).send({}).set(auth(ownerToken));
    await superuser.query(
      "UPDATE business SET paused_until = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    await superuser.query(
      `UPDATE subscription SET trial_ends_at = date_trunc('minute', now()) - interval '5 days',
         paid_period_start_at = NULL, paid_ends_at = NULL, paid_grace_ends_at = NULL
       WHERE business_id = $1`,
      [id],
    );

    expect(await businesses.autoResumeDueBusinesses()).toEqual({ resumed: 0, denied: 1 });
    expect(await securityEventCount('BUSINESS_AUTO_RESUME_DENIED')).toBe(1);
    expect((await superqueryIsPaused(id)).rows[0].is_paused).toBe(true);

    const payment = await submitPayment(id);
    const approved = await superuser.query<{ paid_ends_at: Date }>(
      `SELECT paid_ends_at FROM subscription WHERE business_id = $1`,
      [id],
    );
    expect(approved.rows[0].paid_ends_at).toBeNull();
    await supertest(server)
      .post(`/api/v1/admin/subscriptions/payments/${payment.id}/approve`)
      .set(auth(admin1Token));

    expect(await businesses.autoResumeDueBusinesses()).toEqual({ resumed: 1, denied: 0 });
    expect((await superqueryIsPaused(id)).rows[0].is_paused).toBe(false);
    expect(await securityEventCount('BUSINESS_AUTO_RESUME')).toBe(1);
  });
});

function superqueryPaymentStatus(paymentId: string) {
  return superuser.query<{
    status: string;
    reviewed_by_user_id: string | null;
    rejection_reason: string | null;
  }>(
    'SELECT status, reviewed_by_user_id, rejection_reason FROM subscription_payment WHERE id = $1',
    [paymentId],
  );
}

function superqueryIsPaused(businessId: string) {
  return superuser.query<{ is_paused: boolean }>('SELECT is_paused FROM business WHERE id = $1', [
    businessId,
  ]);
}
