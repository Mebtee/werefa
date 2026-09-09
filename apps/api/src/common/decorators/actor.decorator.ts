import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { currentActor } from '../context/actor-context';

/**
 * Injects the ActorContext for the current request.
 * Returns null when unauthenticated (guard must run before).
 */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return currentActor(ctx);
});
