import { PrismaClient } from '@prisma/client';

/**
 * Minimal, structurally-typed logger to avoid a hard runtime dependency on a
 * concrete logger here. The API supplies a pino Logger.
 */
export interface MinimalLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Creates a Prisma client configured to log via the given logger when provided.
 * prisma client is a singleton within a process; export from a module-level
 * holder so the same instance is reused across requests.
 */
export interface PrismaFactoryOptions {
  logTo?: MinimalLogger;
}

export function createPrismaClient(options: PrismaFactoryOptions = {}): PrismaClient {
  const { logTo } = options;
  return new PrismaClient(
    logTo
      ? {
          log: [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],
        }
      : undefined,
  );
}
