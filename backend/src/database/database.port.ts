export interface DatabasePingOk {
  ok: true;
  latencyMs: number;
}

export interface DatabasePingError {
  ok: false;
  message: string;
}

export type DatabasePing = DatabasePingOk | DatabasePingError;

export interface DatabasePort {
  /**
   * Whether the database is configured for this process. When false, readiness
   * reports not-ready (safe for local development without a database).
   */
  readonly configured: boolean;
  ping(): Promise<DatabasePing>;
}

export const DATABASE = Symbol('DATABASE');