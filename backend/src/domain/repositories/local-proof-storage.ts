import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfig } from '../../config/app-config';
import { CONFIG } from '../../config/config.constants';
import { PaymentProofStorage, StoredProof, StoredProofContent } from './proof-storage.port';

const MAX_KEY_DEPTH = 2;
const KEY_SEGMENT = /^[a-z0-9-]+(\.[a-z0-9]+)?$/i;

/**
 * Local-filesystem proof storage (Prompt 50). Keys are `<businessId>/<uuid>.<ext>`
 * and each business is isolated in its own directory under `proofStorageDir`.
 * The provider is swap-in-able later for real object storage without touching
 * the domain.
 */
@Injectable()
export class LocalProofStorage implements PaymentProofStorage {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async store(input: { businessId: string; bytes: Buffer; mimeType: string; extension: string }): Promise<StoredProof> {
    const storageKey = `${input.businessId}/${randomUUID()}.${input.extension}`;
    await this.write(storageKey, input.bytes);
    return {
      storageKey,
      checksumSha256: createHash('sha256').update(input.bytes).digest('hex'),
      sizeBytes: input.bytes.length,
    };
  }

  async read(storageKey: string): Promise<StoredProofContent | null> {
    if (!this.isSafeKey(storageKey)) return null;
    try {
      const bytes = await readFile(this.pathFor(storageKey));
      return { bytes };
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    if (!this.isSafeKey(storageKey)) return;
    try {
      await rm(this.pathFor(storageKey), { force: true });
    } catch {
      // best effort — deletion is advisory cleanup
    }
  }

  private async write(storageKey: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(storageKey);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
  }

  private pathFor(storageKey: string): string {
    return join(this.config.proofStorageDir, ...storageKey.split('/'));
  }

  private isSafeKey(storageKey: string): boolean {
    const segments = storageKey.split('/');
    if (segments.length !== MAX_KEY_DEPTH) return false;
    return segments.every((s) => s.length > 0 && KEY_SEGMENT.test(s));
  }
}