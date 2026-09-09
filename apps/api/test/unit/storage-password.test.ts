import { describe, expect, it } from 'vitest';
import { PasswordService } from '../../apps/api/src/iam/password.service';
import { MemoryStorageProvider } from '../../apps/api/src/storage/memory-storage.provider';
import { StorageService } from '../../apps/api/src/storage/storage.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies a matching password (argon2id)', async () => {
    const h = await svc.hash('DevPass-12345');
    expect(h.startsWith('$argon2id$')).toBe(true);
    await expect(svc.verify(h, 'DevPass-12345')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const h = await svc.hash('right-password');
    await expect(svc.verify(h, 'wrong-password')).resolves.toBe(false);
  });

  it('produces unique salts', async () => {
    const [a, b] = await Promise.all([svc.hash('same'), svc.hash('same')]);
    expect(a).not.toBe(b);
  });
});

describe('MemoryStorageProvider', () => {
  const provider = new MemoryStorageProvider();
  const svc = new StorageService(provider, { appEnv: 'development' } as unknown as Parameters<
    typeof StorageService.prototype.constructor
  >[1]);

  it('stores and reads back blobs under a tenant-scoped key', async () => {
    const { key } = await svc.put('biz-a', 'CUSTOMER_PROOF', Buffer.from('hello'), 'text/plain');
    expect(key).toContain('biz-a');
    const data = await svc.get(key);
    expect(data?.toString()).toBe('hello');
  });

  it('returns null for missing keys', async () => {
    expect(await svc.get('biz-a/CUSTOMER_PROOF/missing')).toBeNull();
  });

  it('presigns reads only for existing keys', async () => {
    const { key } = await svc.put('biz-a', 'LOGO', Buffer.from('logo'), 'image/png');
    expect((await svc.presignRead(key, 60)) ?? '').toContain(key);
    expect(await svc.presignRead('biz-a/LOGO/missing', 60)).toBeNull();
  });

  it('deletes keys', async () => {
    const { key } = await svc.put('biz-a', 'COVER', Buffer.from('cv'), 'image/jpeg');
    await svc.delete(key);
    expect(await svc.get(key)).toBeNull();
  });
});
