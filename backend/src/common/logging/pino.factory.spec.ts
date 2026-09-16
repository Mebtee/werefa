import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPinoLogger } from './pino.factory';
import { loadAndValidateConfig } from '../../config/app-config';

class Sink extends Writable {
  lines: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.lines.push(chunk.toString('utf8'));
    cb();
  }
}

describe('createPinoLogger (structured logging, doc 24 §1)', () => {
  it('uses the configured log level', () => {
    const config = loadAndValidateConfig({ NODE_ENV: 'test', LOG_LEVEL: 'warn' });
    const logger = createPinoLogger(config);
    expect(logger.level).toBe('warn');
  });

  it('redacts sensitive values at the serializer level', () => {
    const config = loadAndValidateConfig({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
    const sink = new Sink();
    const logger = createPinoLogger(config, sink);

    logger.info({
      msg: 'request details',
      req: {
        headers: { authorization: 'Bearer supersecret', 'x-api-key': 'ak-123' },
        body: { password: 'hunter2' },
      },
      user: { email: 'owner@example.com' },
    });

    const parsed = sink.lines.map((l) => JSON.parse(l)).filter((o) => o.msg);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].req.headers.authorization).toBe('[REDACTED]');
    expect(parsed[0].req.headers['x-api-key']).toBe('[REDACTED]');
    expect(parsed[0].req.body.password).toBe('[REDACTED]');
    expect(parsed[0].user.email).toBe('owner@example.com');
    expect(JSON.stringify(parsed[0])).not.toContain('supersecret');
    expect(JSON.stringify(parsed[0])).not.toContain('hunter2');
  });

  it('tags the service base field', () => {
    const config = loadAndValidateConfig({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
    const sink = new Sink();
    const logger = createPinoLogger(config, sink);
    logger.info('hello');
    const parsed = sink.lines.map((l) => JSON.parse(l)).filter((o) => o.msg);
    expect(parsed[0].service).toBe('werefa-backend');
    expect(parsed[0].env).toBe('test');
  });
});