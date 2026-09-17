/**
 * Session repository — server-side session persistence (Prompt 43).
 *
 * Sessions are opaque tokens stored as sha-256 hashes. Raw tokens are
 * sent to the client in httpOnly cookies and never persisted.
 */
export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  ip: string | null;
  device: string | null;
  browser: string | null;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  /** Create a new session row. */
  create(args: {
    userId: string;
    tokenHash: string;
    ip?: string;
    device?: string;
    browser?: string;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  /** Find a valid (non-expired, non-revoked) session by its token hash. */
  findValidByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /** Revoke a single session by id. */
  revokeById(sessionId: string): Promise<void>;
  /** Revoke all sessions for a user (force logout, password change). */
  revokeAllByUserId(userId: string): Promise<void>;
  /** Delete expired and revoked sessions (housekeeping). */
  deleteExpired(now: Date): Promise<number>;
  /** Count active (valid) sessions for a user. */
  countActiveByUserId(userId: string): Promise<number>;
}
