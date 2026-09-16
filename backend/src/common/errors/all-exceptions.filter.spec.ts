import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppError } from './app-error';
import { ErrorCode } from './error-codes';

interface ResLike {
  status: ReturnType<typeof vi.fn> & { (code: number): ResLike };
  json: ReturnType<typeof vi.fn>;
}

function makeHost(): { host: ArgumentsHost; res: ResLike } {
  const json = vi.fn();
  const res = { json } as ResLike;
  res.status = vi.fn((code: number) => {
    void code;
    return res;
  }) as ResLike['status'];
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { host, res };
}

function makeFilter() {
  const logger = { error: vi.fn(), warn: vi.fn() };
  const filter = new AllExceptionsFilter(logger as never);
  return { filter, logger };
}

describe('AllExceptionsFilter (envelope compliance, doc 23 §2)', () => {
  it('applies AppError validation envelope with 400', () => {
    const { filter } = makeFilter();
    const { host, res } = makeHost();
    filter.catch(AppError.validation({ name: 'required' }), host as ArgumentsHost);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.fields).toEqual({ name: 'required' });
  });

  it('maps HttpException 404 to NOT_FOUND without leaking internals', () => {
    const { filter } = makeFilter();
    const { host, res } = makeHost();
    filter.catch(new NotFoundException('secret internal detail'), host as ArgumentsHost);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('masks unexpected exceptions as INTERNAL_ERROR (500) and logs them', () => {
    const { filter, logger } = makeFilter();
    const { host, res } = makeHost();
    const boom = new Error('sql: connection refused to internal db 10.0.0.9');
    filter.catch(boom, host as ArgumentsHost);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.error.title).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('10.0.0.9');
    expect(JSON.stringify(body)).not.toContain('sql:');
    expect(logger.error).toHaveBeenCalled();
  });

  it('logs 4xx as warnings, not errors', () => {
    const { filter, logger } = makeFilter();
    const { host } = makeHost();
    filter.catch(new NotFoundException(), host as ArgumentsHost);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});