import { describe, expect, it } from 'vitest';
import {
  APP_TIMEZONE_DESIGN_DEFAULT,
  ConfigValidationError,
  PRODUCT_PENDING_CLARIFICATIONS,
  loadAndValidateConfig,
  parseConfig,
  reportPendingProductParameters,
} from './app-config';

const base: Record<string, string | undefined> = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x:y@localhost:5432/werefa' };

describe('parseConfig', () => {
  it('applies defaults for unset optional fields', () => {
    const config = parseConfig(base);
    expect(config.nodeEnv).toBe('test');
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(config.corsOrigins).toEqual([]);
    expect(config.bodyLimit).toBe('1mb');
    expect(config.trustProxy).toBe(false);
  });

  it('coerces numeric + boolean fields', () => {
    const config = parseConfig({
      ...base,
      PORT: '8080',
      TRUST_PROXY: 'true',
      RUN_DB_TESTS: '1',
      CORS_ORIGINS: 'http://localhost:5173, https://werefa.app',
    });
    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(true);
    expect(config.runDbTests).toBe(true);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://werefa.app']);
  });

  it('throws a value-free ConfigValidationError for invalid fields', () => {
    expect(() => parseConfig({ ...base, PORT: 'not-a-number' })).toThrow(ConfigValidationError);
    expect(() => parseConfig({ ...base, NODE_ENV: 'staging' })).toThrow(ConfigValidationError);
    try {
      parseConfig({ ...base, PORT: 'not-a-number' });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as ConfigValidationError).issues.join(',')).toContain('port');
      expect((err as ConfigValidationError).message).not.toContain('not-a-number');
    }
  });

  it('does not intend to invent pending product parameter values', () => {
    const config = parseConfig(base);
    expect(config.productParameters.subscriptionMonthlyPriceMinor).toBeNull();
    expect(config.productParameters.reminderLeadDays).toBeNull();
    expect(config.productParameters.ownerBookingReportPdfEnabled).toBeNull();
    expect(config.productParameters.ownerBookingModifyComponents).toBeNull();
    expect(config.productParameters.showTimezoneAbbreviation).toBeNull();
    expect(config.productParameters.appTimezone).toBe(APP_TIMEZONE_DESIGN_DEFAULT);
  });

  it('records all six pending clarifications in the report without values', () => {
    const config = parseConfig(base);
    const report = reportPendingProductParameters(config);
    expect(report.status).toBe('PENDING_CLARIFICATION');
    expect(report.items).toHaveLength(6);
    expect(report.items.map((i) => i.key)).toEqual(PRODUCT_PENDING_CLARIFICATIONS.map((c) => c.key));
    expect(JSON.stringify(report)).not.toContain(':null,');
    expect(JSON.stringify(report)).not.toContain('Africa/Addis_Ababa');
  });
});

describe('loadAndValidateConfig (invariants)', () => {
  it('requires DATABASE_URL in production', () => {
    expect(() => loadAndValidateConfig({ NODE_ENV: 'production' })).toThrow(ConfigValidationError);
  });

  it('accepts a production config with all required pieces', () => {
    const config = loadAndValidateConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app:pass@db:5432/werefa',
    });
    expect(config.nodeEnv).toBe('production');
  });

  it('allows empty product parameter values without error', () => {
    const config = loadAndValidateConfig({
      NODE_ENV: 'test',
      DATABASE_URL: '',
      PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR: '',
      PRODUCT_REMINDER_LEAD_DAYS: '',
    });
    expect(config.productParameters.subscriptionMonthlyPriceMinor).toBeNull();
  });
});