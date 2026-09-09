import { Injectable } from '@nestjs/common';
import type { StorageProvider } from './storage-provider';

/**
 * In-memory storage backend. Dev / tests only — NOT durable, NEVER used in
 * production. Inserting it under `STORAGE_PROVIDER=memory` is guarded by the
 * config (production force-fails on memory, see storage.module).
 */
@Injectable()
export class MemoryStorageProvider implements StorageProvider {
  private readonly store = new Map<string, Buffer>();

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    this.store.set(key, Buffer.from(body));
  }

  async get(key: string): Promise<Buffer | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async presignRead(key: string, _expiresSeconds: number): Promise<string | null> {
    return this.store.has(key) ? `memory://${key}` : null;
  }
}
