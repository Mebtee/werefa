/**
 * Security event repository for auth domain events (Prompt 43).
 *
 * Auth events (login success/failure, lockout, password change, force logout,
 * recovery code) are stored as SecurityEvent rows with auth-specific types.
 * This extends the existing SecurityEvent model without new tables.
 */
export type AuthSecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_CHANGED'
  | 'FORCED_LOGOUT'
  | 'DEVICE_FIRST_USE'
  | 'RECOVERY_CODE_REQUESTED'
  | 'RECOVERY_CODE_VERIFIED'
  | 'RECOVERY_CODE_FAILED'
  | 'ADMIN_CREATED'
  | 'ADMIN_DEACTIVATED'
  | 'SECURITY_HISTORY_DELETED';

export interface SecurityEventAuthRepository {
  /** Record an auth-related security event. */
  create(args: {
    userId: string | null;
    type: AuthSecurityEventType;
    ip?: string;
    device?: string;
    browser?: string;
    result?: string;
  }): Promise<void>;
  /** Get security events for a user (own history). */
  listByUserId(userId: string, args?: { limit?: number }): Promise<
    Array<{
      id: string;
      type: string;
      ip: string | null;
      device: string | null;
      browser: string | null;
      result: string;
      createdAt: Date;
    }>
  >;
  /** Get platform-wide security events (Super Admin, REQ-203). */
  listAll(args?: { limit?: number }): Promise<
    Array<{
      id: string;
      userId: string | null;
      type: string;
      ip: string | null;
      device: string | null;
      browser: string | null;
      result: string;
      createdAt: Date;
    }>
  >;
  /** Delete security events older than the given date. */
  deleteOlderThan(before: Date): Promise<number>;
  /** Get the count of security events for a user. */
  countByUserId(userId: string): Promise<number>;
  /** Count prior successful logins recorded for the same device/browser (REQ-197). */
  countByDevice(userId: string, device: string, browser?: string): Promise<number>;
}
