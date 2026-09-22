import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/test-app';

/**
 * Non-DB HTTP contract tests (Prompt 42 §22). Every case here completes without
 * touching a database: guard/validation/pipes short-circuit before any service.
 * DB-backed end-to-end flows live in http-api.db.spec.ts (DB-gated).
 */
describe('HTTP API contract (no DB)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const built = await createTestApp({});
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the single error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.fields).toBeNull();
  });

  it('rejects an invalid customer booking with the standard error envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/customer/bookings')
      .send({ businessSlug: 'x', customerName: 'Awit' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.error.fields).toBe('object');
    expect(Object.keys(res.body.error.fields).length).toBeGreaterThan(0);
  });

  it('rejects an invalid availability query before any service call', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/public/businesses/my-salon/availability')
      .query({ date: '20-09-2026' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an impossible calendar date on GET availability before any service call', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/public/businesses/my-salon/availability')
      .query({ date: '2026-02-30', serviceId: '12345678-1234-4123-8123-123456789abc' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.date).toBeDefined();
  });

  it('rejects an impossible calendar date in the POST availability body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/public/businesses/my-salon/availability')
      .send({ date: '2026-13-01', selections: [] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.date).toBeDefined();
  });

  it('denies owner routes with an explicit actor resolver when auth testing is off', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/owner/businesses')
      .set('x-actor-role', 'OWNER')
      .set('x-actor-id', '00000000-0000-4000-8000-000000000001')
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('denies owner routes when the test resolver is active but headers are missing', async () => {
    const built = await createTestApp({ env: { AUTH_TEST_ENABLED: 'true' } });
    const authApp = built.app;
    try {
      const res = await request(authApp.getHttpServer()).get('/api/v1/owner/businesses').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    } finally {
      await authApp.close();
    }
  });
});