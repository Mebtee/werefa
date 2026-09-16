import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, FakeDatabase } from './helpers/test-app';

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;

beforeAll(async () => {
  ({ app } = await createTestApp());
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // supertest resets middleware state; nothing to reset here
});

describe('system endpoints (mounted under /api/v1)', () => {
  it('GET /api/v1/system/health returns liveness', async () => {
    const res = await request(http).get('/api/v1/system/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('werefa-backend');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  it('GET /api/v1/system/ready reports database ok with the fake backend', async () => {
    const res = await request(http).get('/api/v1/system/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks[0]).toMatchObject({ name: 'database', status: 'ok' });
    expect(typeof res.body.checks[0].latencyMs).toBe('number');
  });

  it('GET /api/v1/system/meta exposes only non-secret metadata', async () => {
    const res = await request(http).get('/api/v1/system/meta').expect(200);
    expect(res.body.product).toBe('Werefa');
    expect(res.body.service).toBe('werefa-backend');
    expect(res.body.api).toEqual({ version: 'v1', basePath: '/api/v1' });
    expect(res.body.database.provider).toBe('postgresql');
    expect(res.body.productClarifications.status).toBe('PENDING_CLARIFICATION');
    expect(res.body.productClarifications.items).toHaveLength(6);
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('unknown routes serialize the single error envelope (no stack/no internals)', async () => {
    const res = await request(http).get('/api/v1/does/not/exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.fields).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('at ');
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  it('echoes a caller-provided X-Request-Id', async () => {
    const res = await request(http).get('/api/v1/system/health').set('X-Request-Id', 'trace-abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('applies security headers (helmet)', async () => {
    const res = await request(http).get('/api/v1/system/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('readiness with an unavailable/unconfigured database', () => {
  it('returns 503 with a disabled check when DB is not configured', async () => {
    const { app: app2 } = await createTestApp({
      env: { DATABASE_URL: '' },
      database: new FakeDatabase({ configured: false, fail: true }),
    });
    const http2 = app2.getHttpServer();
    const res = await request(http2).get('/api/v1/system/ready').expect(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks[0]).toMatchObject({ name: 'database', status: 'disabled' });
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');
    await app2.close();
  });
});

describe('request body limits', () => {
  it('rejects oversized JSON payloads with the envelope (413 FILE_TOO_LARGE)', async () => {
    const { app: app2 } = await createTestApp({ env: { BODY_LIMIT: '1kb' } });
    const http2 = app2.getHttpServer();
    const big = JSON.stringify({ data: 'x'.repeat(4096) });
    const res = await request(http2).post('/api/v1/system/meta').set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(JSON.stringify(res.body)).not.toContain('x'.repeat(64));
    await app2.close();
  });
});