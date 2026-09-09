import { Inject, Injectable } from '@nestjs/common';
import { pino, type Logger as PinoLogger } from 'pino';
import { APP_CONFIG, type AppConfig } from '../../config/environment';

/**
 * Application logger.
 *
 * Never logs secrets: `redact` removes secret-typical fields at the serializer
 * level (defense in depth — fields are also excluded before calling pino).
 */
@Injectable()
export class Logger {
  private readonly logger: PinoLogger;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.logger = pino({
      level: config.logLevel || 'info',
      base: { app: 'werefa-api' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.password_hash',
          '*.token',
          '*.token_hash',
          '*.secret',
          '*.code',
          '*.key',
          '*.accessKey',
          '*.access_key',
          'DATABASE_URL',
          'DATABASE_MIGRATOR_URL',
          'REDIS_URL',
          'S3_SECRET_ACCESS_KEY',
        ],
        censor: '[REDACTED]',
      },
    });
    globalThis.werefaLogger = this.logger;
  }

  child(fields?: Record<string, unknown>) {
    return this.logger.child(fields ?? {});
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    if (fields) this.logger.info(fields, msg);
    else this.logger.info(msg);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    if (fields) this.logger.warn(fields, msg);
    else this.logger.warn(msg);
  }

  error(msg: string, fields?: Record<string, unknown>, err?: unknown): void {
    if (err) this.logger.error({ ...(fields ?? {}), err }, msg);
    else if (fields) this.logger.error(fields, msg);
    else this.logger.error(msg);
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    if (fields) this.logger.debug(fields, msg);
    else this.logger.debug(msg);
  }

  fatal(msg: string, fields?: Record<string, unknown>, err?: unknown): void {
    if (err) this.logger.fatal({ ...(fields ?? {}), err }, msg);
    else if (fields) this.logger.fatal(fields, msg);
    else this.logger.fatal(msg);
  }

  get raw(): PinoLogger {
    return this.logger;
  }
}

declare global {
  // Global access for non-injectable spots (e.g. workers). Set by Logger.

  var werefaLogger: PinoLogger | undefined;
}
