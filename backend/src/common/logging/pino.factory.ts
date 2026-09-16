import { pino, Logger as PinoLogger } from 'pino';
import { pinoHttp, HttpLogger, Options as PinoHttpOptions } from 'pino-http';
import { AppConfig } from '../../config/app-config';
import { Writable } from 'node:stream';

/**
 * pino JSON structured logging (architecture doc 24 §1). Serially redacts
 * sensitive values at the serializer level: never logged are passwords,
 * password hashes, raw session tokens, reset/recovery links, webhook secrets,
 * authorization headers and cookie values.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-webhook-secret"]',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.sessionToken',
  'req.body.token',
  'res.headers["set-cookie"]',
];

export function createPinoLogger(config: AppConfig, destination?: Writable): PinoLogger {
  const options = {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'werefa-backend',
      env: config.nodeEnv,
    },
    ...(config.logPretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'UTC:yyyy-mm-dd HH:MM:ss' } } }
      : {}),
  };
  return destination ? pino(options, destination) : pino(options);
}

export function createHttpLogger(config: AppConfig, baseLogger: PinoLogger): HttpLogger {
  const options: PinoHttpOptions = {
    logger: baseLogger,
    genReqId: (req) =>
      typeof (req.headers['x-request-id'] as string | undefined) === 'string'
        ? (req.headers['x-request-id'] as string)
        : req.id,
    autoLogging: {
      ignore: (req) => req.url?.startsWith('/api/v1/system/health') ?? false,
    },
    customProps: () => ({ env: config.nodeEnv }),
    customLogLevel: (_req, res) => {
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {},
  };
  return pinoHttp(options);
}