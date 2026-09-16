import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequestContext, RequestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';

function readRequestId(req: Request): string {
  const header = req.headers[REQUEST_ID_HEADER];
  if (typeof header === 'string' && /^[\w-]{1,64}$/.test(header)) {
    return header;
  }
  return randomUUID();
}

/**
 * Seeds the per-request AsyncLocalStorage context (requestId, and later
 * businessId/actorId/scope once auth+tenancy modules land) and stamps the
 * response with the correlation id. Runs before request logging so that domain
 * logs can bind the same requestId.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = readRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  const context: RequestContext = { requestId };
  runWithRequestContext(context, () => {
    next();
  });
}