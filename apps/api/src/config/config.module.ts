import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig, type AppConfig } from './environment';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

export const APP_CONFIG_TOKEN = APP_CONFIG;
export type { AppConfig };
