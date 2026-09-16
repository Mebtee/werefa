import { Global, Module } from '@nestjs/common';
import { CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/app-config';
import { createPinoLogger, createHttpLogger } from './pino.factory';
import { PinoLoggerService } from './pino-logger.service';
import { Logger as PinoLogger } from 'pino';

export const LOGGER = Symbol('LOGGER');
export const LOGGER_HTTP = Symbol('LOGGER_HTTP');

@Global()
@Module({
  providers: [
    {
      provide: LOGGER,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => createPinoLogger(config),
    },
    {
      provide: LOGGER_HTTP,
      inject: [CONFIG, LOGGER],
      useFactory: (config: AppConfig, base: PinoLogger) => createHttpLogger(config, base),
    },
    {
      provide: PinoLoggerService,
      inject: [LOGGER],
      useFactory: (pinoLogger: PinoLogger) => new PinoLoggerService(pinoLogger),
    },
  ],
  exports: [LOGGER, LOGGER_HTTP, PinoLoggerService],
})
export class LoggingModule {}