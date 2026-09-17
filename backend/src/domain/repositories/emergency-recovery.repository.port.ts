/**
 * Emergency recovery repository — Super Admin one-time-code recovery
 * (Prompt 43; REQ-198–200).
 *
 * A single active (unused, unexpired) recovery row is maintained per Super
 * Admin user at any time.
 */
export interface EmergencyRecoveryRecord {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export interface EmergencyRecoveryRepository {
  /** Create a new recovery code row. */
  create(args: { userId: string; codeHash: string; expiresAt: Date }): Promise<EmergencyRecoveryRecord>;
  /** Find the active (unused, unexpired) recovery row for a user. */
  findActiveByUserId(userId: string, now: Date): Promise<EmergencyRecoveryRecord | null>;
  /** Increment the attempt counter on an active recovery row. */
  incrementAttempts(recoveryId: string): Promise<number>;
  /**
   * Atomically claim (mark used) a recovery code. Returns true only if the row
   * was unused and the claim succeeded — concurrent calls for the same code
   * yield exactly one true, enforcing single-use (REQ-199).
   */
  consume(recoveryId: string, now: Date): Promise<boolean>;
  /** Expire any active rows for a user (on password reset). */
  expireAllForUser(userId: string, now: Date): Promise<void>;
}
