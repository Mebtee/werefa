import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Central typed configuration for the Werefa backend.
 *
 * `parseConfig` performs fail-fast validation of the process environment at
 * startup (and at test construction time). It never echoes values back in
 * error output — only field names — so secrets are never logged.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const APP_TIMEZONE_DESIGN_DEFAULT = 'Africa/Addis_Ababa';

/**
 * The six genuinely unresolved product decisions from the canonical
 * specification §46 ("SPECIFICATION CLARIFICATION REQUIRED").
 *
 * Implementation may only expose these as configuration boundaries; it must
 * not invent values. Fields remain unset until the Product Owner confirms.
 */
export const PRODUCT_PENDING_CLARIFICATIONS = [
  {
    key: 'PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR',
    specRef: 'spec §46 item 1 (REQ-125)',
    note: 'Subscription monthly price (minor currency units). No numeric value defined in any approved source.',
  },
  {
    key: 'PRODUCT_APP_TIMEZONE',
    specRef: 'spec §46 item 2 (REQ-222)',
    note: 'Global timezone identity. Architecture default Africa/Addis_Ababa is design-level only; product confirmation pending.',
  },
  {
    key: 'PRODUCT_REMINDER_LEAD_DAYS',
    specRef: 'spec §46 item 3 (REQ-139)',
    note: 'Subscription-reminder lead time default (architecture proposes 3 days); product confirmation pending.',
  },
  {
    key: 'PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED',
    specRef: 'spec §46 item 4 (Section 25.3)',
    note: 'Owner-facing booking-report PDF export; pending clarification.',
  },
  {
    key: 'PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS',
    specRef: 'spec §46 item 5 (REQ-105)',
    note: 'Owner "modify" scope: whether services/components of an existing booking may be changed.',
  },
  {
    key: 'PRODUCT_SHOW_TIMEZONE_ABBREVIATION',
    specRef: 'spec §46 item 6 (BR-32)',
    note: 'Dashboard timezone-abbreviation display rule.',
  },
] as const;

export type ProductPendingKey = (typeof PRODUCT_PENDING_CLARIFICATIONS)[number]['key'];

export interface ProductParameter {
  key: ProductPendingKey;
  specRef: string;
  status: 'PENDING_CLARIFICATION';
  value: string | number | boolean | null;
  note: string;
}

export interface ReportedProductParameters {
  status: 'PENDING_CLARIFICATION';
  items: { key: ProductPendingKey; specRef: string; status: 'PENDING_CLARIFICATION' }[];
}

const boolish = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => {
      if (v === undefined) return def;
      return ['true', '1', 'yes'].includes(v);
    });

export const appConfigSchema = z.object({
  nodeEnv: z.enum(NODE_ENVS).default('development'),
  host: z.string().min(1).default('0.0.0.0'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  logPretty: boolish(false),
  corsOrigins: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  bodyLimit: z.string().min(1).default('1mb'),
  trustProxy: boolish(false),
  authTestEnabled: boolish(false),
  databaseUrl: z.string().optional(),
  migratorDatabaseUrl: z.string().optional(),
  testDatabaseUrl: z.string().optional(),
  runDbTests: boolish(false),
  authSessionTtlHours: z.coerce.number().int().min(1).max(720).default(12),
  authRecoveryTtlMinutes: z.coerce.number().int().min(5).max(60).default(15),
  authRecoveryMaxAttempts: z.coerce.number().int().min(1).max(10).default(5),
  authRecoveryCodeLength: z.coerce.number().int().min(6).max(8).default(6),
  authCookieName: z.string().min(1).max(64).default('werefa_session'),
  productParameters: z.object({
    subscriptionMonthlyPriceMinor: z.number().int().positive().nullable().default(null),
    appTimezone: z.string().min(1).default(APP_TIMEZONE_DESIGN_DEFAULT),
    reminderLeadDays: z.number().int().nonnegative().nullable().default(null),
    ownerBookingReportPdfEnabled: z.boolean().nullable().default(null),
    ownerBookingModifyComponents: z.boolean().nullable().default(null),
    showTimezoneAbbreviation: z.boolean().nullable().default(null),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export class ConfigValidationError extends Error {
  constructor(
    public readonly issues: string[],
    message = 'Invalid backend configuration.',
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

const PRODUCT_ENV_MAP: Record<ProductPendingKey, string> = {
  PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR: 'PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR',
  PRODUCT_APP_TIMEZONE: 'PRODUCT_APP_TIMEZONE',
  PRODUCT_REMINDER_LEAD_DAYS: 'PRODUCT_REMINDER_LEAD_DAYS',
  PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED: 'PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED',
  PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS: 'PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS',
  PRODUCT_SHOW_TIMEZONE_ABBREVIATION: 'PRODUCT_SHOW_TIMEZONE_ABBREVIATION',
};

function toNullableNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullableBoolean(v: string | undefined): boolean | null {
  if (v === undefined || v.trim() === '') return null;
  return ['true', '1', 'yes'].includes(v.trim().toLowerCase());
}

function orderedProductValues(env: Record<string, string | undefined>): Record<ProductPendingKey, unknown> {
  return {
    PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR: toNullableNumber(
      env[PRODUCT_ENV_MAP.PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR],
    ),
    PRODUCT_APP_TIMEZONE: env[PRODUCT_ENV_MAP.PRODUCT_APP_TIMEZONE] ?? APP_TIMEZONE_DESIGN_DEFAULT,
    PRODUCT_REMINDER_LEAD_DAYS: toNullableNumber(env[PRODUCT_ENV_MAP.PRODUCT_REMINDER_LEAD_DAYS]),
    PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED: toNullableBoolean(
      env[PRODUCT_ENV_MAP.PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED],
    ),
    PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS: toNullableBoolean(
      env[PRODUCT_ENV_MAP.PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS],
    ),
    PRODUCT_SHOW_TIMEZONE_ABBREVIATION: toNullableBoolean(env[PRODUCT_ENV_MAP.PRODUCT_SHOW_TIMEZONE_ABBREVIATION]),
  };
}

function rawToParsed(env: Record<string, string | undefined>): z.infer<typeof appConfigSchema> {
  const productRaw = orderedProductValues(env);
  const parsed = appConfigSchema.parse({
    nodeEnv: env.NODE_ENV || undefined,
    host: env.HOST || undefined,
    port: env.PORT || undefined,
    logLevel: env.LOG_LEVEL || undefined,
    logPretty: env.LOG_PRETTY || undefined,
    corsOrigins: env.CORS_ORIGINS || undefined,
    bodyLimit: env.BODY_LIMIT || undefined,
    trustProxy: env.TRUST_PROXY || undefined,
    authTestEnabled: env.AUTH_TEST_ENABLED || undefined,
    databaseUrl: env.DATABASE_URL || undefined,
    migratorDatabaseUrl: env.MIGRATOR_DATABASE_URL || undefined,
    testDatabaseUrl: env.TEST_DATABASE_URL || undefined,
    runDbTests: env.RUN_DB_TESTS || undefined,
    authSessionTtlHours: env.AUTH_SESSION_TTL_HOURS || undefined,
    authRecoveryTtlMinutes: env.AUTH_RECOVERY_TTL_MINUTES || undefined,
    authRecoveryMaxAttempts: env.AUTH_RECOVERY_MAX_ATTEMPTS || undefined,
    authRecoveryCodeLength: env.AUTH_RECOVERY_CODE_LENGTH || undefined,
    authCookieName: env.AUTH_COOKIE_NAME || undefined,
    productParameters: {
      subscriptionMonthlyPriceMinor: productRaw.PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR as number | null,
      appTimezone: productRaw.PRODUCT_APP_TIMEZONE as string,
      reminderLeadDays: productRaw.PRODUCT_REMINDER_LEAD_DAYS as number | null,
      ownerBookingReportPdfEnabled: productRaw.PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED as boolean | null,
      ownerBookingModifyComponents: productRaw.PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS as boolean | null,
      showTimezoneAbbreviation: productRaw.PRODUCT_SHOW_TIMEZONE_ABBREVIATION as boolean | null,
    },
  });
  return parsed;
}

/**
 * Validate and type the raw environment. Throws ConfigValidationError with the
 * aggregated (value-free) field names on failure.
 */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  try {
    return rawToParsed(env);
  } catch (err) {
    const issues: string[] = [];
    if (err instanceof z.ZodError) {
      for (const issue of err.issues) {
        const path = issue.path.join('.');
        issues.push(`${path || '(root)'}: ${issue.message}`);
      }
    } else {
      issues.push(err instanceof Error ? err.message : String(err));
    }
    throw new ConfigValidationError(issues);
  }
}

/**
 * Additional cross-field rules that are not expressible in the zod schema.
 */
export function assertConfigInvariants(config: AppConfig): void {
  const issues: string[] = [];

  if (config.nodeEnv === 'production' && !config.databaseUrl) {
    issues.push('DATABASE_URL is required when NODE_ENV=production');
  }
  if (config.corsOrigins.includes('*') && config.productParameters.ownerBookingReportPdfEnabled === null) {
    // Note: '*' + credentials is not currently used; listed purely as guard.
    issues.push("CORS_ORIGINS must not contain '*' when credentialed traffic is expected");
  }
  if (config.productParameters.subscriptionMonthlyPriceMinor !== null && config.productParameters.subscriptionMonthlyPriceMinor < 0) {
    issues.push('PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR must be a positive integer when set');
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
}

export function loadAndValidateConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const config = parseConfig(env);
  assertConfigInvariants(config);
  return config;
}

/**
 * Load `.env` from the working directory if present (Node >=20.12 API) and
 * return the validated config. Used by main.ts at bootstrap.
 */
export function loadConfigFromFileSystem(): AppConfig {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
  return loadAndValidateConfig(process.env);
}

/** Structured reflection of the pending product clarifications (no values). */
export function reportPendingProductParameters(_config: AppConfig): ReportedProductParameters {
  return {
    status: 'PENDING_CLARIFICATION',
    items: PRODUCT_PENDING_CLARIFICATIONS.map((c) => ({
      key: c.key,
      specRef: c.specRef,
      status: 'PENDING_CLARIFICATION' as const,
    })),
  };
}

export function productParameters(config: AppConfig): ProductParameter[] {
  return PRODUCT_PENDING_CLARIFICATIONS.map((c) => {
    const value =
      c.key === 'PRODUCT_SUBSCRIPTION_MONTHLY_PRICE_MINOR'
        ? config.productParameters.subscriptionMonthlyPriceMinor
        : c.key === 'PRODUCT_APP_TIMEZONE'
          ? config.productParameters.appTimezone
          : c.key === 'PRODUCT_REMINDER_LEAD_DAYS'
            ? config.productParameters.reminderLeadDays
            : c.key === 'PRODUCT_OWNER_BOOKING_REPORT_PDF_ENABLED'
              ? config.productParameters.ownerBookingReportPdfEnabled
              : c.key === 'PRODUCT_OWNER_BOOKING_MODIFY_COMPONENTS'
                ? config.productParameters.ownerBookingModifyComponents
                : config.productParameters.showTimezoneAbbreviation;
    return { key: c.key, specRef: c.specRef, status: 'PENDING_CLARIFICATION', value, note: c.note };
  });
}