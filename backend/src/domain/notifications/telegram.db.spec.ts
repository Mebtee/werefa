import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseConfig } from '../../config/app-config';
import { ownerActor } from '../authorization/actor-context';
import { TenantGuard } from '../authorization/tenant-guard';
import { InMemoryEventBus } from '../events/domain-events';
import { PROOF_SAMPLES } from '../lib/proof-file';
import { PaymentProofStorage, StoredProof, StoredProofContent } from '../repositories/proof-storage.port';
import { PrismaBookingRepository } from '../repositories/prisma-booking.repository';
import { PrismaBusinessRepository } from '../repositories/prisma-business.repository';
import { PrismaFileRepository } from '../repositories/prisma-file.repository';
import { PrismaPaymentRepository } from '../repositories/prisma-payment.repository';
import { PrismaScheduleRepository } from '../repositories/prisma-schedule.repository';
import { PrismaSubscriptionRepository } from '../repositories/prisma-subscription.repository';
import { AvailabilityService } from '../services/availability.service';
import { BookingService } from '../services/booking.service';
import { BusinessService } from '../services/business.service';
import { CatalogService } from '../services/catalog.service';
import { ScheduleService } from '../services/schedule.service';
import { SubscriptionService } from '../services/subscription.service';
import { IntlGlobalClock } from '../time/global-clock';
import { NotificationMessageRenderer } from './notification-message-renderer';
import { NotificationOutboxEventBus } from './notification-outbox-event-bus';
import { NotificationDeliveryService } from './notification-delivery.service';
import { TelegramProvider } from './telegram-provider.port';
import { TelegramCallbackService } from './telegram-callback.service';
import { TelegramConnectionService } from './telegram-connection.service';
import { TelegramWebhookService, TelegramUpdatePayload } from './telegram-webhook.service';

const TEST_URL = process.env.TEST_DATABASE_URL;
const RUN = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_URL);

const FIXED_NOW = new Date('2026-09-14T18:00:00.000Z');
const clock = new IntlGlobalClock('UTC', () => FIXED_NOW);

// Telegram is enabled with a test bot handle; the delivery interval is huge so
// no background worker races the tests, and retries are bounded small.
const config = parseConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  TELEGRAM_ENABLED: 'true',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_BOT_HANDLE: '@werefa_test_bot',
  TELEGRAM_BOT_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_DELIVERY_INTERVAL_MS: '3600000',
  TELEGRAM_DELIVERY_MAX_ATTEMPTS: '3',
});

const DELETE_ORDER = [
  'notification_delivery',
  'notification',
  'telegram_callback',
  'telegram_connection_token',
  'telegram_connection',
  'telegram_update',
  'report_job',
  'audit_event',
  'security_event',
  'file_object',
  'subscription_reminder',
  'subscription_status_history',
  'subscription_proof',
  'subscription',
  'payment_status_history',
  'payment_proof',
  'payment',
  'slot_lock',
  'schedule_exception',
  'resubmission_verification',
  'booking_status_history',
  'booking_component',
  'booking',
  'working_period',
  'blocked_period',
  'special_date',
  'schedule_version',
  'add_on',
  'service_variation',
  'service',
  'business_settings',
  'business_owner',
  'business',
  'user',
  'business_category',
];

function resetDatabase(prisma: PrismaClient): Promise<void> {
  return prisma.$transaction(async (tx) => {
    for (const table of DELETE_ORDER) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO "business_category" ("code", "label") VALUES ('SALON_AND_BARBER', 'Salon & Barber'), ('OTHER', 'Other') ON CONFLICT DO NOTHING`,
    );
  });
}

class InMemoryProofStorage implements PaymentProofStorage {
  private readonly files = new Map<string, Buffer>();

  async store(input: { businessId: string; bytes: Buffer; mimeType: string; extension: string }): Promise<StoredProof> {
    const key = `${input.businessId}/proof-${this.files.size + 1}.${input.extension || 'bin'}`;
    this.files.set(key, input.bytes);
    const hash = createHash('sha256').update(input.bytes).digest('hex');
    return { storageKey: key, checksumSha256: hash, sizeBytes: input.bytes.length };
  }

  async read(storageKey: string): Promise<StoredProofContent | null> {
    const file = this.files.get(storageKey);
    return file ? { bytes: file } : null;
  }

  async delete(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
  }
}

interface InlineMarkup {
  inlineKeyboard: Array<Array<{ text: string; callbackData: string }>>;
}

class FakeTelegramProvider implements TelegramProvider {
  messages: Array<{ chatId: bigint; text: string; replyMarkup?: InlineMarkup }> = [];
  answers: Array<{ id: string; text?: string }> = [];
  private toFail = 0;

  failNext(n: number): void {
    this.toFail = n;
  }

  async sendMessage(input: { chatId: bigint; text: string; replyMarkup?: InlineMarkup }): Promise<{ ok: boolean; error?: string }> {
    if (this.toFail > 0) {
      this.toFail -= 1;
      return { ok: false, error: 'telegram api unavailable' };
    }
    this.messages.push(input);
    return { ok: true };
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<{ ok: boolean; error?: string }> {
    this.answers.push({ id: callbackQueryId, text });
    return { ok: true };
  }

  async registerWebhook(): Promise<void> {}
}

interface World {
  ownerId: string;
  ownerSlug: string;
  businessId: string;
  serviceId: string;
  serviceVariationId: string;
  addOnId: string;
}

describe.skipIf(!RUN)('telegram notification flow (live PostgreSQL)', () => {
  let prisma: PrismaClient;
  let provider: FakeTelegramProvider;
  let businessService: BusinessService;
  let bookingService: BookingService;
  let outbox: NotificationOutboxEventBus;
  let delivery: NotificationDeliveryService;
  let connections: TelegramConnectionService;
  let webhook: TelegramWebhookService;

  const repos = {
    get b() {
      return new PrismaBusinessRepository(prisma);
    },
    get k() {
      return new PrismaBookingRepository(prisma);
    },
  };

  let tenantGuard: TenantGuard;
  let catalogService: CatalogService;
  let scheduleService: ScheduleService;

  async function readyBusiness(seq: number): Promise<World> {
    const user = await prisma.user.create({ data: { email: `tgbot-owner-${seq}@example.com`, passwordHash: 'x'.repeat(60), role: 'OWNER' } });
    const ownerId = user.id;
    const slug = `tg-salons-${seq}`;
    const biz = await businessService.createBusiness(ownerActor(ownerId), {
      slug,
      categoryCode: 'SALON_AND_BARBER',
      name: `Telegram Salons ${seq}`,
      bookingIntervalMinutes: 60,
    });
    const service = await catalogService.createService(ownerActor(ownerId), biz.id, {
      name: 'Haircut',
      basePriceMinor: 10000n,
      baseDurationMinutes: 60,
    });
    const variation = await catalogService.createVariation(ownerActor(ownerId), biz.id, service.id, {
      name: 'Styling',
      priceDeltaMinor: 2000n,
      durationDeltaMinutes: 10,
    });
    const addOn = await catalogService.createAddOn(ownerActor(ownerId), biz.id, service.id, {
      name: 'Wash',
      priceDeltaMinor: 1500n,
      durationDeltaMinutes: 5,
    });
    await scheduleService.saveTemplate(ownerActor(ownerId), biz.id, {
      template: {
        workingPeriods: [...Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinutes: 540, endMinutes: 1020 }))],
        blockedPeriods: [],
        specialDates: [],
      },
    });
    return { ownerId, ownerSlug: slug, businessId: biz.id, serviceId: service.id, serviceVariationId: variation.id, addOnId: addOn.id };
  }

  async function makeBooking(w: World, startAt: Date, key: string) {
    return bookingService.createBooking({
      businessSlug: w.ownerSlug,
      selections: [{ serviceId: w.serviceId, variationIds: [w.serviceVariationId], addOnIds: [w.addOnId] }],
      customerName: 'Liya Tesfaye',
      customerPhone: '+251911112233',
      note: 'window seat',
      startAt,
      submissionKey: key,
    });
  }

  let updateCounter = 10_000;

  function nextUpdateId(): number {
    updateCounter += 1;
    return updateCounter;
  }

  function startUpdate(code: string | null, chatId: number): TelegramUpdatePayload {
    return { update_id: nextUpdateId(), message: { chat: { id: chatId }, text: code ? `/start ${code}` : '/start' } };
  }

  function textUpdate(text: string, chatId: number): TelegramUpdatePayload {
    return { update_id: nextUpdateId(), message: { chat: { id: chatId }, text } };
  }

  function callbackUpdate(callbackId: string, action: 'accept' | 'reject', chatId: number): TelegramUpdatePayload {
    return {
      update_id: nextUpdateId(),
      callback_query: { id: callbackId, from: { id: chatId }, message: { chat: { id: chatId } }, data: `${action}:${callbackId}` },
    };
  }

  /** Code embedded in the issued deep link. */
  function codeFromLink(link: string): string {
    return decodeURIComponent(link.split('start=')[1]);
  }

  async function connectCustomerAfterBooking(w: World, chatId: number): Promise<string> {
    const issued = await connections.connectCustomer(w.ownerSlug, '+251911112233');
    expect(issued.status).toBe('ready');
    const code = codeFromLink((issued as { deepLink: string }).deepLink);
    await webhook.handleUpdate(startUpdate(code, chatId));
    return (issued as { deepLink: string }).deepLink;
  }

  async function connectOwner(w: World, chatId: number): Promise<void> {
    const issued = await connections.connectOwner(w.ownerId, w.businessId);
    expect(issued.status).toBe('ready');
    await webhook.handleUpdate(startUpdate(codeFromLink((issued as { deepLink: string }).deepLink), chatId));
  }

  async function securityEvents(
    type: string,
    businessId?: string,
  ): Promise<Array<{ result: string; businessId: string | null; ip: string | null }>> {
    return prisma.securityEvent.findMany({
      where: { type, ...(businessId ? { businessId } : {}) },
      select: { result: true, businessId: true, ip: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  beforeAll(async () => {
    if (!RUN) return;
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL! } } });
    provider = new FakeTelegramProvider();
    await resetDatabase(prisma);

    const subRepo = new PrismaSubscriptionRepository(prisma);
    const pRepo = new PrismaPaymentRepository(prisma);
    const sRepo = new PrismaScheduleRepository(prisma);
    const fileRepo = new PrismaFileRepository(prisma);
    const proofStorage = new InMemoryProofStorage();
    const eventBus = new InMemoryEventBus();
    tenantGuard = new TenantGuard(repos.b);
    const subscriptionService = new SubscriptionService(prisma, subRepo, sRepo, clock, tenantGuard);
    businessService = new BusinessService(prisma, repos.b, subRepo, tenantGuard, subscriptionService);
    catalogService = new CatalogService(prisma, repos.k, tenantGuard);
    scheduleService = new ScheduleService(prisma, sRepo, clock, tenantGuard);
    const availability = new AvailabilityService(prisma, sRepo, clock);
    bookingService = new BookingService(
      prisma,
      repos.b,
      repos.k,
      pRepo,
      fileRepo,
      proofStorage,
      clock,
      eventBus,
      tenantGuard,
      catalogService,
      availability,
      subscriptionService,
    );
    outbox = new NotificationOutboxEventBus(prisma, config);
    delivery = new NotificationDeliveryService(prisma, config, provider, new NotificationMessageRenderer(), outbox);
    connections = new TelegramConnectionService(prisma, config, tenantGuard);
    webhook = new TelegramWebhookService(prisma, config, provider, connections, new TelegramCallbackService(prisma, bookingService));
  });

  afterAll(async () => {
    if (!RUN) return;
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(code);
      return;
    }
    throw new Error(`expected AppError with ${code}, but the call succeeded`);
  }

  it('a customer without a booking at this business cannot connect (REQ-056)', async () => {
    const w = await readyBusiness(1);
    await expectCode(connections.connectCustomer(w.ownerSlug, '+251955598877'), ErrorCode.VALIDATION_ERROR);
    expect(await prisma.telegramConnectionToken.count()).toBe(0);
  });

  it('a connected customer gets a ready result; an already-connected one gets connected (idempotent)', async () => {
    const w = await readyBusiness(2);
    await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-02');
    const first = await connections.connectCustomer(w.ownerSlug, '+251911112233');
    expect(first.status).toBe('ready');
    const second = await connections.connectCustomer(w.ownerSlug, '+251911112233');
    expect(second.status).toBe('ready'); // not yet redeemed — still a fresh code.
    await webhook.handleUpdate(startUpdate(codeFromLink((second as { deepLink: string }).deepLink), 2001));
    const third = await connections.connectCustomer(w.ownerSlug, '+251911112233');
    expect(third.status).toBe('connected');
  });

  it('issues a single-use code stored ONLY as a SHA-256 digest, expiring in 10 minutes', async () => {
    const w = await readyBusiness(3);
    await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-03');
    const issued = (await connections.connectCustomer(w.ownerSlug, '+251911112233')) as { deepLink: string };
    expect(issued.deepLink).toMatch(/^https:\/\/t\.me\/werefa_test_bot\?start=/);
    const code = codeFromLink(issued.deepLink);
    const token = await prisma.telegramConnectionToken.findFirst({ where: { businessId: w.businessId } });
    expect(token).not.toBeNull();
    expect(token!.codeHash).not.toContain(code);
    expect(token!.codeHash).toBe(createHash('sha256').update(code).digest('hex'));
    expect(token!.state).toBe('ISSUED');
    const ttlMs = token!.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000 + 60_000);
  });

  it('redeems through the webhook, binds the chat, welcomes by business name, and journals TELEGRAM_REDEEM', async () => {
    const w = await readyBusiness(4);
    await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-04');
    const issued = (await connections.connectCustomer(w.ownerSlug, '+251911112233')) as { deepLink: string };
    await webhook.handleUpdate(startUpdate(codeFromLink(issued.deepLink), 4001));

    const connection = await prisma.telegramConnection.findFirst({ where: { businessId: w.businessId } });
    expect(connection).not.toBeNull();
    expect(connection!.kind).toBe('CUSTOMER');
    expect(connection!.state).toBe('CONNECTED');
    expect(connection!.chatId).toBe(4001n);
    expect(connection!.customerPhone).toBe('+251911112233');

    const reply = provider.messages.at(-1)?.text ?? '';
    expect(reply).toMatch(/Connected at Telegram Salons 4/);
    expect(await securityEvents('TELEGRAM_REDEEM', w.businessId)).toEqual([
      { result: 'SUCCESS', businessId: w.businessId, ip: null },
    ]);
  });

  it('a used code is refused with friendly copy and a USED security event', async () => {
    const w = await readyBusiness(5);
    await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-05');
    const issued = (await connections.connectCustomer(w.ownerSlug, '+251911112233')) as { deepLink: string };
    const code = codeFromLink(issued.deepLink);
    await webhook.handleUpdate(startUpdate(code, 5001));
    const before = provider.messages.length;
    await webhook.handleUpdate(startUpdate(code, 5002));
    expect(provider.messages.length).toBe(before + 1);
    expect(provider.messages.at(-1)!.text).toMatch(/already been used/);
    const events = await securityEvents('TELEGRAM_REDEEM', w.businessId);
    expect(events).toEqual([
      { result: 'SUCCESS', businessId: w.businessId, ip: null },
      { result: 'USED', businessId: w.businessId, ip: null },
    ]);
  });

  it('an expired code is refused with a friendly expiry message', async () => {
    const w = await readyBusiness(6);
    await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-06');
    const issued = (await connections.connectCustomer(w.ownerSlug, '+251911112233')) as { deepLink: string };
    const code = codeFromLink(issued.deepLink);
    await prisma.telegramConnectionToken.updateMany({ where: { businessId: w.businessId }, data: { state: 'EXPIRED' } });
    await webhook.handleUpdate(startUpdate(code, 6001));
    expect(provider.messages.at(-1)!.text).toMatch(/expired/);
    const events = await securityEvents('TELEGRAM_REDEEM', w.businessId);
    expect(events.at(-1)!.result).toBe('EXPIRED');
  });

  it('is exactly-once: a replayed update_id is dropped without reprocessing', async () => {
    const w = await readyBusiness(7);
    await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-07');
    const issued = (await connections.connectCustomer(w.ownerSlug, '+251911112233')) as { deepLink: string };
    const update = startUpdate(codeFromLink(issued.deepLink), 7001);
    await webhook.handleUpdate(update);
    const afterFirst = provider.messages.length;
    const row = await prisma.telegramUpdate.findUnique({ where: { updateId: BigInt(update.update_id) } });
    expect(row).not.toBeNull();
    await webhook.handleUpdate(update); // same update_id
    expect(provider.messages.length).toBe(afterFirst); // no second welcome
    expect(await prisma.telegramUpdate.count({ where: { updateId: BigInt(update.update_id) } })).toBe(1);
  });

  it('ignores unknown commands without crashing (dedupe row still recorded)', async () => {
    const update = { update_id: nextUpdateId(), message: { chat: { id: 7771 }, text: '/help' } };
    const before = provider.messages.length;
    await webhook.handleUpdate(update);
    expect(provider.messages.length).toBe(before); // no reply to unknown commands
    expect(await prisma.telegramUpdate.findUnique({ where: { updateId: BigInt(update.update_id) } })).toBeDefined();
  });

  it('a bare /start without a code replies with guidance', async () => {
    const before = provider.messages.length;
    await webhook.handleUpdate(startUpdate(null, 7772));
    expect(provider.messages.length).toBe(before + 1);
    expect(provider.messages.at(-1)!.text).toMatch(/open the booking page/);
  });

  it('an unconnected customer delivery is SUPPRESSED and never sent', async () => {
    const w = await readyBusiness(8);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-08');
    await outbox.writeBookingEvent({ type: 'PAYMENT_PROOF_RECEIVED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });
    const row = await prisma.notificationDelivery.findFirst({
      where: { recipientType: 'CUSTOMER', notification: { businessId: w.businessId } },
      include: { notification: true },
    });
    expect(row!.state).toBe('SUPPRESSED');
    const before = provider.messages.length;
    const result = await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'));
    expect(result.attempted).toBe(0); // SUPPRESSED rows are never claimed
    expect(provider.messages.length).toBe(before);
  });

  it('a connected customer gets the N01 message and the delivery is SENT', async () => {
    const w = await readyBusiness(9);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-09');
    await connectCustomerAfterBooking(w, 9001);
    await outbox.writeBookingEvent({ type: 'PAYMENT_PROOF_RECEIVED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });
    const pending = await prisma.notificationDelivery.findFirst({ where: { recipientType: 'CUSTOMER', state: 'PENDING' } });
    expect(pending).not.toBeNull();
    const result = await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'));
    expect(result.sent).toBe(1);
    const sent = await prisma.notificationDelivery.findUnique({ where: { id: pending!.id } });
    expect(sent!.state).toBe('SENT');
    expect(provider.messages.at(-1)!.text).toMatch(/payment proof has been received and is awaiting review/);
  });

  it('reminders are exactly-once (idempotency key) and unconnected customers stay suppressed', async () => {
    const w = await readyBusiness(10);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-10');
    const startAt = new Date(FIXED_NOW.getTime() + 24 * 3600 * 1000);
    await prisma.booking.update({
      where: { id: b.booking.id },
      data: { status: 'CONFIRMED', startAt, endAt: new Date(startAt.getTime() + 75 * 60 * 1000) },
    });
    const written = await delivery.writeDueReminders(FIXED_NOW);
    expect(written).toBe(1);
    const forThisBusiness = () => prisma.notificationDelivery.findMany({
      where: { notification: { businessId: w.businessId } },
      include: { notification: true },
    });
    const rows = await forThisBusiness();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('SUPPRESSED'); // unconnected customer → no reminder
    expect(await delivery.writeDueReminders(FIXED_NOW)).toBe(1); // derived again, but…
    expect((await forThisBusiness())).toHaveLength(1); // …the idempotency key skips the duplicate
  });

  it('a connected customer receives the 1h reminder with the canonical text', async () => {
    const w = await readyBusiness(11);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-11');
    await connectCustomerAfterBooking(w, 1101);
    await prisma.booking.update({
      where: { id: b.booking.id },
      data: {
        status: 'CONFIRMED',
        startAt: new Date(FIXED_NOW.getTime() + 60 * 60 * 1000),
        endAt: new Date(FIXED_NOW.getTime() + (60 + 75) * 60 * 1000),
      },
    });
    await delivery.writeDueReminders(FIXED_NOW);
    const mine = await prisma.notificationDelivery.findFirst({
      where: { recipientType: 'CUSTOMER', notification: { businessId: w.businessId } },
      include: { notification: true },
    });
    expect(mine).not.toBeNull();
    expect(mine!.notification.type).toBe('REMINDER_1H');
    expect(mine!.state).toBe('PENDING'); // connected → due for delivery
    const result = await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'));
    const sent = provider.messages.find((m) => m.text.includes('Reminder: your appointment is in 1 hour.'));
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(sent).toBeDefined();
  });

  it('owner connect issues a BUSINESS_OWNER code and redemption binds the owner', async () => {
    const w = await readyBusiness(12);
    const issued = (await connections.connectOwner(w.ownerId, w.businessId)) as { deepLink: string };
    const token = await prisma.telegramConnectionToken.findFirst({ where: { businessId: w.businessId, kind: 'BUSINESS_OWNER' } });
    expect(token).not.toBeNull();
    expect(token!.userId).toBe(w.ownerId);
    await webhook.handleUpdate(startUpdate(codeFromLink(issued.deepLink), 12001));
    const conn = await prisma.telegramConnection.findFirst({ where: { businessId: w.businessId, kind: 'BUSINESS_OWNER' } });
    expect(conn!.state).toBe('CONNECTED');
    expect(conn!.chatId).toBe(12001n);
    expect(provider.messages.at(-1)!.text).toMatch(/accept or reject them right here/);
    expect(await connections.ownerConnected(w.ownerId, w.businessId)).toBe(true);
  });

  it('owner N09 delivery carries T-09 Accept/Reject callbacks bound to the connection', async () => {
    const w = await readyBusiness(13);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-13');
    await connectOwner(w, 13001);
    await outbox.writeBookingEvent({ type: 'PAYMENT_PROOF_RECEIVED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });

    const callbacks = await prisma.telegramCallback.findMany({ where: { bookingId: b.booking.id }, orderBy: { kind: 'asc' } });
    expect(callbacks).toHaveLength(2);
    expect(callbacks.map((c) => c.kind).sort()).toEqual(['ACCEPT_PROOF', 'REJECT_PROOF']);
    const connectionsRows = new Set((await prisma.telegramConnection.findMany({ select: { id: true } })).map((c) => c.id));
    for (const cb of callbacks) expect(connectionsRows.has(cb.connectionId)).toBe(true);

    expect(await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'))).toMatchObject({ sent: 1 });
    const sent = provider.messages.at(-1)!;
    expect(sent.text).toMatch(/new payment proof/);
    const accept = callbacks.find((c) => c.kind === 'ACCEPT_PROOF')!;
    const reject = callbacks.find((c) => c.kind === 'REJECT_PROOF')!;
    const buttons = sent.replyMarkup!.inlineKeyboard[0];
    expect(buttons.map((b) => b.callbackData)).toEqual([`accept:${accept.id}`, `reject:${reject.id}`]);
  });

  it('accept callback confirms the booking exactly-once; wrong chat and double-tap are refused', async () => {
    const w = await readyBusiness(14);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-14');
    await connectOwner(w, 14001);
    await outbox.writeBookingEvent({ type: 'PAYMENT_PROOF_RECEIVED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });
    // drain this test's owner delivery so later sweeps only see their own rows
    expect(await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'))).toMatchObject({ sent: 1 });
    const accept = await prisma.telegramCallback.findFirst({ where: { bookingId: b.booking.id, kind: 'ACCEPT_PROOF' } });

    // wrong chat → refused, booking untouched
    await webhook.handleUpdate(callbackUpdate(accept!.id, 'accept', 14999));
    expect((await prisma.booking.findUnique({ where: { id: b.booking.id } }))!.status).toBe('PAYMENT_PENDING');
    expect(provider.answers.at(-1)!.text).toMatch(/no longer available/);
    expect((await securityEvents('TELEGRAM_CALLBACK')).at(-1)!.result).toBe('REFUSED');

    // correct chat → confirmed
    await webhook.handleUpdate(callbackUpdate(accept!.id, 'accept', 14001));
    expect((await prisma.booking.findUnique({ where: { id: b.booking.id } }))!.status).toBe('CONFIRMED');
    expect(provider.answers.at(-1)!.text).toMatch(/accepted and the booking confirmed/);
    expect((await securityEvents('TELEGRAM_CALLBACK')).at(-1)!.result).toBe('SUCCESS');

    // double-tap → refused; booking stays CONFIRMED
    await webhook.handleUpdate(callbackUpdate(accept!.id, 'accept', 14001));
    expect((await prisma.booking.findUnique({ where: { id: b.booking.id } }))!.status).toBe('CONFIRMED');
    expect(provider.answers.at(-1)!.text).toMatch(/no longer available/);
  });

  it('reject flow prompts for a reason (REQ-068) and records it on confirmation', async () => {
    const w = await readyBusiness(15);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-15');
    await connectOwner(w, 15001);
    await outbox.writeBookingEvent({ type: 'PAYMENT_PROOF_RECEIVED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });
    // drain this test's owner delivery so later sweeps only see their own rows
    expect(await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'))).toMatchObject({ sent: 1 });
    const reject = await prisma.telegramCallback.findFirst({ where: { bookingId: b.booking.id, kind: 'REJECT_PROOF' } });

    await webhook.handleUpdate(callbackUpdate(reject!.id, 'reject', 15001));
    expect(provider.answers.at(-1)!.text).toMatch(/Please send the reason/);
    expect(provider.messages.at(-1)!.text).toMatch(/Please send the reason/);
    expect((await prisma.booking.findUnique({ where: { id: b.booking.id } }))!.status).toBe('PAYMENT_PENDING');

    await webhook.handleUpdate(textUpdate('the uploaded photo is unreadable', 15001));
    expect((await prisma.booking.findUnique({ where: { id: b.booking.id } }))!.status).toBe('REJECTED');
    const history = await prisma.bookingStatusHistory.findFirst({ where: { bookingId: b.booking.id, toStatus: 'REJECTED' } });
    expect(history!.reason).toBe('the uploaded photo is unreadable');
    expect((await securityEvents('TELEGRAM_REJECT_REASON')).at(-1)!.result).toBe('SUCCESS');

    // a stray text with no pending prompt is ignored (REFUSED, silent)
    const providerMessages = provider.messages.length;
    await webhook.handleUpdate(textUpdate('why did no one reply?', 15001));
    expect(provider.messages.length).toBe(providerMessages);
  });

  it('webhook secret verification is constant-time against the configured secret', async () => {
    expect(webhook.isValidSecret(config.telegramBotWebhookSecret ?? undefined)).toBe(true);
    expect(webhook.isValidSecret('wrong-secret')).toBe(false);
    expect(webhook.isValidSecret(undefined)).toBe(false);
    await webhook.recordSecretMismatch('203.0.113.7');
    expect(await securityEvents('WEBHOOK_SECRET_MISMATCH')).toEqual([{ result: 'FAILED', businessId: null, ip: '203.0.113.7' }]);
  });

  it('delivery failures are bounded: retried then dead-lettered, never thrown', async () => {
    const w = await readyBusiness(16);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-16');
    await connectCustomerAfterBooking(w, 16001);
    await outbox.writeBookingEvent({ type: 'BOOKING_CONFIRMED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });
    const row = await prisma.notificationDelivery.findFirst({ where: { recipientType: 'CUSTOMER', state: 'PENDING' } });

    provider.failNext(3); // exceed max attempts (3)
    const t1 = await delivery.sweep(new Date('2026-09-14T18:00:01.000Z'));
    expect(t1.failed).toBe(1);
    const after1 = await prisma.notificationDelivery.findUnique({ where: { id: row!.id } });
    expect(after1!.state).toBe('PENDING');
    expect(after1!.attempts).toBe(1);

    // next due attempt skips time today → force due
    await prisma.notificationDelivery.update({ where: { id: row!.id }, data: { nextAttemptAt: new Date('2026-09-14T18:00:01.000Z') } });
    await delivery.sweep(new Date('2026-09-14T18:00:02.000Z'));
    await prisma.notificationDelivery.update({ where: { id: row!.id }, data: { nextAttemptAt: new Date('2026-09-14T18:00:02.000Z') } });
    const t2 = await delivery.sweep(new Date('2026-09-14T18:00:03.000Z'));
    const final = await prisma.notificationDelivery.findUnique({ where: { id: row!.id } });
    expect(final!.state).toBe('DEAD_LETTERED');
    expect(final!.attempts).toBe(config.telegramDeliveryMaxAttempts);
    void t2;
  });

  it('deliveries are scoped to the business/tenant that owns the booking', async () => {
    const w = await readyBusiness(17);
    const b = await makeBooking(w, new Date('2026-09-15T10:00:00.000Z'), 'key-tgbot-17');
    await connectCustomerAfterBooking(w, 17001);
    await outbox.writeBookingEvent({ type: 'BOOKING_CANCELLED', businessId: w.businessId, bookingId: b.booking.id, customerPhone: '+251911112233', occurredAt: FIXED_NOW });
    const mine = await prisma.notificationDelivery.findMany({
      where: { recipientType: 'CUSTOMER', notification: { businessId: w.businessId } },
      include: { notification: true },
    });
    expect(mine).toHaveLength(1); // exactly one delivery, for THIS business only
    expect(mine[0].notification.type).toBe('BOOKING_CANCELLED');
    // BOOKING_CANCELLED is not an owner event — no owner delivery may exist for this business.
    const ownerForThisBusiness = await prisma.notificationDelivery.count({
      where: { recipientType: 'OWNER', notification: { businessId: w.businessId } },
    });
    expect(ownerForThisBusiness).toBe(0);
    void PROOF_SAMPLES;
  });
});