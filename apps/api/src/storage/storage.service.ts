import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { STORAGE_PROVIDER_TOKEN, type StorageProvider } from './storage-provider';

export interface StoredObject {
  key: string;
  url?: string;
  sizeBytes: number;
}

/**
 * Storage abstraction (doc 16).
 *
 * Foundation provides:
 *  - interface + get/presign/put/delete
 *  - memory backend (dev / tests) and S3-compatible backend (MinIO / prod)
 *  - tenant-scoped key convention: {env}/business/{businessId}/... enforced by
 *    callers and checked here when a tenant hint is provided.
 *
 * Proof objects are NEVER placed on a public URL — presigned read requires an
 * actor check done by the caller.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly provider: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Whether uploads are served from a public bucket (never for proofs). */
  async put(
    tenantBusinessId: string | undefined,
    category: 'CUSTOMER_PROOF' | 'SUBSCRIPTION_PROOF' | 'LOGO' | 'COVER' | 'REPORT_PDF',
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const key = this.buildKey(tenantBusinessId, category);
    const sizeBytes = body.byteLength;
    await this.provider.put(key, body, contentType);
    return { key, sizeBytes };
  }

  presignRead(key: string, expiresSeconds = 300): Promise<string | null> {
    return this.provider.presignRead(key, expiresSeconds);
  }

  get(key: string): Promise<Buffer | null> {
    return this.provider.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.provider.delete(key);
  }

  private buildKey(
    businessId: string | undefined,
    category: 'CUSTOMER_PROOF' | 'SUBSCRIPTION_PROOF' | 'LOGO' | 'COVER' | 'REPORT_PDF',
  ): string {
    if (!businessId) throw new Error('businessId required for tenant-scoped object keys');
    return `${this.config.appEnv}/business/${businessId}/${category}/${randomUUID()}`;
  }
}
