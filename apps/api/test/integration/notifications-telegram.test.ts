/**
 * Prompt 13 — Notifications & Telegram integration tests over HTTP + the
 * delivery pipeline (docs 12/13/17):
 *
 *  A) Public connect flow: phone-gated one-time token issue (sha256 stored,
 *     TTL), anti-enumeration for wrong phone / unknown booking, status,
 *     disconnect (REVOKED, token cleared), per-booking connect rate limit.
 *  B) Webhook: secret-header authentication (401 + TELEGRAM_WEBHOOK_DENIED),
 *     /start <token> bind (ACTIVE + trusted chatId), update_id dedup
 *     (at-most-once), expired/invalid token side-channel events.
 *  C) Delivery pipeline: fan-out of customer Telegram intents (SENT with a
 *     connected chat, SUPPRESSED without one), idempotent rerun, reminder
 *     re-validation (stale → SUPPRESSED, match → SENT), retry/backoff on
 *     provider failure, owner schedule-conflict EMAIL (with/without contact
 *     email), and BOOKING_NEW_PROOF_OWNER excluded from delivery.
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
const SLUG = 'notifications-studio';
const SERVICE = { name: 'Cut & Style', basePriceMinor: 4500, baseDurationMinutes: 30 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GENERIC_MESSAGE =
  'If a matching booking exists for that phone, check its Telegram status below.';

interface BookingDto {
  id: string;
  customerPhone: string;
  customerName: string;
  startAt: string;
  status: string;
}

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let supertest: typeof import('supertest');
let superuser: Client;
let businessId: string;
let serviceId: string;
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

function auth(token: string): { Cookie: string; 'x-requested-with': string } {
  return { Cookie: `wrf.sid=${token}`, 'x-requested-with': 'fetch' };
}

function freshPhone(): string {
  phoneSeq += 1;
  return `+251${(900000000 + phoneSeq).toString().slice(-9)}`;
}

function wholeMinuteInFuture(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setSeconds(0, 0);
  return d.toISOString();
}

async function seedService(): Promise<void> {
  const token = await ownerToken();
  const res = await supertest(server)
    .post(`/api/v1/businesses/${businessId}/services`)
    .send(SERVICE)
    .set(auth(token));
  expect([200, 201]).toContain(res.status);
  serviceId = (res.body.service as { id: string }).id;
}

async function ownerToken(): Promise<string> {
  return login(TEST_EMAILS.owner, TEST_PASSWORDS.owner);
}

async function publicCreate(startAt?: string): Promise<BookingDto> {
  const phone = freshPhone();
  const req = supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings`)
    .field('customerName', 'Selam Test')
    .field('customerPhone', phone)
    .field('startAt', startAt ?? wholeMinuteInFuture(2))
    .field('paymentMethod', 'BANK_TRANSFER')
    .field('submissionKey', crypto.randomUUID())
    .field('services', JSON.stringify([{ serviceId, addOnIds: [] }]));
  const res = await req.attach('file', PNG, 'proof.png');
  expect([200, 201]).toContain(res.status);
  const booking = (res.body as { booking: BookingDto }).booking;
  return { ...booking, customerPhone: phone };
}

async function connect(bookingId: string, phone: string) {
  return supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings/${bookingId}/telegram/connect`)
    .send({ phone })
    .set(CSRF);
}

async function telegramStatus(bookingId: string, phone: string) {
  return supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings/${bookingId}/telegram/status`)
    .send({ phone })
    .set(CSRF);
}

async function telegramDisconnect(bookingId: string, phone: string) {
  return supertest(server)
    .post(`/api/v1/public/businesses/${SLUG}/bookings/${bookingId}/telegram/disconnect`)
    .send({ phone })
    .set(CSRF);
}

function webhook(updateId: number, chatId: number, text?: string) {
  const body: Record<string, unknown> = { update_id: updateId, message: { chat: { id: chatId } } };
  if (text !== undefined) body.message = { chat: { id: chatId }, text };
  return supertest(server)
    .post('/api/v1/telegram/webhook')
    .send(body)
    .set('x-telegram-bot-api-secret-token', process.env.TG_WEBHOOK_SECRET!)
    .set(CSRF);
}

/** Create a booking, issue a connect token and bind a chat via the webhook. */
async function connectedBooking(): Promise<{ bookingId: string; phone: string; chatId: number }> {
  const booking = await publicCreate(wholeMinuteInFuture(3));
  const started = await connect(booking.id, booking.customerPhone);
  expect([200, 201]).toContain(started.status);
  const token = (started.body as { token?: string }).token;
  expect(typeof token).toBe('string');
  const chatId = 500000000 + updateSeq;
  const bound = await webhook(++updateSeq, chatId, `/start ${token}`);
  expect([200, 201]).toContain(bound.status);
  expect(bound.body).toEqual({ ok: true });
  return { bookingId: booking.id, phone: booking.customerPhone, chatId };
}

function deliveryForNotification(notificationId: string) {
  return superuser.query<{
    status: string;
    recipient: string;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT status, recipient, attempts, last_error
       FROM notification_delivery WHERE notification_id = $1`,
    [notificationId],
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

  const token = await ownerToken();
  const created = await supertest(server)
    .post('/api/v1/businesses')
    .send({ name: 'Notifications Studio', publicSlug: SLUG })
    .set(auth(token));
  expect(created.status).toBe(201);
  businessId = (created.body.business as { id: string }).id;
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
  telegram.reset();
  mail.captured.length = 0;
});

describe('A: public connect / status / disconnect', () => {
  it('issues a one-time token only after the caller proves the booking phone', async () => {
    await seedService();
    const booking = await publicCreate();

    // Wrong phone → generic anti-enumeration response, no token, security event.
    const denied = await connect(booking.id, '+251999999999');
    expect([200, 201]).toContain(denied.status);
    expect(denied.body).toMatchObject({ connected: false, message: GENERIC_MESSAGE });
    expect((denied.body as { token?: string }).token).toBeUndefined();
    expect(await securityEventCount('TELEGRAM_PHONE_MISMATCH')).toBe(1);

    // Correct phone → token, bot handle, expiring TTL; only sha256 stored.
    const ok = await connect(booking.id, booking.customerPhone);
    expect([200, 201]).toContain(ok.status);
    const result = ok.body as {
      connected: boolean;
      token: string;
      botUsername: string;
      expiresAt: string;
    };
    expect(result.connected).toBe(false);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.botUsername).toBe('werefa_test_bot');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const rows = await superuser.query<{ hash: string; expires_at: Date }>(
      'SELECT connect_token_hash AS hash, connect_token_expires_at AS expires_at FROM telegram_connection WHERE booking_id = $1',
      [booking.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].hash).not.toContain(result.token);
    expect(new Date(rows.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(await securityEventCount('TELEGRAM_CONNECT_INITIATED')).toBe(1);
  });

  it('unknown booking answers the same generic message', async () => {
    await seedService();
    const message = GENERIC_MESSAGE;
    const res = await connect(crypto.randomUUID(), '+251911000000');
    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({ connected: false, message });
  });

  it('status is false until bound, true after binding, and disconnect revokes', async () => {
    await seedService();
    const { bookingId, phone } = await connectedBooking();
    const st = await telegramStatus(bookingId, phone);
    expect([200, 201]).toContain(st.status);
    expect(st.body).toEqual({ connected: true });

    const disc = await telegramDisconnect(bookingId, phone);
    expect([200, 201]).toContain(disc.status);
    const rows = await superuser.query<{ status: string; connect_token_hash: string | null }>(
      'SELECT status, connect_token_hash FROM telegram_connection WHERE booking_id = $1',
      [bookingId],
    );
    expect(rows.rows[0].status).toBe('REVOKED');
    expect(rows.rows[0].connect_token_hash).toBeNull();
    expect(await securityEventCount('TELEGRAM_DISCONNECTED')).toBe(1);

    const after = await telegramStatus(bookingId, phone);
    expect(after.body).toEqual({ connected: false });
  });

  it('disconnect cannot be forced without the right phone (WRONG phone → generic)', async () => {
    await seedService();
    const { bookingId } = await connectedBooking();
    const res = await telegramDisconnect(bookingId, '+251999999999');
    expect([200, 201]).toContain(res.status);
    expect(res.body).toMatchObject({ message: GENERIC_MESSAGE });
    const rows = await superuser.query<{ status: string }>(
      'SELECT status FROM telegram_connection WHERE booking_id = $1',
      [bookingId],
    );
    expect(rows.rows[0].status).toBe('ACTIVE');
  });

  it('enforces the per-booking connect rate limit with 429', async () => {
    await seedService();
    const booking = await publicCreate();
    for (let i = 0; i < 10; i += 1) {
      const res = await connect(booking.id, booking.customerPhone);
      expect([200, 201]).toContain(res.status);
    }
    const limited = await connect(booking.id, booking.customerPhone);
    expect(limited.status).toBe(429);
    expect((limited.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});

describe('B: webhook binding', () => {
  it('rejects a request without or with an invalid secret header (401 + event)', async () => {
    await seedService();
    const resNoSecret = await supertest(server)
      .post('/api/v1/telegram/webhook')
      .send({ update_id: 1, message: { chat: { id: 1 }, text: '/start x' } });
    expect(resNoSecret.status).toBe(401);
    expect((resNoSecret.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');

    const resBadSecret = await supertest(server)
      .post('/api/v1/telegram/webhook')
      .send({ update_id: 2, message: { chat: { id: 2 }, text: '/start x' } })
      .set('x-telegram-bot-api-secret-token', 'nope');
    expect(resBadSecret.status).toBe(401);
    expect((resBadSecret.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    expect(await securityEventCount('TELEGRAM_WEBHOOK_DENIED')).toBe(2);
  });

  it('binds the chat via /start <token> and records TELEGRAM_CONNECTED', async () => {
    await seedService();
    const { bookingId, chatId } = await connectedBooking();
    const rows = await superuser.query<{ status: string; chat_id: string }>(
      'SELECT status, chat_id FROM telegram_connection WHERE booking_id = $1',
      [bookingId],
    );
    expect(rows.rows[0].status).toBe('ACTIVE');
    expect(rows.rows[0].chat_id).toBe(String(chatId));
    expect(await securityEventCount('TELEGRAM_CONNECTED')).toBe(1);
  });

  it('deduplicates update ids (at-most-once)', async () => {
    await seedService();
    const booking = await publicCreate();
    const started = await connect(booking.id, booking.customerPhone);
    const token = (started.body as { token: string }).token;
    const chatId = 600000000;
    const payload = { update_id: 9001, message: { chat: { id: chatId }, text: `/start ${token}` } };
    const first = await supertest(server)
      .post('/api/v1/telegram/webhook')
      .send(payload)
      .set('x-telegram-bot-api-secret-token', process.env.TG_WEBHOOK_SECRET!)
      .set(CSRF);
    const second = await supertest(server)
      .post('/api/v1/telegram/webhook')
      .send(payload)
      .set('x-telegram-bot-api-secret-token', process.env.TG_WEBHOOK_SECRET!)
      .set(CSRF);
    expect(first.body).toEqual({ ok: true });
    expect(second.body).toEqual({ ok: true });
    const rows = await superuser.query<{ status: string }>(
      'SELECT status FROM telegram_connection WHERE booking_id = $1',
      [booking.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('ACTIVE');
  });

  it('expired tokens are consumed to EXPIRED with an event; unknown tokens are ignored', async () => {
    await seedService();
    // Expired token.
    const booking = await publicCreate();
    const started = await connect(booking.id, booking.customerPhone);
    const token = (started.body as { token: string }).token;
    await superuser.query(
      `UPDATE telegram_connection SET connect_token_expires_at = now() - interval '1 minute' WHERE booking_id = $1`,
      [booking.id],
    );
    const expired = await webhook(++updateSeq, 700000001, `/start ${token}`);
    expect(expired.body).toEqual({ ok: true });
    const rows = await superuser.query<{ status: string }>(
      'SELECT status FROM telegram_connection WHERE booking_id = $1',
      [booking.id],
    );
    expect(rows.rows[0].status).toBe('EXPIRED');
    expect(await securityEventCount('TELEGRAM_TOKEN_EXPIRED')).toBe(1);

    // Unknown token → ignored, TELEGRAM_LINK_INVALID recorded.
    const bogus = await webhook(++updateSeq, 700000002, '/start not-a-real-token');
    expect(bogus.body).toEqual({ ok: true });
    expect(await securityEventCount('TELEGRAM_LINK_INVALID')).toBe(1);
  });
});

describe('C: delivery pipeline', () => {
  it('fans out customer intents and dispatches over Telegram when a chat is connected', async () => {
    await seedService();
    const { bookingId, chatId } = await connectedBooking();
    const before = telegram.sent.length;

    expect(await dispatcher.fanOutDue()).toBeGreaterThan(0);
    const stats = await dispatcher.processDue();
    expect(stats.sent).toBeGreaterThan(0);
    expect(stats.failed + stats.deadLettered).toBe(0);

    const sentMessages = telegram.sent.slice(before);
    expect(sentMessages.some((m) => m.text.includes('payment proof'))).toBe(true);
    expect(sentMessages.every((m) => m.chatId === BigInt(chatId))).toBe(true);

    const row = await superuser.query<{ status: string; recipient: string }>(
      'SELECT status, recipient FROM notification_delivery WHERE business_id = $1 AND channel = $2 AND status = $3',
      [businessId, 'TELEGRAM', 'SENT'],
    );
    expect(row.rows.length).toBeGreaterThan(0);
    expect(row.rows[0].recipient).toBe(String(chatId));
    void bookingId;
  });

  it('suppresses intents for bookings without a connected chat', async () => {
    await seedService();
    const booking = await publicCreate();
    expect(await dispatcher.fanOutDue()).toBeGreaterThan(0);
    await dispatcher.processDue();

    const rows = await superuser.query<{
      status: string;
      recipient: string;
      last_error: string | null;
    }>(
      'SELECT status, recipient, last_error FROM notification_delivery WHERE business_id = $1 AND channel = $2',
      [businessId, 'TELEGRAM'],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.status === 'SUPPRESSED')).toBe(true);
    expect(rows.rows.every((r) => r.recipient === '-')).toBe(true);
    expect(telegram.sent).toHaveLength(0);
    void booking;
  });

  it('is idempotent: a second fan-out run creates no duplicate intents', async () => {
    await seedService();
    const booking = await publicCreate();
    const first = await dispatcher.fanOutDue();
    expect(first).toBeGreaterThan(0);
    const second = await dispatcher.fanOutDue();
    expect(second).toBe(0);
    const rows = await superuser.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notification_delivery WHERE business_id = $1',
      [businessId],
    );
    expect(rows.rows[0].count).toBeGreaterThan(0);
    expect(first).toBe(rows.rows[0].count);
    void booking;
  });

  it('does not fan out BOOKING_NEW_PROOF_OWNER (dashboard-only, REQ-066 deferred)', async () => {
    await seedService();
    const booking = await publicCreate();
    const excluded = await superuser.query<{ id: string }>(
      `SELECT id FROM notification WHERE booking_id = $1 AND type = 'BOOKING_NEW_PROOF_OWNER'`,
      [booking.id],
    );
    expect(excluded.rows).toHaveLength(1);
    await dispatcher.fanOutDue();
    const delivered = await superuser.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notification_delivery WHERE notification_id = $1',
      [excluded.rows[0].id],
    );
    expect(delivered.rows[0].count).toBe(0);
  });

  it('re-validates reminders against the authoritative booking (stale → SUPPRESSED)', async () => {
    await seedService();
    const { bookingId, chatId } = await connectedBooking();
    expect(chatId).toBeDefined();

    // The connected booking's own notification fans out and dispatches (chat active).
    await dispatcher.fanOutDue();
    await dispatcher.processDue();

    // A stale reminder: queued startAt no longer matches the booking.
    const reminderId = crypto.randomUUID();
    const staleStartAt = wholeMinuteInFuture(10);
    await superuser.query(
      `INSERT INTO notification(id, business_id, booking_id, type, payload)
       VALUES ($1, $2, $3, 'BOOKING_REMINDER_24H', jsonb_build_object('startAt', $4::text))`,
      [reminderId, businessId, bookingId, staleStartAt],
    );
    await dispatcher.fanOutDue();
    await dispatcher.processDue();
    const row = (await deliveryForNotification(reminderId)).rows[0];
    expect(row.status).toBe('SUPPRESSED');
    expect(row.last_error).toContain('stale reminder');
  });

  it('retries provider failures with backoff, then succeeds once the channel recovers', async () => {
    await seedService();
    const { bookingId } = await connectedBooking();
    telegram.mode = 'fail-all';
    await dispatcher.fanOutDue();
    const failed = await dispatcher.processDue();
    expect(failed.failed).toBeGreaterThan(0);

    const failRow = await superuser.query<{ id: string; attempts: number; next_attempt_at: Date }>(
      `SELECT nd.id, nd.attempts, nd.next_attempt_at
         FROM notification_delivery nd JOIN notification n ON n.id = nd.notification_id
        WHERE n.booking_id = $1 AND nd.channel = $2 AND nd.status = $3 LIMIT 1`,
      [bookingId, 'TELEGRAM', 'FAILED'],
    );
    expect(failRow.rows).toHaveLength(1);
    expect(failRow.rows[0].attempts).toBe(1);
    expect(new Date(failRow.rows[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // Make it due now, recover the channel, and dispatch again.
    telegram.mode = 'ok';
    await superuser.query(
      'UPDATE notification_delivery SET next_attempt_at = now() WHERE id = $1',
      [failRow.rows[0].id],
    );
    const recovered = await dispatcher.processDue();
    expect(recovered.sent).toBeGreaterThan(0);
    const sendRow = await superuser.query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM notification_delivery WHERE id = $1',
      [failRow.rows[0].id],
    );
    expect(sendRow.rows[0].status).toBe('SENT');
    expect(sendRow.rows[0].attempts).toBe(2);
  });

  it('sends the owner schedule-conflict EMAIL with a contact email on the business', async () => {
    await seedService();
    const booking = await publicCreate();
    await superuser.query(`UPDATE business SET contact_email = $1 WHERE id = $2`, [
      'owner@notifications.test',
      businessId,
    ]);
    const affectedId = crypto.randomUUID();
    const payload = {
      grouped: true,
      entries: [
        {
          bookingId: booking.id,
          customerName: 'Selam',
          customerPhone: booking.customerPhone,
          startAt: booking.startAt,
          durationMinutes: 30,
          managementUrl: `/manage/#/businesses/${businessId}/bookings/${booking.id}`,
        },
      ],
    };
    await superuser.query(
      `INSERT INTO notification(id, business_id, type, payload)
       VALUES ($1, $2, 'SCHEDULE_AFFECTED_OWNER', $3::jsonb)`,
      [affectedId, businessId, JSON.stringify(payload)],
    );

    expect(await dispatcher.fanOutDue()).toBeGreaterThan(0);
    const stats = await dispatcher.processDue();
    expect(stats.sent).toBe(1);

    const email = mail.captured.find((m) => m.subject.includes('Schedule change affecting'));
    expect(email).toBeDefined();
    expect(email!.to).toBe('owner@notifications.test');
    expect(email!.html).toContain('Reschedule / Cancel');

    const row = (await deliveryForNotification(affectedId)).rows[0];
    expect(row.status).toBe('SENT');
    expect(await securityEventCount('NOTIFICATION_DELIVERY_FAILED')).toBe(0);
  });

  it('suppresses the owner email when the business has no contact email', async () => {
    await seedService();
    await superuser.query(`UPDATE business SET contact_email = NULL WHERE id = $1`, [businessId]);
    const affectedId = crypto.randomUUID();
    const payload = {
      grouped: false,
      entries: [
        {
          bookingId: crypto.randomUUID(),
          customerName: 'Selam',
          startAt: wholeMinuteInFuture(2),
          durationMinutes: 30,
          managementUrl: `/manage/#/businesses/${businessId}/bookings/anything`,
        },
      ],
    };
    await superuser.query(
      `INSERT INTO notification(id, business_id, type, payload)
       VALUES ($1, $2, 'SCHEDULE_AFFECTED_OWNER', $3::jsonb)`,
      [affectedId, businessId, JSON.stringify(payload)],
    );
    expect(await dispatcher.fanOutDue()).toBeGreaterThan(0);
    await dispatcher.processDue();
    const row = (await deliveryForNotification(affectedId)).rows[0];
    expect(row.status).toBe('SUPPRESSED');
    expect(row.last_error).toContain('no contact email');
  });
});
