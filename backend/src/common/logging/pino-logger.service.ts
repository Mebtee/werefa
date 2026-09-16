import { Injectable, LoggerService } from '@nestjs/common';
import { Logger as PinoLogger } from 'pino';
import { getRequestContext } from '../context/request-context';

/**
 * Adapter exposing pino through Nest's LoggerService. Child bindings pick up
 * the AsyncLocalStorage requestId when a call happens inside a request, so
 * domain logs correlate with request logs (doc 24 §1).
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  private child(context?: string) {
    const ctx = getRequestContext();
    const bindings: Record<string, unknown> = {};
    if (ctx?.requestId) bindings.requestId = ctx.requestId;
    if (ctx?.businessId) bindings.businessId = ctx.businessId;
    if (ctx?.actorId) bindings.actorId = ctx.actorId;
    if (context) bindings.context = context;
    return this.logger.child(bindings);
  }

  log(message: unknown, context?: string) {
    this.child(context).info(typeof message === 'string' ? { msg: message } : message);
  }

  error(message: unknown, stackOrContext?: string, context?: string) {
    const c = context ?? (stackOrContext && !stackOrContext.includes('\n') ? stackOrContext : undefined);
    const child = this.child(c);
    if (message instanceof Error) {
      child.error({ err: message });
    } else if (typeof message === 'string' && stackOrContext && stackOrContext.includes('\n')) {
      child.error({ msg: message, stack: stackOrContext });
    } else {
      child.error(typeof message === 'string' ? { msg: message } : message);
    }
  }

  warn(message: unknown, context?: string) {
    this.child(context).warn(typeof message === 'string' ? { msg: message } : message);
  }

  debug(message: unknown, context?: string) {
    this.child(context).debug(typeof message === 'string' ? { msg: message } : message);
  }

  verbose(message: unknown, context?: string) {
    this.child(context).trace(typeof message === 'string' ? { msg: message } : message);
  }

  fatal(message: unknown, context?: string) {
    this.child(context).fatal(typeof message === 'string' ? { msg: message } : message);
  }
}