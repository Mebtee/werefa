import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '../../src/common/http/app-error';
import {
  SecurityHistoryService,
  applySecurityHistoryFilters,
  buildSecurityEventScopeWhere,
  sanitizeSecurityEventMetadata,
  serializeSecurityEvent,
  type SecurityEventRowShape,
} from '../../src/iam/security-history.service';

function row(overrides: Partial<SecurityEventRowShape> = {}): SecurityEventRowShape {
  return {
    id: 'evt-1',
    type: 'LOGIN_SUCCESS',
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    result: 'SUCCESS',
    ip: '127.0.0.1',
    device: 'desktop',
    browser: 'chrome',
    userId: 'actor-user-1',
    businessId: null,
    ...overrides,
  };
}

describe('buildSecurityEventScopeWhere', () => {
  const userId = 'u-1';
  it('Super Admin sees everything (platform-wide, REQ-203)', () => {
    expect(buildSecurityEventScopeWhere('SUPER_ADMIN', userId, [])).toEqual({});
  });

  it('Admin sees only their own account events (REQ-202)', () => {
    expect(buildSecurityEventScopeWhere('ADMIN', userId, [])).toEqual({ userId });
  });

  it('Owner sees own events plus events on their businesses (REQ-201)', () => {
    const where = buildSecurityEventScopeWhere('OWNER', userId, ['b-1', 'b-2']);
    expect(where).toEqual({ OR: [{ userId }, { businessId: { in: ['b-1', 'b-2'] } }] });
  });

  it('Owner without businesses sees only own events', () => {
    expect(buildSecurityEventScopeWhere('OWNER', userId, [])).toEqual({ OR: [{ userId }] });
  });
});

describe('applySecurityHistoryFilters', () => {
  it('applies type, result and inclusive date range', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-10T23:59:59.000Z');
    const where = applySecurityHistoryFilters(
      'ADMIN',
      { userId: 'u' },
      { type: 'LOGIN_FAILED', result: 'FAILURE', from, to },
    );
    expect(where).toEqual({
      userId: 'u',
      type: 'LOGIN_FAILED',
      result: 'FAILURE',
      createdAt: { gte: from, lte: to },
    });
  });

  it('handles open-ended date ranges', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    expect(applySecurityHistoryFilters('OWNER', {}, { from })).toEqual({
      createdAt: { gte: from },
    });
  });

  it('scopes business/user/role filters out for Owner and Admin', () => {
    for (const scope of ['OWNER', 'ADMIN'] as const) {
      const base = scope === 'OWNER' ? { OR: [{ userId: 'u' }] } : { userId: 'u' };
      const where = applySecurityHistoryFilters(scope, base, {
        businessId: 'b-x',
        userId: 'u-x',
        role: 'Admin',
      });
      expect(where).toEqual(base);
    }
  });

  it('applies business/user/role filters for Super Admin (platform scope)', () => {
    const where = applySecurityHistoryFilters(
      'SUPER_ADMIN',
      {},
      { businessId: 'b-1', userId: 'u-1', role: 'Admin' },
    );
    expect(where).toEqual({ businessId: 'b-1', userId: 'u-1', user: { role: 'Admin' } });
  });
});

describe('sanitizeSecurityEventMetadata', () => {
  it('returns null for missing or malformed metadata', () => {
    expect(sanitizeSecurityEventMetadata(null)).toBeNull();
    expect(sanitizeSecurityEventMetadata(undefined)).toBeNull();
    expect(sanitizeSecurityEventMetadata('scalar')).toBeNull();
    expect(sanitizeSecurityEventMetadata([1, 2])).toBeNull();
  });

  it('keeps allow-listed scalars and drops unknown keys', () => {
    const cleaned = sanitizeSecurityEventMetadata({
      deletedEventId: 'evt-9',
      deletedType: 'LOGIN_FAILED',
      deletedResult: null,
      secretToken: 'XXXX',
      nested: { deep: true },
    });
    expect(cleaned).toEqual({ deletedEventId: 'evt-9', deletedType: 'LOGIN_FAILED' });
  });

  it('returns null when nothing survives the allow-list', () => {
    expect(sanitizeSecurityEventMetadata({ hackerField: 'x' })).toBeNull();
  });
});

describe('serializeSecurityEvent', () => {
  it('does not expose email or metadata to Owner/Admin scopes', () => {
    const source = row({ user: { email: 'owner@werefa.test' }, metadata: { deletedEventId: 'x' } });
    for (const scope of ['OWNER', 'ADMIN'] as const) {
      const view = serializeSecurityEvent(source, scope);
      expect(view.userEmail).toBeUndefined();
      expect(view.metadata).toBeUndefined();
      expect(view).not.toHaveProperty('passwordHash');
    }
  });

  it('returns sanitized email + metadata to the Super Admin scope', () => {
    const source = row({
      user: { email: 'owner@werefa.test' },
      metadata: { deletedEventId: 'evt-9', junk: true },
    });
    const view = serializeSecurityEvent(source, 'SUPER_ADMIN');
    expect(view.userEmail).toBe('owner@werefa.test');
    expect(view.metadata).toEqual({ deletedEventId: 'evt-9' });
  });
});

describe('SecurityHistoryService.deleteAsSuperAdmin', () => {
  it('records the deletion audit before removing the target, in one transaction', async () => {
    const target = {
      id: 'evt-42',
      type: 'LOGIN_FAILED',
      result: 'FAILURE',
      userId: 'victim',
      businessId: 'b-9',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
    };
    const txCalls: string[] = [];
    const fakeTx = {
      securityEvent: {
        findUnique: async () => {
          txCalls.push('findUnique');
          return target;
        },
        deleteMany: async () => {
          txCalls.push('deleteMany');
          return { count: 1 };
        },
      },
    };
    const prisma = {
      $transaction: (fn: (tx: typeof fakeTx) => Promise<void>) => fn(fakeTx),
    } as unknown as never;
    const recorded: Array<Record<string, unknown>> = [];
    const record = vi.fn(async (input: Record<string, unknown>) => {
      recorded.push(input);
    });

    const service = new SecurityHistoryService(prisma as never, { record } as never);
    await service.deleteAsSuperAdmin(
      { userId: 'sa-1' } as never,
      'evt-42',
      '203.0.113.5',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );

    expect(txCalls).toEqual(['findUnique', 'deleteMany']);
    expect(recorded).toHaveLength(1);
    const audit = recorded[0] as Record<string, unknown>;
    expect(audit.type).toBe('SECURITY_EVENT_DELETED');
    expect(audit.userId).toBe('victim');
    expect(audit.businessId).toBe('b-9');
    expect(audit.result).toBe('SUCCESS');
    expect(audit.ip).toBe('203.0.113.5');
    expect(audit.device).toBe('desktop');
    expect(audit.browser).toBe('other');
    expect(audit.metadata).toMatchObject({
      deletedEventId: 'evt-42',
      deletedType: 'LOGIN_FAILED',
      deletedResult: 'FAILURE',
      deletedAt: '2026-09-01T08:00:00.000Z',
      byUserId: 'sa-1',
    });
  });

  it('throws NotFound and never deletes when the target does not exist', async () => {
    const txCalls: string[] = [];
    const fakeTx = {
      securityEvent: {
        findUnique: async () => {
          txCalls.push('findUnique');
          return null;
        },
        deleteMany: async () => {
          txCalls.push('deleteMany');
          return { count: 0 };
        },
      },
    };
    const prisma = {
      $transaction: (fn: (tx: typeof fakeTx) => Promise<void>) => fn(fakeTx),
    } as never;
    const record = vi.fn();
    const service = new SecurityHistoryService(prisma as never, { record } as never);

    await expect(
      service.deleteAsSuperAdmin({ userId: 'sa-1' } as never, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(txCalls).toEqual(['findUnique']);
    expect(record).not.toHaveBeenCalled();
  });

  it('reports 404 and rolls the audit back when a concurrent request already deleted the target', async () => {
    const target = {
      id: 'evt-42',
      type: 'LOGIN_FAILED',
      result: 'FAILURE',
      userId: 'victim',
      businessId: 'b-9',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
    };
    const txCalls: string[] = [];
    const fakeTx = {
      securityEvent: {
        findUnique: async () => {
          txCalls.push('findUnique');
          return target;
        },
        deleteMany: async () => {
          txCalls.push('deleteMany');
          return { count: 0 };
        },
      },
    };
    const prisma = {
      $transaction: (fn: (tx: typeof fakeTx) => Promise<void>) => fn(fakeTx),
    } as unknown as never;
    const recorded: Array<Record<string, unknown>> = [];
    const record = vi.fn(async (input: Record<string, unknown>) => {
      recorded.push(input);
    });

    const service = new SecurityHistoryService(prisma as never, { record } as never);
    await expect(
      service.deleteAsSuperAdmin({ userId: 'sa-1' } as never, 'evt-42'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(txCalls).toEqual(['findUnique', 'deleteMany']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ type: 'SECURITY_EVENT_DELETED' });
  });
});
