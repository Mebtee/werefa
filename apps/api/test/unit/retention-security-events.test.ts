import { describe, expect, it, vi } from 'vitest';
import {
  JobRegistrar,
  SECURITY_EVENT_RETENTION,
  SECURITY_RETENTION_BATCH,
  SECURITY_RETENTION_CRON,
  SECURITY_RETENTION_DAYS,
} from '../../src/jobs/retention-security-events.job';

const prisma = {
  securityEvent: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};

const security = {
  record: vi.fn(async () => undefined),
};

const jobs = {
  register: vi.fn(),
};

function freshMocks() {
  prisma.securityEvent.findMany.mockReset();
  prisma.securityEvent.deleteMany.mockReset();
  security.record.mockReset();
  jobs.register.mockReset();
}

function makeRegistrar() {
  return new JobRegistrar(
    jobs as never,
    prisma as never,
    security as never,
    { appEnv: 'test' } as never,
  );
}

describe('JobRegistrar.onModuleInit', () => {
  it('registers the retention job as a weekly repeatable sweep (doc 22 §5)', () => {
    const registrar = makeRegistrar();
    registrar.onModuleInit();
    expect(jobs.register).toHaveBeenCalledTimes(1);
    const def = jobs.register.mock.calls[0][0];
    expect(def.name).toBe(SECURITY_EVENT_RETENTION);
    expect(def.repeatCron).toBe(SECURITY_RETENTION_CRON);
    expect(def.maxAttempts).toBe(3);
    expect(def.repeatCron).not.toBeUndefined();
  });
});

describe('JobRegistrar.runRetention', () => {
  it('purges old events in bounded batches and audits the purge once', async () => {
    freshMocks();
    prisma.securityEvent.findMany
      .mockResolvedValueOnce(
        Array.from({ length: SECURITY_RETENTION_BATCH }, (_, i) => ({ id: `old-${i}` })),
      )
      .mockResolvedValueOnce([{ id: 'old-1000' }])
      .mockResolvedValue([]);
    prisma.securityEvent.deleteMany.mockResolvedValue({ count: 1 });

    const count = await makeRegistrar().runRetention();

    expect(count).toBe(SECURITY_RETENTION_BATCH + 1);
    expect(prisma.securityEvent.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.securityEvent.deleteMany).toHaveBeenCalledTimes(2);
    expect(security.record).toHaveBeenCalledTimes(1);
    const audit = security.record.mock.calls[0][0];
    expect(audit.type).toBe('SECURITY_EVENT_PURGE');
    expect(audit.result).toBe('SUCCESS');
    expect(audit.metadata.purgedCount).toBe(SECURITY_RETENTION_BATCH + 1);
    expect(audit.metadata.olderThanDays).toBe(SECURITY_RETENTION_DAYS);
    expect(typeof audit.metadata.cutoff).toBe('string');
  });

  it('deletes nothing and records no audit when nothing is due', async () => {
    freshMocks();
    prisma.securityEvent.findMany.mockResolvedValue([]);

    const count = await makeRegistrar().runRetention();

    expect(count).toBe(0);
    expect(prisma.securityEvent.deleteMany).not.toHaveBeenCalled();
    expect(security.record).not.toHaveBeenCalled();
  });

  it('both batching and delete only ever target ids below the cutoff', async () => {
    freshMocks();
    prisma.securityEvent.findMany
      .mockResolvedValueOnce([{ id: 'old-1' }, { id: 'old-2' }])
      .mockResolvedValue([]);
    prisma.securityEvent.deleteMany.mockResolvedValue({ count: 2 });

    await makeRegistrar().runRetention(365);

    const findCall = prisma.securityEvent.findMany.mock.calls[0][0];
    expect(findCall).toMatchObject({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: SECURITY_RETENTION_BATCH,
    });
    const cutoff = findCall.where.createdAt.lt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - cutoff.getTime() - 365 * 86_400_000)).toBeLessThan(60_000);

    expect(prisma.securityEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1', 'old-2'] } },
    });
  });

  it('computes an exclusive 1-year cutoff from an injected clock (boundary retained)', async () => {
    freshMocks();
    prisma.securityEvent.findMany.mockResolvedValue([{ id: 'old-1' }]);
    prisma.securityEvent.deleteMany.mockResolvedValue({ count: 1 });

    const fixedNow = new Date('2026-09-10T12:00:00.000Z');
    await makeRegistrar().runRetention(365, fixedNow);

    const findCall = prisma.securityEvent.findMany.mock.calls[0][0];
    const cutoff = findCall.where.createdAt.lt as Date;
    expect(cutoff.getTime()).toBe(fixedNow.getTime() - 365 * 86_400_000);
    expect('lt' in findCall.where.createdAt).toBe(true);
    expect('lte' in findCall.where.createdAt).toBe(false);
  });
});
