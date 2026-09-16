import { Module } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './common/logging/logging.module';
import { DatabaseModule } from './database/database.module';
import { DomainModule } from './domain/domain.module';
import { DomainServicesModule } from './domain/domain-services.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    LoggingModule,
    DatabaseModule,
    DomainModule,
    DomainServicesModule,
    SystemModule,
  ],
})
export class AppModule {
  static forRoot(config: AppConfig) {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config)],
    };
  }
}