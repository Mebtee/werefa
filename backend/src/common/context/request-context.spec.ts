import { describe, expect, it } from 'vitest';
import { currentRequestId, getRequestContext, runWithRequestContext, withRequestId } from './request-context';

describe('request context (AsyncLocalStorage)', () => {
  it('has no store outside a request', () => {
    expect(getRequestContext()).toBeUndefined();
    expect(currentRequestId()).toBeUndefined();
  });

  it('propagates context through async boundaries', async () => {
    const observed = await withRequestId('req-123', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return currentRequestId();
    });
    expect(observed).toBe('req-123');
  });

  it('nests children without leaking sibling context', async () => {
    const outer = await runWithRequestContext({ requestId: 'outer' }, async () => {
      const inner = await runWithRequestContext({ requestId: 'inner' }, () => currentRequestId());
      return { inner, outer: currentRequestId() };
    });
    expect(outer.inner).toBe('inner');
    expect(outer.outer).toBe('outer');
  });

  it('restores undefined after the request finishes', () => {
    withRequestId('done', () => undefined);
    expect(currentRequestId()).toBeUndefined();
  });
});