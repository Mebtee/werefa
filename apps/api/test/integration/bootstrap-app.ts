import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/http/exception.filter';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

/**
 * Builds the real Nest application with the same middleware/filter wiring as
 * src/main.ts but without listening — used by HTTP integration tests.
 */
export async function bootstrapApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  return app;
}
