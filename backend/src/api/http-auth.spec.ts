import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';
import { SessionAuthContextResolver, TestAuthContextResolver, authContextResolverFactory } from './auth/auth-context';
import { AppConfig } from '../config/app-config';
import { AuthService } from '../domain/services/auth.service';

/**
 * Non-DB authentication/authorization contract tests (Prompt 43 §33).
 *
 * These complete without a database: guards, resolver selection and DTO
 * validation short-circuit before any service work. Real end-to-end flows
 * (login, lockout, recovery, force logout, tenancy) live in the DB-gated
 * `http-auth.db.spec.ts`.
 */
describe('AUTH HTTP contract (no DB)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const built = await createTestApp({});
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('login validation', () => {
    it('rejects a malformed email with VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'secret123' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fields).toHaveProperty('email');
    });

    it('rejects a missing password with VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@werefa.app' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fields).toHaveProperty('password');
    });
  });

  describe('recovery request validation', () => {
    it('rejects an invalid recovery email with VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/recovery/request')
        .send({ email: 'nope' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('session resolver (no DB reachable)', () => {
    it('denies owner routes without a session cookie (401 UNAUTHENTICATED)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/owner/businesses').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('denies admin routes without a session cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/admins').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('denies password change without a session cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: 'x', newPassword: 'y' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('denies session lookup (GET /auth/session) without a session cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});

describe('AUTH production/test separation', () => {
  const fakeService = {} as unknown as AuthService;

  it('spoofed actor headers never authenticate when auth testing is off', async () => {
    const built = await createTestApp({});
    const app2 = built.app;
    try {
      const res = await request(app2.getHttpServer())
        .get('/api/v1/owner/businesses')
        .set('x-actor-role', 'SUPER_ADMIN')
        .set('x-actor-id', '00000000-0000-4000-8000-000000000001')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    } finally {
      await app2.close();
    }
  });

  it('spoofed actor headers never affect super-admin routes when auth testing is off', async () => {
    const built = await createTestApp({});
    const app2 = built.app;
    try {
      const res = await request(app2.getHttpServer())
        .get('/api/v1/admin/admins')
        .set('x-actor-role', 'SUPER_ADMIN')
        .set('x-actor-id', '00000000-0000-4000-8000-000000000001')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    } finally {
      await app2.close();
    }
  });

  it('the resolver factory never returns the test bridge in production', () => {
    const productionEnabled = { nodeEnv: 'production', authTestEnabled: true } as unknown as AppConfig;
    expect(authContextResolverFactory(productionEnabled, fakeService)).toBeInstanceOf(SessionAuthContextResolver);

    const productionDisabled = { nodeEnv: 'production', authTestEnabled: false } as unknown as AppConfig;
    expect(authContextResolverFactory(productionDisabled, fakeService)).toBeInstanceOf(SessionAuthContextResolver);
  });

  it('the test bridge constructor hard-fails under a production config', () => {
    const production = { nodeEnv: 'production', authTestEnabled: true } as unknown as AppConfig;
    expect(() => new TestAuthContextResolver(production)).toThrow(/never be used in production/);
  });

  it('the test bridge is only produced for non-production configs with AUTH_TEST_ENABLED', () => {
    const testEnabled = { nodeEnv: 'test', authTestEnabled: true } as unknown as AppConfig;
    expect(authContextResolverFactory(testEnabled, fakeService)).toBeInstanceOf(TestAuthContextResolver);

    const testDisabled = { nodeEnv: 'test', authTestEnabled: false } as unknown as AppConfig;
    expect(authContextResolverFactory(testDisabled, fakeService)).toBeInstanceOf(SessionAuthContextResolver);

    const devEnabled = { nodeEnv: 'development', authTestEnabled: true } as unknown as AppConfig;
    expect(authContextResolverFactory(devEnabled, fakeService)).toBeInstanceOf(TestAuthContextResolver);
  });
});

describe('CORS origin policy (Prompt 44)', () => {
  const ORIGIN = 'http://localhost:5173';

  async function withCorsApp<T>(fn: (app: INestApplication) => Promise<T>): Promise<T> {
    const built = await createTestApp({ env: { CORS_ORIGINS: ORIGIN } });
    try {
      return await fn(built.app);
    } finally {
      await built.app.close();
    }
  }

  it('allows the configured owner origin with credentials and X-Request-Id', async () => {
    await withCorsApp(async (corsApp) => {
      const res = await request(corsApp.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-request-id')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('x-request-id');
    });
  });

  it('attaches credentialed CORS headers to a real (non-preflight) response', async () => {
    await withCorsApp(async (corsApp) => {
      const res = await request(corsApp.getHttpServer())
        .get('/api/v1/auth/session')
        .set('Origin', ORIGIN)
        .expect(401);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  it('never echoes an unknown origin (no wildcard, no credentialed foreign origin)', async () => {
    await withCorsApp(async (corsApp) => {
      const res = await request(corsApp.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', 'http://evil.example')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('omits CORS headers entirely when no origins are configured', async () => {
    const built = await createTestApp({ env: { CORS_ORIGINS: '' } });
    try {
      const res = await request(built.app.getHttpServer())
        .get('/api/v1/auth/session')
        .set('Origin', ORIGIN)
        .expect(401);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await built.app.close();
    }
  });
});