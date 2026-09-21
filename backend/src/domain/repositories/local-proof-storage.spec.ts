import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../../config/app-config';
import { LocalProofStorage } from './local-proof-storage';
import { PROOF_SAMPLES } from '../lib/proof-file';

function makeStorage(dir: string): LocalProofStorage {
  return new LocalProofStorage(parseConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x:y@localhost:5432/werefa', PROOF_STORAGE_DIR: dir }));
}

describe('LocalProofStorage (Prompt 50)', () => {
  let dir: string;
  let storage: LocalProofStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'werefa-proof-storage-'));
    storage = makeStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores under a per-business namespaced key and returns integrity metadata', async () => {
    const bytes = Buffer.from(PROOF_SAMPLES['image/png']);
    const stored = await storage.store({ businessId: 'business-1', bytes, mimeType: 'image/png', extension: 'png' });
    expect(stored.storageKey.startsWith('business-1/')).toBe(true);
    expect(stored.storageKey.endsWith('.png')).toBe(true);
    expect(stored.sizeBytes).toBe(bytes.length);
    expect(stored.checksumSha256).toHaveLength(64);

    const file = await readFile(join(dir, ...stored.storageKey.split('/')));
    expect(file.equals(bytes)).toBe(true);
  });

  it('reads back exact bytes and returns null for unknown keys', async () => {
    const bytes = Buffer.from(PROOF_SAMPLES['application/pdf']);
    const stored = await storage.store({ businessId: 'b', bytes, mimeType: 'application/pdf', extension: 'pdf' });

    const found = await storage.read(stored.storageKey);
    expect(found?.bytes.equals(bytes)).toBe(true);

    expect(await storage.read('b/missing.pdf')).toBeNull();
    expect(await storage.read('missing-key')).toBeNull();
  });

  it('deletes are idempotent and unreachable keys are ignored', async () => {
    const storageOf = makeStorage(dir);
    const stored = await storage.store({ businessId: 'b', bytes: Buffer.from(PROOF_SAMPLES['image/webp']), mimeType: 'image/webp', extension: 'webp' });

    await storageOf.delete(stored.storageKey);
    expect(await storage.read(stored.storageKey)).toBeNull();
    await storageOf.delete(stored.storageKey); // second delete must not throw
  });

  it('rejects path-traversal keys (never writes/reads outside the root)', async () => {
    await storage.store({ businessId: 'b', bytes: Buffer.from('x'), mimeType: 'image/png', extension: 'png' });
    expect(await storage.read('../../etc/passwd')).toBeNull();
    await expect(storage.read('b/../locked')).resolves.toBeNull();
    await storage.delete('../../etc/passwd'); // must not throw
  });

  it('same business keys are unique across calls', async () => {
    const a = await storage.store({ businessId: 'b', bytes: Buffer.from('x'), mimeType: 'image/png', extension: 'png' });
    const b = await storage.store({ businessId: 'b', bytes: Buffer.from('x'), mimeType: 'image/png', extension: 'png' });
    expect(a.storageKey).not.toBe(b.storageKey);
  });
});