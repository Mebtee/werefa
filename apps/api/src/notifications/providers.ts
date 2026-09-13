/** NestJS DI token for the active TelegramProvider implementation. */
export const TELEGRAM_PROVIDER = Symbol('TELEGRAM_PROVIDER');

/**
 * Provider layer (doc 13 §5/§7, doc 12 §5): adapters behind which the
 * dispatcher sends messages. NO provider call ever touches booking or payment
 * state — delivery is an out-of-band effect with a recorded outcome.
 *
 * A `sendMessage` / `sendPhoto` / `sendDocument` returns either `null`
 * (success — the channel accepted it) or a failure category. Permanent
 * categories dead-letter immediately:
 *
 *   CHANNEL_DISABLED  — the channel has no working transport (e.g. disabled).
 *   INVALID_RECIPIENT — the address/phone cannot receive (mailbox rejected).
 *   CHAT_INVALID      — Telegram chat gone/bot not allowed (400 chat-not-found).
 *   PROVIDER_ERROR    — provider auth/contract violation (permanent, e.g. 401).
 *
 * Retryable everywhere else:
 *   TRANSIENT  — network/5xx; safe to retry with backoff.
 *   RATE_LIMITED — channel says slow down; retry with backoff.
 */
export type DeliveryFailureCategory =
  | 'CHANNEL_DISABLED'
  | 'TRANSIENT'
  | 'RATE_LIMITED'
  | 'INVALID_RECIPIENT'
  | 'CHAT_INVALID'
  | 'PROVIDER_ERROR';

export const PERMANENT_FAILURE_CATEGORIES = new Set<DeliveryFailureCategory>([
  'CHANNEL_DISABLED',
  'INVALID_RECIPIENT',
  'CHAT_INVALID',
  'PROVIDER_ERROR',
]);

export function isPermanentFailure(category: DeliveryFailureCategory): boolean {
  return PERMANENT_FAILURE_CATEGORIES.has(category);
}

export interface TelegramSendInput {
  chatId: bigint;
  text: string;
}

/** Inline keyboard sent with an owner proof notification (REQ-067/068). */
export interface TelegramInlineButton {
  text: string;
  /** Opaque single-use action token, never a booking/proof id. */
  callbackData: string;
}

export interface TelegramReplyMarkup {
  inlineKeyboard: TelegramInlineButton[][];
}

export interface TelegramMediaSendInput {
  chatId: bigint;
  /** Caption shown above/next to the proof attachment. */
  text: string;
  /** Proof raw bytes (image or PDF), fetched by the dispatcher. */
  buffer: Buffer;
  mime: string;
  replyMarkup?: TelegramReplyMarkup;
}

export interface TelegramCallbackAnswerInput {
  callbackQueryId: string;
  text?: string;
}

export interface TelegramProvider {
  sendMessage(input: TelegramSendInput): Promise<DeliveryFailureCategory | null>;
  sendPhoto(input: TelegramMediaSendInput): Promise<DeliveryFailureCategory | null>;
  sendDocument(input: TelegramMediaSendInput): Promise<DeliveryFailureCategory | null>;
  answerCallbackQuery(input: TelegramCallbackAnswerInput): Promise<DeliveryFailureCategory | null>;
}

/** No-op provider: the channel is not configured (emits CHANNEL_DISABLED). */
export class DisabledTelegramProvider implements TelegramProvider {
  async sendMessage(): Promise<DeliveryFailureCategory | null> {
    return 'CHANNEL_DISABLED';
  }

  async sendPhoto(): Promise<DeliveryFailureCategory | null> {
    return 'CHANNEL_DISABLED';
  }

  async sendDocument(): Promise<DeliveryFailureCategory | null> {
    return 'CHANNEL_DISABLED';
  }

  async answerCallbackQuery(): Promise<DeliveryFailureCategory | null> {
    return 'CHANNEL_DISABLED';
  }
}

/** In-memory Telegram provider for the test env (deterministic, no network). */
export class FakeTelegramProvider implements TelegramProvider {
  readonly sent: { chatId: bigint; text: string }[] = [];
  readonly media: {
    chatId: bigint;
    text: string;
    buffer: Buffer;
    mime: string;
    replyMarkup?: TelegramReplyMarkup;
  }[] = [];
  readonly callbackAnswers: { callbackQueryId: string; text?: string }[] = [];

  /** Test knobs: 'ok' (default) → always accept; 'fail-once' → first call fails; 'fail-all' → always fails. */
  mode: 'ok' | 'fail-once' | 'fail-all' = 'ok';

  /** Test knob: force a category for the next `failOnCount` calls. */
  private failing: DeliveryFailureCategory | null = null;
  private failCount = 0;

  async sendMessage(input: TelegramSendInput): Promise<DeliveryFailureCategory | null> {
    const forced = this.decide();
    if (forced) return forced;
    const once = this.decideOnce();
    if (once) return once;
    this.sent.push(structuredClone(input));
    return null;
  }

  async sendPhoto(input: TelegramMediaSendInput): Promise<DeliveryFailureCategory | null> {
    return this.recordMedia(input);
  }

  async sendDocument(input: TelegramMediaSendInput): Promise<DeliveryFailureCategory | null> {
    return this.recordMedia(input);
  }

  async answerCallbackQuery(
    input: TelegramCallbackAnswerInput,
  ): Promise<DeliveryFailureCategory | null> {
    const forced = this.decide();
    if (forced) return forced;
    const once = this.decideOnce();
    if (once) return once;
    this.callbackAnswers.push(structuredClone(input));
    return null;
  }

  /** Forced-category knobs (mode + failNext) shared by message and media sends. */
  private decide(): DeliveryFailureCategory | null {
    if (this.mode === 'fail-all') return 'TRANSIENT';
    if (this.mode === 'fail-once' && this.totalSent() === 0) return 'TRANSIENT';
    return null;
  }

  private decideOnce(): DeliveryFailureCategory | null {
    if (this.failing && this.failCount > 0) {
      this.failCount -= 1;
      const category = this.failing;
      if (this.failCount === 0) this.failing = null;
      return category;
    }
    return null;
  }

  private async recordMedia(
    input: TelegramMediaSendInput,
  ): Promise<DeliveryFailureCategory | null> {
    const forced = this.decide();
    if (forced) return forced;
    const once = this.decideOnce();
    if (once) return once;
    this.media.push({
      chatId: input.chatId,
      text: input.text,
      buffer: Buffer.from(input.buffer),
      mime: input.mime,
      replyMarkup: input.replyMarkup ? structuredClone(input.replyMarkup) : undefined,
    });
    return null;
  }

  private totalSent(): number {
    return this.sent.length + this.media.length;
  }

  /** Fail the next `count` provider calls with `category` (default TRANSIENT). */
  failNext(count = 1, category: DeliveryFailureCategory = 'TRANSIENT'): void {
    this.failing = category;
    this.failCount = count;
  }

  reset(): void {
    this.sent.length = 0;
    this.media.length = 0;
    this.callbackAnswers.length = 0;
    this.failing = null;
    this.failCount = 0;
    this.mode = 'ok';
  }
}

/**
 * Real Telegram Bot API client (docs 12 §5). Uses the global fetch — no new
 * HTTP dependency. Rate shaping per chat keeps the automatic ~20 msg/min cap
 * bounded by the sweeper's own pacing.
 */
export class HttpTelegramProvider implements TelegramProvider {
  private readonly api = 'https://api.telegram.org';
  private readonly lastSentPerChat = new Map<bigint, number>();

  constructor(
    private readonly botToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMessage(input: TelegramSendInput): Promise<DeliveryFailureCategory | null> {
    await this.pace(input.chatId);
    const res = await this.post('/sendMessage', {
      chat_id: Number(input.chatId),
      text: input.text,
      disable_web_page_preview: true,
    });
    return classifyHttp(res);
  }

  async sendPhoto(input: TelegramMediaSendInput): Promise<DeliveryFailureCategory | null> {
    return this.sendMedia('/sendPhoto', 'photo', input);
  }

  async sendDocument(input: TelegramMediaSendInput): Promise<DeliveryFailureCategory | null> {
    return this.sendMedia('/sendDocument', 'document', input);
  }

  async answerCallbackQuery(
    input: TelegramCallbackAnswerInput,
  ): Promise<DeliveryFailureCategory | null> {
    const res = await this.post('/answerCallbackQuery', {
      callback_query_id: input.callbackQueryId,
      ...(input.text ? { text: input.text } : {}),
    });
    return classifyHttp(res);
  }

  private async sendMedia(
    path: '/sendPhoto' | '/sendDocument',
    field: 'photo' | 'document',
    input: TelegramMediaSendInput,
  ): Promise<DeliveryFailureCategory | null> {
    await this.pace(input.chatId);
    const form = new FormData();
    form.append('chat_id', String(input.chatId));
    form.append('caption', input.text);
    if (input.replyMarkup) form.append('reply_markup', JSON.stringify(input.replyMarkup));
    const filename = input.mime === 'application/pdf' ? 'payment-proof.pdf' : 'payment-proof.png';
    form.append(field, new Blob([Buffer.from(input.buffer)], { type: input.mime }), filename);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.api}/bot${this.botToken}${path}`, {
        method: 'POST',
        body: form,
      });
    } catch (err) {
      void err;
      return 'TRANSIENT';
    }
    this.lastSentPerChat.set(input.chatId, Date.now());
    return classifyHttp(res);
  }

  private async pace(chatId: bigint): Promise<void> {
    const last = this.lastSentPerChat.get(chatId);
    if (last !== undefined) {
      const waited = Date.now() - last;
      if (waited < TELEGRAM_MIN_SEND_INTERVAL_MS) {
        await sleep(TELEGRAM_MIN_SEND_INTERVAL_MS - waited);
      }
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.api}/bot${this.botToken}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      void err;
      return { ok: false, status: 0 } as Response; // marks a network failure for classifyHttp
    }
  }
}

/** Map a Bot API response to a delivery category (0/fetch throw → TRANSIENT). */
function classifyHttp(res: Response): DeliveryFailureCategory | null {
  if (res.ok) return null;
  const status = res.status;
  if (status === 0) return 'TRANSIENT'; // network unreachable → retry with backoff
  if (status === 401 || status === 403) return 'PROVIDER_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400) return 'CHAT_INVALID'; // chat not found / bot blocked/etc.
  return 'TRANSIENT'; // 5xx and friends
}

const TELEGRAM_MIN_SEND_INTERVAL_MS = 3_200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify a MailService `sendStrict` failure (nodemailer/transport thrown)
 * into a delivery category. Conservative: SMTP graylisting (4xx), timeouts and
 * connection errors are transient; hard mailbox rejections dead-letter; auth
 * problems are a permanent provider error.
 */
export function classifyMailError(err: unknown): DeliveryFailureCategory {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const msg = String(e?.message ?? '');
  if (typeof e?.code === 'string') {
    const code = e.code.toUpperCase();
    if (code === 'EAUTH') return 'PROVIDER_ERROR';
    if (code === 'EDNS') return 'PROVIDER_ERROR';
    if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') return 'TRANSIENT';
  }
  if (typeof e?.responseCode === 'number') {
    if (e.responseCode >= 500) return 'INVALID_RECIPIENT'; // 5xx => address rejected
    if (e.responseCode >= 400) return 'TRANSIENT'; // 4xx => graylisting etc.
  }
  if (/getaddr|ENOTFOUND/i.test(msg)) return 'TRANSIENT';
  return 'TRANSIENT';
}

/** Build the live TelegramProvider from config (mirrors MailService selection). */
export function telegramProviderFromConfig(config: {
  appEnv: string;
  telegramEnabled: boolean;
  telegramBotToken?: string;
}): TelegramProvider {
  if (config.appEnv === 'test') return new FakeTelegramProvider();
  if (config.telegramEnabled && config.telegramBotToken) {
    return new HttpTelegramProvider(config.telegramBotToken);
  }
  return new DisabledTelegramProvider();
}
