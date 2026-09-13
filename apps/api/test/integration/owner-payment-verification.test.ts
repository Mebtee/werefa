/**
 * Prompt 23 — Owner payment-proof verification integration tests (REQ-065/066/
 * 067/068/119/120) over HTTP + the delivery pipeline + the shared Telegram
 * webhook:
 *
 *  A) REQ-119 dashboard proof retrieval: presigned URL + metadata, audit event,
 *     unknown proof 404, Owner-only (Admin/Super Admin 403), cross-owner 403.
 *  B) REQ-065/066 owner notification: owner-chat fan-out, image vs PDF
 *     attachment, required content, SUPPRESSED without a chat, idempotent
 *     fan-out, provider failure → retry → SENT.
 *  C) REQ-067/120 Accept from Telegram: confirms through the authoritative
 *     booking service, customer confirmation notification, replay/duplicate
 *     idempotency, expired/unauthorized/revoked denial, dashboard-vs-Telegram
 *     concurrency.
 *  D) REQ-068 Reject from Telegram: mandatory reason (blank/too-long rejected),
 *     two-step completion, reason persisted, replay/expiry denial, customer
 *     rejection notification with reason, cross-identity denial.
 *  E) Regression: dashboard Accept/Reject and the customer Telegram flow.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { MailService } from '../../src/notifications/mail.service';
import { NotificationDispatcher } from '../../src/notifications/notification-dispatcher';
import { TELEGRAM_PROVIDER, FakeTelegramProvider } from '../../src/notifications/providers';
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
const SLUG_A = 'owner-verify-a';
const SLUG_B = 'owner-verify-b';
const SERVICE = { name: 'Cut & Style', basePriceMinor: 7500, baseDurationMinutes: 30 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n%%EOF\n', 'utf8');

interface BookingDto {
  id: string;
  status: string;
  customerPhone: string;
  customerName: string;
  startAt: string;
}

interface OwnerTokens {
  caption: string;
  accept: string;
  reject: string;
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let superuser: Client;
let businessA: string;
let businessB: string;
let telegram: FakeTelegramProvider;
let mail: MailService;
let dispatcher: NotificationDispatcher;
let phoneSeq = 0;
let updateSeq = 0;

async function login(email: string, password: string): Promise<string> {
  const res = await supertest(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .set(CSRF);
  const token = extractSessionToken(res.header?.['set-cookie'] as string[] | undefined);
  if (!token) throw new Error(`Login failed for ${email}`);
  return token;
}

const owner1Token = () => login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
const owner2Token = () => login(TEST_EMAILS.owner2, TEST_PASSWORDS.owner);
const adminToken = () => login(TEST_EMAILS.admin1, TEST_PASSWORDS.admin);
const saToken = () => login(TEST_EMAILS.sa, TEST_PASSWORDS.sa);

function auth(token: string): { Cookie: string; 'x-requested-with': string } {
  return { Cookie: `wrf.sid=${token}`, 'x-requested-with': 'fetch' };
}

function freshPhone(): string {
  phoneSeq += 1;
  return `+251${(800000000 + phoneSeq).toString().slice(-9)}`;
}

function wholeMinuteInFuture(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setSeconds(0, 0);
  return d.toISOString();
}

async function createBusiness(name: string, slug: string, token: string): Promise<string> {
  const res = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name, publicSlug: slug })
    .set(auth(token));
  expect(res.status).toBe(201);
  return (res.body.business as { id: string }).id;
}

async function seedService(businessId: string, token: string): Promise<void> {
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/services`)
    .send(SERVICE)
    .set(auth(token));
  expect([200, 201]).toContain(res.status);
}

async function createBooking(
  slug: string,
  businessId: string,
  file: Buffer = PNG,
  filename = 'proof.png',
  hoursFromNow = 2,
): Promise<BookingDto> {
  const token = await owner1Token();
  const serviceList = await supertest(server)
    .get(`/api/v1/businesses/${businessId}/services`)
    .set(auth(token));
  const serviceId = (serviceList.body.services as { id: string }[])[0]!.id;
  const phone = freshPhone();
  const res = await supertest(server)
    .post(`/api/v1/public/businesses/${slug}/bookings`)
    .field('customerName', 'Selam Test')
    .field('customerPhone', phone)
    .field('startAt', wholeMinuteInFuture(hoursFromNow))
    .field('paymentMethod', 'BANK_TRANSFER')
    .field('submissionKey', crypto.randomUUID())
    .field('services', JSON.stringify([{ serviceId, addOnIds: [] }]))
    .attach('file', file, filename);
  expect([200, 201]).toContain(res.status);
  const booking = (res.body as { booking: BookingDto }).booking;
  return { ...booking, customerPhone: phone };
}

/** Owner connects a business Telegram chat: connect (owner) then `/start <token>`. */
async function connectOwnerChat(businessId: string, chatId: number): Promise<void> {
  const token = await owner1Token();
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/telegram/connect`)
    .set(auth(token));
  expect([200, 201]).toContain(res.status);
  const body = res.body.telegram as { connected: boolean; token?: string; botUsername?: string };
  expect(body.connected).toBe(false);
  expect(typeof body.token).toBe('string');
  expect(body.botUsername).toBe('werefa_test_bot');
  const bound = await webhookStart(++updateSeq, chatId, body.token!);
  expect(bound.body).toEqual({ ok: true });
  const status = await supertest(server)
    .get(`/api/v1/businesses/${businessId}/telegram/status`)
    .set(auth(token));
  expect(status.body).toEqual({ telegram: { connected: true } });
}

async function connectCustomerChat(
  slug: string,
  bookingId: string,
  phone: string,
  chatId: number,
): Promise<void> {
  const started = await supertest(server)
    .post(`/api/v1/public/businesses/${slug}/bookings/${bookingId}/telegram/connect`)
    .send({ phone })
    .set(CSRF);
  expect([200, 201]).toContain(started.status);
  const token = (started.body as { token?: string }).token;
  expect(typeof token).toBe('string');
  const bound = await webhookStart(++updateSeq, chatId, token!);
  expect(bound.body).toEqual({ ok: true });
}

function webhookRaw(body: unknown) {
  return supertest(server)
    .post('/api/v1/telegram/webhook')
    .send(body)
    .set('x-telegram-bot-api-secret-token', process.env.TG_WEBHOOK_SECRET!)
    .set(CSRF);
}

function webhookStart(updateId: number, chatId: number, token: string) {
  return webhookRaw({
    update_id: updateId,
    message: { chat: { id: chatId }, text: `/start ${token}` },
  });
}

function webhookCallback(updateId: number, chatId: number, data: string) {
  return webhookRaw({
    update_id: updateId,
    callback_query: { id: `cbq-${updateId}`, data, message: { chat: { id: chatId } } },
  });
}

function webhookText(updateId: number, chatId: number, text: string) {
  return webhookRaw({ update_id: updateId, message: { chat: { id: chatId }, text } });
}

/** Fan out + dispatch, then return the (single) owner proof media tokens. */
async function deliverOwnerProof(): Promise<OwnerTokens> {
  const created = await dispatcher.fanOutDue();
  expect(created).toBeGreaterThan(0);
  const stats = await dispatcher.processDue();
  expect(stats.failed + stats.deadLettered).toBe(0);
  const media = telegram.media[telegram.media.length - 1];
  expect(media).toBeDefined();
  const keyboard = media.replyMarkup!.inlineKeyboard[0];
  return {
    caption: media.text,
    accept: keyboard[0]!.callbackData.split(':')[2]!,
    reject: keyboard[1]!.callbackData.split(':')[2]!,
  };
}

async function bookingState(
  bookingId: string,
): Promise<{ status: string; payment: string | null }> {
  const row = await superuser.query<{ status: string; payment: string | null }>(
    `SELECT b.status, p.status AS payment
       FROM booking b LEFT JOIN payment p ON p.booking_id = b.id
      WHERE b.id = $1`,
    [bookingId],
  );
  return row.rows[0]!;
}

async function historyCount(bookingId: string): Promise<number> {
  const row = await superuser.query<{ c: number }>(
    'SELECT count(*)::int AS c FROM booking_status_history WHERE booking_id = $1',
    [bookingId],
  );
  return row.rows[0]!.c;
}

async function rejectionReasons(bookingId: string): Promise<string[]> {
  const rows = await superuser.query<{ reason: string }>(
    `SELECT pre.reason FROM payment_rejection_event pre
       JOIN payment p ON p.id = pre.payment_id
      WHERE p.booking_id = $1 ORDER BY pre.created_at`,
    [bookingId],
  );
  return rows.rows.map((r) => r.reason);
}

async function securityEventCount(type: string): Promise<number> {
  return superuser
    .query<{ c: number }>('SELECT count(*)::int AS c FROM security_event WHERE type = $1', [type])
    .then((r) => r.rows[0]!.c);
}

async function ownerDeliveryFor(bookingId: string) {
  return superuser.query<{ status: string; recipient: string; last_error: string | null }>(
    `SELECT nd.status, nd.recipient, nd.last_error
       FROM notification_delivery nd JOIN notification n ON n.id = nd.notification_id
      WHERE n.booking_id = $1 AND n.type = 'BOOKING_NEW_PROOF_OWNER'`,
    [bookingId],
  );
}

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.STORAGE_PROVIDER = 'memory';
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
  process.env.RATE_LIMIT_MAX = '1000';
  process.env.TELEGRAM_CONNECT_RATE_LIMIT_MAX = '1000';
  process.env.OWNER_TELEGRAM_ACTION_RATE_LIMIT_MAX = '1000';
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
  telegram = app.get(TELEGRAM_PROVIDER) as FakeTelegramProvider;
  mail = app.get(MailService);
  dispatcher = app.get(NotificationDispatcher);

  const supertestModule = await import('supertest');
  supertest = (supertestModule.default ?? supertestModule) as typeof import('supertest');

  await resetIdentityDatabaseAndSeed(process.env.DATABASE_MIGRATOR_URL!);

  const { Client } = await import('pg');
  superuser = new Client({ connectionString: process.env.DATABASE_URL_SUPERUSER! });
  await superuser.connect();
  await superuser.query('TRUNCATE business_owner, business CASCADE');

  businessA = await createBusiness('Owner Verify A', SLUG_A, await owner1Token());
  businessB = await createBusiness('Owner Verify B', SLUG_B, await owner2Token());
});

afterAll(async () => {
  await superuser?.end();
  await app?.close();
});

beforeEach(async () => {
  await superuser.query(
    'TRUNCATE "booking", "service", "service_variation", "add_on", "security_event" CASCADE',
  );
  await superuser.query('TRUNCATE telegram_update');
  await superuser.query('TRUNCATE owner_telegram_action');
  await superuser.query('TRUNCATE business_owner_telegram_connection');
  telegram.reset();
  mail.captured.length = 0;
});

describe('A: REQ-119 owner dashboard proof retrieval', () => {
  it('returns a short-lived read URL + metadata for the booking proof and audits the read', async () => {
    await seedService(businessA, await owner1Token());
    const booking = await createBooking(SLUG_A, businessA);
    const token = await owner1Token();
    const proof = await superuser.query<{ id: string }>(
      `SELECT pp.id FROM payment_proof pp
         JOIN payment p ON p.id = pp.payment_id WHERE p.booking_id = $1`,
      [booking.id],
    );
    expect(proof.rows).toHaveLength(1);

    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessA}/bookings/${booking.id}/proofs/${proof.rows[0]!.id}`)
      .set(auth(token));
    expect(res.status).toBe(200);
    const body = res.body.proof as {
      url: string | null;
      mime: string;
      sizeBytes: number;
      submittedAt: string;
    };
    expect(body.mime).toBe('image/png');
    expect(body.sizeBytes).toBe(PNG.length);
    expect(typeof body.url).toBe('string');
    // The raw storage key is never returned as a bare field.
    expect(Object.keys(res.body.proof as object).sort()).toEqual([
      'mime',
      'sizeBytes',
      'submittedAt',
      'url',
    ]);
    expect(res.header['cache-control']).toBe('no-store');
    expect(await securityEventCount('PAYMENT_PROOF_VIEWED')).toBe(1);
  });

  it('404s an unknown proof id and a proof that belongs to another booking', async () => {
    await seedService(businessA, await owner1Token());
    const first = await createBooking(SLUG_A, businessA, PNG, 'proof.png', 2);
    const second = await createBooking(SLUG_A, businessA, PNG, 'proof.png', 4);
    const token = await owner1Token();
    const otherProof = await superuser.query<{ id: string }>(
      `SELECT pp.id FROM payment_proof pp JOIN payment p ON p.id = pp.payment_id WHERE p.booking_id = $1`,
      [second.id],
    );

    const unknown = await supertest(server)
      .get(`/api/v1/businesses/${businessA}/bookings/${first.id}/proofs/${crypto.randomUUID()}`)
      .set(auth(token));
    expect(unknown.status).toBe(404);

    const crossBooking = await supertest(server)
      .get(`/api/v1/businesses/${businessA}/bookings/${first.id}/proofs/${otherProof.rows[0]!.id}`)
      .set(auth(token));
    expect(crossBooking.status).toBe(404);
  });

  it('forbids another owner from reading the proof (tenant isolation)', async () => {
    await seedService(businessA, await owner1Token());
    const booking = await createBooking(SLUG_A, businessA);
    const proof = await superuser.query<{ id: string }>(
      `SELECT pp.id FROM payment_proof pp JOIN payment p ON p.id = pp.payment_id WHERE p.booking_id = $1`,
      [booking.id],
    );
    const token = await owner2Token();
    const res = await supertest(server)
      .get(`/api/v1/businesses/${businessA}/bookings/${booking.id}/proofs/${proof.rows[0]!.id}`)
      .set(auth(token));
    expect(res.status).toBe(403);
    expect(await securityEventCount('PAYMENT_PROOF_VIEWED')).toBe(0);
  });

  it('forbids Admin and Super Admin from the Owner-only proof endpoint', async () => {
    await seedService(businessA, await owner1Token());
    const booking = await createBooking(SLUG_A, businessA);
    const proof = await superuser.query<{ id: string }>(
      `SELECT pp.id FROM payment_proof pp JOIN payment p ON p.id = pp.payment_id WHERE p.booking_id = $1`,
      [booking.id],
    );
    const url = `/api/v1/businesses/${businessA}/bookings/${booking.id}/proofs/${proof.rows[0]!.id}`;
    for (const token of [await adminToken(), await saToken()]) {
      const res = await supertest(server).get(url).set(auth(token));
      expect(res.status).toBe(403);
    }
    expect(await securityEventCount('PAYMENT_PROOF_VIEWED')).toBe(0);
  });

  it('requires authentication', async () => {
    await seedService(businessA, await owner1Token());
    const booking = await createBooking(SLUG_A, businessA);
    const res = await supertest(server).get(
      `/api/v1/businesses/${businessA}/bookings/${booking.id}/proofs/${crypto.randomUUID()}`,
    );
    expect(res.status).toBe(401);
  });
});

describe('B: REQ-065/066 owner Telegram notification', () => {
  it('delivers the image proof to the connected owner chat with Accept/Reject controls', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 810000001;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);

    const tokens = await deliverOwnerProof();
    expect(telegram.media).toHaveLength(1);
    expect(telegram.media[0]!.chatId).toBe(BigInt(chatId));
    expect(telegram.media[0]!.mime).toBe('image/png');
    expect(tokens.accept).toHaveLength(43);
    expect(tokens.reject).toHaveLength(43);
    expect(tokens.accept).not.toBe(tokens.reject);

    const rows = await ownerDeliveryFor(booking.id);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status).toBe('SENT');
    expect(rows.rows[0]!.recipient).toBe(String(chatId));
  });

  it('contains every fact the owner needs to identify the payment', async () => {
    await seedService(businessA, await owner1Token());
    await connectOwnerChat(businessA, 810000002);
    await createBooking(SLUG_A, businessA);
    const { caption } = await deliverOwnerProof();
    expect(caption).toContain('Owner Verify A');
    expect(caption).toContain('Selam Test');
    expect(caption).toMatch(/\+2518\d{8}/);
    expect(caption).toContain('Cut & Style');
    expect(caption).toContain('Bank transfer');
    expect(caption).toContain('ETB 75.00');
    expect(caption).not.toContain('pv:');
  });

  it('delivers a PDF proof as a document', async () => {
    await seedService(businessA, await owner1Token());
    await connectOwnerChat(businessA, 810000003);
    await createBooking(SLUG_A, businessA, PDF, 'proof.pdf');
    await deliverOwnerProof();
    expect(telegram.media).toHaveLength(1);
    expect(telegram.media[0]!.mime).toBe('application/pdf');
  });

  it('suppresses the owner intent when no owner chat is connected', async () => {
    await seedService(businessA, await owner1Token());
    const booking = await createBooking(SLUG_A, businessA);
    await dispatcher.fanOutDue();
    await dispatcher.processDue();
    const rows = await ownerDeliveryFor(booking.id);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status).toBe('SUPPRESSED');
    expect(rows.rows[0]!.last_error).toContain('no connected owner chat');
    expect(telegram.media).toHaveLength(0);
  });

  it('is idempotent — a second fan-out creates no duplicate owner intents', async () => {
    await seedService(businessA, await owner1Token());
    await connectOwnerChat(businessA, 810000004);
    const booking = await createBooking(SLUG_A, businessA);
    expect(await dispatcher.fanOutDue()).toBeGreaterThan(0);
    expect(await dispatcher.fanOutDue()).toBe(0);
    const rows = await ownerDeliveryFor(booking.id);
    expect(rows.rows).toHaveLength(1);
  });

  it('retries a provider failure with backoff and succeeds once the channel recovers', async () => {
    await seedService(businessA, await owner1Token());
    await connectOwnerChat(businessA, 810000005);
    const booking = await createBooking(SLUG_A, businessA);

    telegram.mode = 'fail-all';
    await dispatcher.fanOutDue();
    const failed = await dispatcher.processDue();
    expect(failed.failed).toBeGreaterThan(0);
    expect(telegram.media).toHaveLength(0);
    const failRow = await superuser.query<{ id: string; attempts: number; next_attempt_at: Date }>(
      `SELECT nd.id, nd.attempts, nd.next_attempt_at
         FROM notification_delivery nd JOIN notification n ON n.id = nd.notification_id
        WHERE n.booking_id = $1 AND n.type = 'BOOKING_NEW_PROOF_OWNER'`,
      [booking.id],
    );
    expect(failRow.rows[0]!.attempts).toBe(1);
    expect(new Date(failRow.rows[0]!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    telegram.mode = 'ok';
    await superuser.query(
      `UPDATE notification_delivery SET next_attempt_at = now() - interval '1 second' WHERE id = $1`,
      [failRow.rows[0]!.id],
    );
    await dispatcher.processDue();
    const after = await superuser.query<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>('SELECT status, attempts, last_error FROM notification_delivery WHERE id = $1', [
      failRow.rows[0]!.id,
    ]);
    expect({ status: after.rows[0]!.status, error: after.rows[0]!.last_error }).toEqual({
      status: 'SENT',
      error: null,
    });
    expect(after.rows[0]!.attempts).toBe(2);
    expect(telegram.media).toHaveLength(1);
  });
});

describe('C: REQ-067/120 Accept from Telegram', () => {
  it('accepts the booking through the authoritative service and confirms it', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000001;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    const res = await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);
    expect(res.body).toEqual({ ok: true });
    const state = await bookingState(booking.id);
    expect(state.status).toBe('CONFIRMED');
    expect(state.payment).toBe('ACCEPTED');
    expect(await historyCount(booking.id)).toBe(2);
    expect(await securityEventCount('TELEGRAM_ACTION_ACCEPTED')).toBe(1);
  });

  it('notifies the connected customer after a Telegram accept', async () => {
    await seedService(businessA, await owner1Token());
    const ownerChat = 820000002;
    const customerChat = 820000003;
    await connectOwnerChat(businessA, ownerChat);
    const booking = await createBooking(SLUG_A, businessA);
    await connectCustomerChat(SLUG_A, booking.id, booking.customerPhone, customerChat);
    const { accept } = await deliverOwnerProof();
    await webhookCallback(++updateSeq, ownerChat, `pv:accept:${accept}`);

    const sentBefore = telegram.sent.length;
    await dispatcher.fanOutDue();
    await dispatcher.processDue();
    const customerMessages = telegram.sent
      .slice(sentBefore)
      .filter((m) => m.chatId === BigInt(customerChat));
    expect(customerMessages.length).toBeGreaterThan(0);
  });

  it('is idempotent for a replayed accept and an exact duplicate callback', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000004;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    const firstUpdate = ++updateSeq;
    await webhookCallback(firstUpdate, chatId, `pv:accept:${accept}`);
    // Exact duplicate delivery of the same update (at-most-once).
    await webhookCallback(firstUpdate, chatId, `pv:accept:${accept}`);
    // Same token replayed in a new update.
    await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);

    const state = await bookingState(booking.id);
    expect(state.status).toBe('CONFIRMED');
    expect(await historyCount(booking.id)).toBe(2);
    expect(await securityEventCount('TELEGRAM_ACTION_REUSED')).toBeGreaterThanOrEqual(1);
  });

  it('expires an unused action token and refuses it', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000005;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    await superuser.query(
      `UPDATE owner_telegram_action SET expires_at = now() - interval '1 minute'
        WHERE kind = 'ACCEPT' AND business_id = $1`,
      [businessA],
    );
    await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('PAYMENT_PENDING');
    expect(state.payment).toBe('PENDING');
    expect(await securityEventCount('TELEGRAM_ACTION_EXPIRED')).toBe(1);
  });

  it('refuses an action executed by a different chat (wrong owner / cross-business)', async () => {
    await seedService(businessA, await owner1Token());
    await seedService(businessB, await owner2Token());
    const ownerAChat = 820000006;
    const ownerBChat = 820000007;
    await connectOwnerChat(businessA, ownerAChat);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, ownerBChat, `pv:accept:${accept}`);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('PAYMENT_PENDING');
    expect(await securityEventCount('TELEGRAM_ACTION_UNAUTHORIZED')).toBe(1);
    expect(await securityEventCount('TELEGRAM_ACTION_ACCEPTED')).toBe(0);
  });

  it('refuses a customer Telegram chat attempting an owner action', async () => {
    await seedService(businessA, await owner1Token());
    const ownerChat = 820000008;
    const customerChat = 820000009;
    await connectOwnerChat(businessA, ownerChat);
    const booking = await createBooking(SLUG_A, businessA);
    await connectCustomerChat(SLUG_A, booking.id, booking.customerPhone, customerChat);
    const { accept } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, customerChat, `pv:accept:${accept}`);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('PAYMENT_PENDING');
    expect(await securityEventCount('TELEGRAM_ACTION_UNAUTHORIZED')).toBe(1);
  });

  it('refuses an action from a revoked/disconnected owner identity', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000010;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    const token = await owner1Token();
    const dis = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/telegram/disconnect`)
      .set(auth(token));
    expect([200, 201]).toContain(dis.status);
    expect(await securityEventCount('TELEGRAM_OWNER_DISCONNECTED')).toBe(1);

    await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('PAYMENT_PENDING');
    expect(await securityEventCount('TELEGRAM_ACTION_UNAUTHORIZED')).toBe(1);
    expect(await securityEventCount('TELEGRAM_ACTION_ACCEPTED')).toBe(0);
  });

  it('is safe when the dashboard accepts first (no double transition)', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000011;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    const token = await owner1Token();
    const dash = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/bookings/${booking.id}/accept`)
      .set(auth(token));
    expect(dash.status).toBe(200);

    await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('CONFIRMED');
    expect(await historyCount(booking.id)).toBe(2);
    expect(await securityEventCount('TELEGRAM_ACTION_ACCEPTED')).toBe(1);
  });

  it('is safe when Telegram accepts first (dashboard then gets a conflict)', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000012;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);
    const token = await owner1Token();
    const dash = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/bookings/${booking.id}/accept`)
      .set(auth(token));
    expect(dash.status).toBe(409);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('CONFIRMED');
    expect(await historyCount(booking.id)).toBe(2);
  });

  it('is safe when the dashboard rejected first (Telegram cannot revive it)', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 820000013;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { accept } = await deliverOwnerProof();

    const token = await owner1Token();
    const dash = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/bookings/${booking.id}/reject`)
      .send({ reason: 'proof unreadable' })
      .set(auth(token));
    expect(dash.status).toBe(200);

    await webhookCallback(++updateSeq, chatId, `pv:accept:${accept}`);
    const state = await bookingState(booking.id);
    expect(state.status).toBe('REJECTED');
    expect(await historyCount(booking.id)).toBe(2);
  });
});

describe('D: REQ-068 Reject from Telegram', () => {
  it('requires a reason: a blank reply does not reject the booking', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 830000001;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { reject } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, chatId, `pv:reject:${reject}`);
    await webhookText(++updateSeq, chatId, '   ');
    const state = await bookingState(booking.id);
    expect(state.status).toBe('PAYMENT_PENDING');
    expect(state.payment).toBe('PENDING');
    expect(await securityEventCount('TELEGRAM_ACTION_REJECTED')).toBe(1); // prompt only

    const row = await superuser.query<{ status: string }>(
      'SELECT status FROM owner_telegram_action WHERE kind = $1 AND business_id = $2',
      ['REJECT', businessA],
    );
    expect(row.rows[0]!.status).toBe('AWAITING_REASON');
  });

  it('rejects a too-long reason and keeps the pending state usable', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 830000002;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { reject } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, chatId, `pv:reject:${reject}`);
    await webhookText(++updateSeq, chatId, 'x'.repeat(501));
    expect((await bookingState(booking.id)).status).toBe('PAYMENT_PENDING');

    // A valid reason afterwards still completes the rejection.
    await webhookText(++updateSeq, chatId, 'payment not received');
    const state = await bookingState(booking.id);
    expect(state.status).toBe('REJECTED');
    expect(state.payment).toBe('REJECTED');
    expect(await rejectionReasons(booking.id)).toContain('payment not received');
  });

  it('completes the two-step rejection, persists the reason and is single-use', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 830000003;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { reject } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, chatId, `pv:reject:${reject}`);
    await webhookText(++updateSeq, chatId, '  amount does not match  ');
    const state = await bookingState(booking.id);
    expect(state.status).toBe('REJECTED');
    expect(state.payment).toBe('REJECTED');
    expect(await rejectionReasons(booking.id)).toEqual(['amount does not match']);
    expect(await historyCount(booking.id)).toBe(2);

    // Replay of the reason step must not create a second rejection.
    await webhookText(++updateSeq, chatId, 'second reason');
    expect(await rejectionReasons(booking.id)).toEqual(['amount does not match']);
    expect(await historyCount(booking.id)).toBe(2);
    // Exactly two reject events: the prompt step and the completed rejection.
    expect(await securityEventCount('TELEGRAM_ACTION_REJECTED')).toBe(2);
  });

  it('expires the rejection reason window', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 830000004;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { reject } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, chatId, `pv:reject:${reject}`);
    await superuser.query(
      `UPDATE owner_telegram_action SET expires_at = now() - interval '1 minute'
        WHERE kind = 'REJECT' AND business_id = $1`,
      [businessA],
    );
    await webhookText(++updateSeq, chatId, 'too late');
    expect((await bookingState(booking.id)).status).toBe('PAYMENT_PENDING');
    expect(await rejectionReasons(booking.id)).toHaveLength(0);
  });

  it('refuses a rejection completed by a revoked identity', async () => {
    await seedService(businessA, await owner1Token());
    const chatId = 830000005;
    await connectOwnerChat(businessA, chatId);
    const booking = await createBooking(SLUG_A, businessA);
    const { reject } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, chatId, `pv:reject:${reject}`);
    const token = await owner1Token();
    await supertest(server)
      .post(`/api/v1/businesses/${businessA}/telegram/disconnect`)
      .set(auth(token));
    await webhookText(++updateSeq, chatId, 'revoked reason');
    expect((await bookingState(booking.id)).status).toBe('PAYMENT_PENDING');
    expect(await securityEventCount('TELEGRAM_ACTION_UNAUTHORIZED')).toBe(1);
  });

  it('notifies the connected customer with the rejection reason', async () => {
    await seedService(businessA, await owner1Token());
    const ownerChat = 830000006;
    const customerChat = 830000007;
    await connectOwnerChat(businessA, ownerChat);
    const booking = await createBooking(SLUG_A, businessA);
    await connectCustomerChat(SLUG_A, booking.id, booking.customerPhone, customerChat);
    const { reject } = await deliverOwnerProof();

    await webhookCallback(++updateSeq, ownerChat, `pv:reject:${reject}`);
    await webhookText(++updateSeq, ownerChat, 'blurry receipt');

    const sentBefore = telegram.sent.length;
    await dispatcher.fanOutDue();
    await dispatcher.processDue();
    const customerMessages = telegram.sent
      .slice(sentBefore)
      .filter((m) => m.chatId === BigInt(customerChat));
    expect(customerMessages.length).toBeGreaterThan(0);
    expect(customerMessages.some((m) => m.text.includes('blurry receipt'))).toBe(true);
  });
});

describe('E: regression + Super Admin scope', () => {
  it('keeps the dashboard accept and reject flows working', async () => {
    await seedService(businessA, await owner1Token());
    const token = await owner1Token();
    const accepted = await createBooking(SLUG_A, businessA, PNG, 'proof.png', 2);
    const okAccept = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/bookings/${accepted.id}/accept`)
      .set(auth(token));
    expect(okAccept.status).toBe(200);
    expect((await bookingState(accepted.id)).status).toBe('CONFIRMED');

    const rejected = await createBooking(SLUG_A, businessA, PNG, 'proof.png', 4);
    const okReject = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/bookings/${rejected.id}/reject`)
      .send({ reason: 'no transfer found' })
      .set(auth(token));
    expect(okReject.status).toBe(200);
    expect((await bookingState(rejected.id)).status).toBe('REJECTED');
  });

  it('keeps the customer Telegram connect flow working', async () => {
    await seedService(businessA, await owner1Token());
    const booking = await createBooking(SLUG_A, businessA);
    const chatId = 840000001;
    await connectCustomerChat(SLUG_A, booking.id, booking.customerPhone, chatId);
    const status = await supertest(server)
      .post(`/api/v1/public/businesses/${SLUG_A}/bookings/${booking.id}/telegram/status`)
      .send({ phone: booking.customerPhone })
      .set(CSRF);
    expect(status.body).toEqual({ connected: true });
  });

  it('does not let a Super Admin inherit the Owner Telegram action scope', async () => {
    const token = await saToken();
    const status = await supertest(server)
      .get(`/api/v1/businesses/${businessA}/telegram/status`)
      .set(auth(token));
    expect(status.status).toBe(403);
    const connect = await supertest(server)
      .post(`/api/v1/businesses/${businessA}/telegram/connect`)
      .set(auth(token));
    expect(connect.status).toBe(403);
  });
});
