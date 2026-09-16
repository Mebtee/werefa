/** Injection token for the validated AppConfig. */
export const CONFIG = Symbol('CONFIG');

/** Injection token for the underlying Prisma Client (when database module is active). */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');