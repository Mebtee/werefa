import { Global, Module } from '@nestjs/common';
import { CONFIG } from './config.constants';
import { AppConfig } from './app-config';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig) {
    return {
      global: true,
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}