import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig, loadConfigFromFileSystem } from './config/app-config';
import { configureApp } from './app.setup';

/**
 * Bootstrap. Fails fast with an aggregated, value-free validation report when
 * the environment is invalid; then builds the app (fail-fast DB connect when
 * configured) and starts listening.
 */
async function bootstrap(): Promise<void> {
  const config: AppConfig = loadConfigFromFileSystem();

  const app: NestExpressApplication = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  await configureApp(app, config);

  await app.listen(config.port, config.host);
}

void bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n[SERVER BOOT FAILED]\n${message}\n`);
  process.exitCode = 1;
});