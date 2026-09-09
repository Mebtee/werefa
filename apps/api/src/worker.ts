/**
 * Worker process entrypoint. Runs the BullMQ workers only (no HTTP server).
 * Env: NODE_ENV/APP_ENV development|production.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from './common/logger/logger';

async function workerMain(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = app.get(Logger);
  logger.info('Worker online (BullMQ consumers registered)');
}

workerMain().catch((err) => {
  console.error('Fatal while starting worker:', err);
  process.exit(1);
});
