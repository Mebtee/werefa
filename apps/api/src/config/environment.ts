/**
 * Typed environment configuration for the API.
 *
 * Rules (architecture doc 24 / security model):
 *  - All values are validated at boot; the process fails fast with a clear,
 *    non-secret error when required values are invalid.
 *  - Secrets are never logged: `masked()` output hides password/token/secret
 *    values.
 */
export type AppEnvVariant = 'development' | 'test' | 'production';

/** NestJS DI token for the parsed AppConfig. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  appEnv: AppEnvVariant;
  nodeEnv: string;
  logLevel: string;
  port: number;
  timezone: string;

  databaseUrl: string; // runtime (app role, RLS)
  databaseMigratorUrl: string; // DDL migrations

  redisUrl: string;
  jobQueueName: string;

  storageProvider: 'memory' | 's3';
  s3Endpoint?: string;
  s3Region: string;
  s3BucketPrivate: string;
  s3BucketPublic: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;

  mailProvider: 'mailhog' | 'ses' | 'smtp';
  mailFrom: string;

  /** Notifications & Telegram delivery tuning (Prompt 13 / docs 12, 13, 17). */
  telegramEnabled: boolean;
  telegramBotToken?: string; // never logged; masked
  telegramBotUsername?: string; // public bot handle used in t.me links
  telegramWebhookSecret?: string; // shared secret for the webhook (masked)
  telegramTokenTtlMinutes: number;
  telegramConnectRateLimitMax: number;
  telegramConnectRateLimitWindowMs: number;
  telegramWebhookRateLimitMax: number;
  telegramWebhookRateLimitWindowMs: number;
  deliveryRetryMaxAttempts: number;
  deliveryRetryBaseDelayMs: number;
  deliveryRetryMaxDelayMs: number;
  deliveryFanoutMaxRows: number;
  deliveryRetryBatchSize: number;

  sessionCookieName: string;
  sessionTtlMinutes: number;
  cookieSecure: boolean;

  rateLimitMax: number;
  rateLimitWindowMs: number;

  /** Identity/authentication tuning (REQ-193 and friends). */
  maxFailedLogins: number;
  lockoutMinutes: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  recoveryRateLimitMax: number;
  recoveryRateLimitWindowMs: number;
  resetTokenTtlMinutes: number;
  recoveryCodeTtlMinutes: number;
  verificationTokenTtlMinutes: number;
  passwordMinLength: number;
  passwordMaxLength: number;
  publicBaseUrl: string;
}

const BOOL_TRUE = new Set(['true', '1', 'yes']);
const BOOL_FALSE = new Set(['false', '0', 'no']);

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (v === undefined || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v.trim() === '' ? undefined : v;
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (BOOL_TRUE.has(v)) return true;
  if (BOOL_FALSE.has(v)) return false;
  return fallback;
}

function asInt(value: string | undefined, fallback: number): number {
  const v = value === undefined ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

/** Keys whose values must never be printed in logs / error messages. */
const SECRET_KEYS = new Set([
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'DATABASE_URL_SUPERUSER',
  'REDIS_URL',
  'S3_SECRET_ACCESS_KEY',
  'S3_ACCESS_KEY_ID',
  'TG_BOT_TOKEN',
  'TG_WEBHOOK_SECRET',
]);

/** Returns a redacted, safe representation of the given env for display. */
export function maskedEnv(env: NodeJS.ProcessEnv, config: AppConfig): Record<string, string> {
  return {
    appEnv: config.appEnv,
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    port: String(config.port),
    timezone: config.timezone,
    storageProvider: config.storageProvider,
    mailProvider: config.mailProvider,
    sessionCookieName: config.sessionCookieName,
    sessionTtlMinutes: String(config.sessionTtlMinutes),
    cookieSecure: String(config.cookieSecure),
    rateLimitMax: String(config.rateLimitMax),
    rateLimitWindowMs: String(config.rateLimitWindowMs),
    maxFailedLogins: String(config.maxFailedLogins),
    lockoutMinutes: String(config.lockoutMinutes),
    authRateLimitMax: String(config.authRateLimitMax),
    // secret-bearing values are masked
    ...Object.fromEntries([...SECRET_KEYS].map((k) => [k, env[k] ? '***' : '(unset)'])),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnvRaw = (env.APP_ENV ?? 'development').trim();
  const appEnv: AppEnvVariant =
    appEnvRaw === 'production' || appEnvRaw === 'test' ? appEnvRaw : 'development';

  const config: AppConfig = {
    appEnv,
    nodeEnv: env.NODE_ENV ?? appEnv,
    logLevel: env.LOG_LEVEL ?? 'info',
    port: asInt(env.PORT, 3000),
    timezone: env.APP_TIMEZONE ?? 'Africa/Addis_Ababa',

    databaseUrl: required(env, 'DATABASE_URL'),
    databaseMigratorUrl: required(env, 'DATABASE_MIGRATOR_URL'),

    redisUrl: required(env, 'REDIS_URL'),
    jobQueueName: env.JOB_QUEUE_NAME ?? 'werefa-jobs',

    storageProvider: env.STORAGE_PROVIDER === 's3' ? 's3' : 'memory',
    s3Endpoint: optional(env, 'S3_ENDPOINT'),
    s3Region: env.S3_REGION ?? 'us-east-1',
    s3BucketPrivate: env.S3_BUCKET_PRIVATE ?? 'werefa-private',
    s3BucketPublic: env.S3_BUCKET_PUBLIC ?? 'werefa-public',
    s3AccessKeyId: optional(env, 'S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: optional(env, 'S3_SECRET_ACCESS_KEY'),
    s3ForcePathStyle: asBool(env.S3_FORCE_PATH_STYLE, true),

    mailProvider:
      env.MAIL_PROVIDER === 'ses' || env.MAIL_PROVIDER === 'smtp' ? env.MAIL_PROVIDER : 'mailhog',
    mailFrom: env.MAIL_FROM ?? 'no-reply@werefa.local',

    telegramEnabled: asBool(env.TELEGRAM_ENABLED, false),
    telegramBotToken: optional(env, 'TG_BOT_TOKEN'),
    telegramBotUsername: optional(env, 'TG_BOT_USERNAME'),
    telegramWebhookSecret: optional(env, 'TG_WEBHOOK_SECRET'),
    telegramTokenTtlMinutes: asInt(env.TELEGRAM_TOKEN_TTL_MINUTES, 30),
    telegramConnectRateLimitMax: asInt(env.TELEGRAM_CONNECT_RATE_LIMIT_MAX, 10),
    telegramConnectRateLimitWindowMs: asInt(env.TELEGRAM_CONNECT_RATE_LIMIT_WINDOW_MS, 3_600_000),
    telegramWebhookRateLimitMax: asInt(env.TELEGRAM_WEBHOOK_RATE_LIMIT_MAX, 120),
    telegramWebhookRateLimitWindowMs: asInt(env.TELEGRAM_WEBHOOK_RATE_LIMIT_WINDOW_MS, 60_000),
    deliveryRetryMaxAttempts: asInt(env.DELIVERY_RETRY_MAX_ATTEMPTS, 8),
    deliveryRetryBaseDelayMs: asInt(env.DELIVERY_RETRY_BASE_DELAY_MS, 30_000),
    deliveryRetryMaxDelayMs: asInt(env.DELIVERY_RETRY_MAX_DELAY_MS, 43_200_000),
    deliveryFanoutMaxRows: asInt(env.DELIVERY_FANOUT_MAX_ROWS, 500),
    deliveryRetryBatchSize: asInt(env.DELIVERY_RETRY_BATCH_SIZE, 200),

    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'wrf.sid',
    sessionTtlMinutes: asInt(env.SESSION_TTL_MINUTES, 14 * 24 * 60),
    cookieSecure: asBool(env.COOKIE_SECURE, true),

    rateLimitMax: asInt(env.RATE_LIMIT_MAX, 100),
    rateLimitWindowMs: asInt(env.RATE_LIMIT_WINDOW_MS, 60_000),

    maxFailedLogins: asInt(env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: asInt(env.LOCKOUT_MINUTES, 15),
    authRateLimitMax: asInt(env.AUTH_RATE_LIMIT_MAX, 40),
    authRateLimitWindowMs: asInt(env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
    recoveryRateLimitMax: asInt(env.RECOVERY_RATE_LIMIT_MAX, 3),
    recoveryRateLimitWindowMs: asInt(env.RECOVERY_RATE_LIMIT_WINDOW_MS, 900_000),
    resetTokenTtlMinutes: asInt(env.RESET_TOKEN_TTL_MINUTES, 30),
    recoveryCodeTtlMinutes: asInt(env.RECOVERY_CODE_TTL_MINUTES, 15),
    verificationTokenTtlMinutes: asInt(env.VERIFICATION_TOKEN_TTL_MINUTES, 30),
    passwordMinLength: asInt(env.PASSWORD_MIN_LENGTH, 12),
    passwordMaxLength: asInt(env.PASSWORD_MAX_LENGTH, 128),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
  };

  return config;
}
