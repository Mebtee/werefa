import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EmailVerificationService } from '../../src/iam/email-verification.service';
import { renderPlatformEmail } from '../../src/notifications/platform-emails';

const FIXED_NOW = new Date('2026-09-11T12:00:00.000Z');

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeSuite() {
  const tx = {
    emailVerificationToken: { findFirst: vi.fn(), updateMany: vi.fn() },
    user: { update: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    emailVerificationToken: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<void>) => fn(tx)),
  };
  const password = { hash: vi.fn(async (p: string) => `hashed:${p}`), verify: vi.fn() };
  const security = { record: vi.fn(async () => undefined) };
  const emailer = { sendTo: vi.fn(async () => undefined) };
  const config = {
    verificationTokenTtlMinutes: 30,
    passwordMinLength: 12,
    passwordMaxLength: 128,
  };

  const service = new EmailVerificationService(
    config as never,
    prisma as never,
    password as never,
    security as never,
    emailer as never,
  );

  function freshMocks() {
    tx.emailVerificationToken.findFirst.mockReset();
    tx.emailVerificationToken.updateMany.mockReset();
    tx.user.update.mockReset();
    prisma.user.findUnique.mockReset();
    prisma.user.create.mockReset();
    prisma.user.update.mockReset();
    prisma.emailVerificationToken.findFirst.mockReset();
    prisma.emailVerificationToken.updateMany.mockReset();
    prisma.emailVerificationToken.create.mockReset();
    prisma.$transaction.mockReset();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<void>) => fn(tx));
    password.hash.mockReset();
    password.hash.mockImplementation(async (p: string) => `hashed:${p}`);
    security.record.mockReset();
    security.record.mockImplementation(async () => undefined);
    emailer.sendTo.mockReset();
    emailer.sendTo.mockImplementation(async () => undefined);
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
  }

  /** Returns the raw token passed to the emailer (and asserts one email sent). */
  function rawTokenSent(): string {
    expect(emailer.sendTo).toHaveBeenCalledTimes(1);
    const [, , params] = emailer.sendTo.mock.calls[0] as [string, string, { token: string }];
    return params.token;
  }

  return { tx, prisma, password, security, emailer, service, freshMocks, rawTokenSent };
}

describe('verification platform-email template', () => {
  const config = {
    publicBaseUrl: 'https://dash.werefa.example',
    verificationTokenTtlMinutes: 30,
  } as never;

  it('renders Werefa-branded subject, the deep verify link and the TTL', () => {
    const rendered = renderPlatformEmail(config, 'verification', { token: 'tok_123' });
    expect(rendered.subject).toContain('Werefa');
    expect(rendered.subject).toContain('Verify');
    expect(rendered.text).toContain('https://dash.werefa.example/verify/tok_123');
    expect(rendered.text).toContain('valid 30 minutes');
    expect(rendered.text).toContain('one-time only');
  });

  it('includes an ignore guard so the link cannot be mistaken for required', () => {
    const rendered = renderPlatformEmail(config, 'verification', { token: 'tok_1' });
    expect(rendered.text).toContain('safely ignore');
  });
});

describe('EmailVerificationService token-storage safety', () => {
  it('issue never stores the raw token — DB holds the SHA-256 hash', async () => {
    const { prisma, emailer: _emailer, service, rawTokenSent } = makeSuite();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    await service.register(
      'Owner@Werefa.Test',
      'VeryLongPass-123',
      '127.0.0.1',
      undefined,
      FIXED_NOW,
    );
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'owner@werefa.test',
        passwordHash: 'hashed:VeryLongPass-123',
        role: 'Owner',
        isEmailVerified: false,
      },
      select: { id: true },
    });
    const token = rawTokenSent();
    const created = prisma.emailVerificationToken.create.mock.calls[0][0] as {
      data: { tokenHash: string };
    };
    expect(created.data.tokenHash).toBe(sha256(token));
    expect(created.data.tokenHash).not.toBe(token);
    expect(created.data.expiresAt.getTime()).toBe(FIXED_NOW.getTime() + 30 * 60_000);
  });
});

describe('register', () => {
  it('creates an Owner (never a client-chosen role), issues token, sends email, audits twice', async () => {
    const { prisma, security, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-1' });

    const res = await service.register('new@werefa.test', 'VeryLongPass-123', '127.0.0.1');
    expect(res.message).toContain('request was received');

    // Role is fixed: no field on the input can influence it.
    const createArg = prisma.user.create.mock.calls[0][0] as { data: { role: string } };
    expect(createArg.data.role).toBe('Owner');

    const events = security.record.mock.calls.map((c) => c[0].type);
    expect(events).toContain('REGISTER');
    expect(events).toContain('EMAIL_VERIFICATION_REQUEST');
  });

  it('uniform + fresh link when the email already belongs to an UNVERIFIED owner', async () => {
    const { prisma, emailer, security, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      role: 'Owner',
      isEmailVerified: false,
    });

    await service.register(
      'existing@werefa.test',
      'VeryLongPass-123',
      '127.0.0.1',
      undefined,
      FIXED_NOW,
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    expect(emailer.sendTo).toHaveBeenCalledTimes(1);
    const types = security.record.mock.calls.map((c) => c[0].type);
    expect(types).toEqual(['EMAIL_VERIFICATION_REQUEST']);
    expect(types).not.toContain('REGISTER');
  });

  it('uniform no-op, no email, for an already-verified owner', async () => {
    const { prisma, emailer, security, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      role: 'Owner',
      isEmailVerified: true,
    });
    // The unique email constraint makes the create attempt fail exactly like
    // the real DB would — the service must not crash and must stay uniform.
    prisma.user.create.mockRejectedValue({ code: 'P2002' });

    const res = await service.register('taken@werefa.test', 'VeryLongPass-123');
    expect(res.message).toContain('request was received');
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(emailer.sendTo).not.toHaveBeenCalled();
    expect(security.record).not.toHaveBeenCalled();
  });

  it('uniform no-op, no email, for an existing Admin/SuperAdmin (no enumeration)', async () => {
    const { prisma, emailer, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'Admin',
      isEmailVerified: true,
    });

    const res = await service.register('admin@werefa.test', 'VeryLongPass-123');
    expect(res.message).toContain('request was received');
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(emailer.sendTo).not.toHaveBeenCalled();
  });

  it('uniform response on a unique-constraint race (P2002) — never crashes or enumerates', async () => {
    const { prisma, emailer, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002' });

    const res = await service.register('race@werefa.test', 'VeryLongPass-123');
    expect(res.message).toContain('request was received');
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(emailer.sendTo).not.toHaveBeenCalled();
  });
});

describe('request (resend)', () => {
  it('sends fresh verification to an unverified owner and invalidates the prior token', async () => {
    const { prisma, emailer, security, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      role: 'Owner',
      isEmailVerified: false,
    });

    await service.request('owner@werefa.test', '127.0.0.1', 'chrome', FIXED_NOW);

    expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'owner-1', usedAt: null },
      data: { usedAt: FIXED_NOW },
    });
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    expect(emailer.sendTo).toHaveBeenCalledWith('verification', 'owner@werefa.test', {
      token: expect.any(String),
    });
    const types = security.record.mock.calls.map((c) => c[0].type);
    expect(types).toContain('EMAIL_VERIFICATION_REQUEST');
  });

  it('uniform response and nothing sent for an unknown email or a verified/platform account', async () => {
    for (const existing of [
      null,
      { id: 'o', role: 'Owner', isEmailVerified: true },
      { id: 'a', role: 'Admin', isEmailVerified: true },
    ]) {
      const { prisma, emailer, security, service } = makeSuite();
      prisma.user.findUnique.mockResolvedValue(existing);
      const res = await service.request('x@werefa.test');
      expect(res.message).toContain('If an account exists');
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(emailer.sendTo).not.toHaveBeenCalled();
      expect(security.record).not.toHaveBeenCalled();
    }
  });
});

describe('complete', () => {
  it('marks the user verified, consumes the token, audits, and clears other outstanding tokens', async () => {
    const { tx, security, service } = makeSuite();
    tx.user.update.mockResolvedValue({});
    tx.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'tok-1',
      userId: 'owner-1',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    });
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });

    await service.complete('raw-token', '127.0.0.1', undefined, FIXED_NOW);

    expect(tx.emailVerificationToken.findFirst).toHaveBeenCalledWith({
      where: { tokenHash: sha256('raw-token') },
      select: { id: true, userId: true, usedAt: true, expiresAt: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { isEmailVerified: true },
    });
    const types = security.record.mock.calls.map((c) => c[0].type);
    expect(types).toContain('EMAIL_VERIFICATION_COMPLETE');
    // Audit rows never carry the token value or any password.
    for (const call of security.record.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('raw-token');
      expect(JSON.stringify(call[0])).not.toContain('VeryLongPass');
    }
  });

  it('unknown token → 401 TOKEN_EXPIRED', async () => {
    const { tx, service } = makeSuite();
    tx.emailVerificationToken.findFirst.mockResolvedValue(null);

    await expect(service.complete('bad', undefined, undefined, FIXED_NOW)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
      httpStatus: 401,
    });
  });

  it('expired token → 401 TOKEN_EXPIRED', async () => {
    const { tx, service } = makeSuite();
    tx.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'tok-1',
      userId: 'owner-1',
      expiresAt: new Date(FIXED_NOW.getTime() - 1),
    });

    await expect(service.complete('raw', undefined, undefined, FIXED_NOW)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
      httpStatus: 401,
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('already-used token → 409 TOKEN_USED (atomic claim returns 0 rows)', async () => {
    const { tx, service } = makeSuite();
    tx.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'tok-1',
      userId: 'owner-1',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    });
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.complete('raw', undefined, undefined, FIXED_NOW)).rejects.toMatchObject({
      code: 'TOKEN_USED',
      httpStatus: 409,
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('resend invalidates the previous token (TOKEN_USED on the stale one)', async () => {
    const { prisma, tx, service } = makeSuite();
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      role: 'Owner',
      isEmailVerified: false,
    });
    await service.request('o@werefa.test', '127.0.0.1', 'chrome', FIXED_NOW);
    await service.request('o@werefa.test', '127.0.0.1', 'chrome', FIXED_NOW);

    // A stale-token completion hits claim-updateMany returning 0 (already consumed).
    tx.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'tok-old',
      userId: 'owner-1',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    });
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.complete('stale', undefined, undefined, FIXED_NOW)).rejects.toMatchObject({
      code: 'TOKEN_USED',
      httpStatus: 409,
    });
  });
});
