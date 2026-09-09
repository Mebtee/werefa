import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/environment';
import { APP_CONFIG, maskedEnv } from './config/environment';
import { GlobalExceptionFilter } from './common/http/exception.filter';
import { Logger } from './common/logger/logger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config: AppConfig = app.get(APP_CONFIG);
  const logger = app.get(Logger);

  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = config.port;
  await app.listen(port);
  logger.info(`API listening on :${port}`, { env: maskedEnv(process.env, config) });
}

bootstrap().catch((err) => {
  console.error('Fatal during bootstrap:', err);
  process.exit(1);
});
