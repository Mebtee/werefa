import { describe, expect, it } from 'vitest';
import { AppError, ValidationRejectedException } from './app-error';
import { ErrorCode } from './error-codes';

describe('AppError', () => {
  it('derives HTTP status from the code taxonomy', () => {
    const err = new AppError({ code: ErrorCode.SLOT_UNAVAILABLE, title: 'Slot no longer available' });
    expect(err.status).toBe(409);
    expect(err.toEnvelope()).toEqual({
      error: { code: 'SLOT_UNAVAILABLE', title: 'Slot no longer available', fields: null },
    });
  });

  it('serializes field errors without leaking internal context', () => {
    const err = AppError.validation({ name: 'name must be a string' }, 'Some fields are invalid.');
    expect(err.status).toBe(400);
    expect(err.toEnvelope().error.fields).toEqual({ name: 'name must be a string' });
    expect(err.internalContext).toBeUndefined();
  });

  it('never serializes the stack', () => {
    const err = AppError.notFound();
    const body = err.toEnvelope();
    expect(JSON.stringify(body)).not.toContain(err.stack ?? '__no_stack__');
  });

  it('ValidationRejectedException carries field payloads', () => {
    const v = new ValidationRejectedException({ email: 'invalid email' });
    expect(v).toBeInstanceOf(AppError);
    expect(v.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(v.status).toBe(400);
  });
});