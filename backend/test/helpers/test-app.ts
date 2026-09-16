import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AppConfig, loadAndValidateConfig } from '../../src/config/app-config';
import { configureApp } from '../../src/app.setup';
import { DATABASE, DatabasePing, DatabasePort } from '../../src/database/database.port';

export class FakeDatabase implements DatabasePort {
  constructor(
    private readonly opts: { configured?: boolean; fail?: boolean } = {},
  ) {}

  get configured(): boolean {
    return this.opts.configured ?? true;
  }

  async ping(): Promise<DatabasePing> {
    if (this.opts.fail) return { ok: false as const, message: 'fake database unavailable' };
    return { ok: true as const, latencyMs: 0 };
  }
}

export interface TestAppOptions {
  env?: Record<string, string | undefined>;
  database?: DatabasePort;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<{ app: INestApplication; config: AppConfig }> {
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ...options.env,
  };
  const config = loadAndValidateConfig(env);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  })
    .overrideProvider(DATABASE)
    .useValue(options.database ?? new FakeDatabase())
    .compile();

  const app: NestExpressApplication = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  await configureApp(app, config);
  await app.init();
  return { app, config };
}