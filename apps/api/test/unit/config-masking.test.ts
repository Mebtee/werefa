import { describe, expect, it } from 'vitest';
import { loadConfig, maskedEnv } from '../../apps/api/src/config/environment';

const BASE_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://app:secret-db@db/werefa',
  DATABASE_MIGRATOR_URL: 'postgresql://migrator:secret-mig@db/werefa',
  REDIS_URL: 'redis://:secret-redis@redis/0',
  S3_ACCESS_KEY_ID: 'AKIA',
  S3_SECRET_ACCESS_KEY: 's3-secret',
  TG_BOT_TOKEN: '123:bot-secret',
  TG_WEBHOOK_SECRET: 'webhook-secret',
};

describe('loadConfig', () => {
  it('fails fast when a required value is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('parses booleans and integers with defaults', () => {
    const cfg = loadConfig({
      ...BASE_ENV,
      COOKIE_SECURE: 'false',
      S3_FORCE_PATH_STYLE: 'no',
      SESSION_TTL_MINUTES: '10080',
      TELEGRAM_ENABLED: 'true',
    });
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.s3ForcePathStyle).toBe(false);
    expect(cfg.sessionTtlMinutes).toBe(10080);
    expect(cfg.port).toBe(3000);
    expect(cfg.appEnv).toBe('development');
    expect(cfg.telegramEnabled).toBe(true);
    expect(cfg.telegramBotToken).toBe('123:bot-secret');
    expect(cfg.deliveryRetryMaxAttempts).toBe(8);
    expect(cfg.deliveryRetryBaseDelayMs).toBe(30_000);
    expect(cfg.telegramTokenTtlMinutes).toBe(30);
  });

  it('recognizes production and test app env', () => {
    expect(loadConfig({ ...BASE_ENV, APP_ENV: 'production' }).appEnv).toBe('production');
    expect(loadConfig({ ...BASE_ENV, APP_ENV: 'test' }).appEnv).toBe('test');
  });
});

describe('maskedEnv', () => {
  it('never exposes secret-bearing values', () => {
    const cfg = loadConfig(BASE_ENV);
    const masked = maskedEnv(BASE_ENV, cfg);
    expect(Object.values(masked)).not.toContain('secret-db');
    expect(Object.values(masked)).not.toContain('secret-mig');
    expect(Object.values(masked)).not.toContain('secret-redis');
    expect(Object.values(masked)).not.toContain('s3-secret');
    expect(Object.values(masked)).not.toContain('AKIA');
    expect(Object.values(masked)).not.toContain('bot-secret');
    expect(Object.values(masked)).not.toContain('webhook-secret');
    expect(masked.DATABASE_URL).toBe('***');
    expect(masked.REDIS_URL).toBe('***');
    expect(masked.TG_BOT_TOKEN).toBe('***');
  });

  it('marks unset secrets as (unset) only when actually absent', () => {
    const masked = maskedEnv({ DATABASE_URL: 'x' } as NodeJS.ProcessEnv, {} as never);
    expect(masked.DATABASE_URL).toBe('***');
    expect(masked.DATABASE_MIGRATOR_URL).toBe('(unset)');
  });
});
