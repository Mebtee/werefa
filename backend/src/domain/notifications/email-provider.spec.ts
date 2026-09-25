import { describe, expect, it } from 'vitest';
import { DisabledEmailProvider } from './disabled-email-provider';

describe('DisabledEmailProvider', () => {
  it('reports unavailable delivery without accepting a message', async () => {
    const provider = new DisabledEmailProvider();

    expect(provider.isConfigured()).toBe(false);
    await expect(
      provider.send({
        to: 'recipient@example.com',
        subject: 'Subject',
        template: 'security.lockout',
        data: { ip: '192.0.2.1' },
        idempotencyKey: 'test-key',
      }),
    ).resolves.toEqual({ ok: false, accepted: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
  });
});