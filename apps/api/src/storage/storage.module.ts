import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { STORAGE_PROVIDER_TOKEN } from './storage-provider';
import { MemoryStorageProvider } from './memory-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER_TOKEN,
      useFactory: (config: AppConfig) => {
        if (config.storageProvider === 's3') {
          return new S3StorageProvider(config);
        }
        if (config.appEnv === 'production') {
          throw new Error('STORAGE_PROVIDER=memory is forbidden in production.');
        }
        return new MemoryStorageProvider();
      },
      inject: [APP_CONFIG],
    },
    StorageService,
  ],
  exports: [StorageService, STORAGE_PROVIDER_TOKEN],
})
export class StorageModule {}
