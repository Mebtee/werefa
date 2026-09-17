import { User, UserRole } from '@prisma/client';

/**
 * User authentication repository — identity queries for login, lockout,
 * admin management, and session resolution (Prompt 43).
 */
export interface UserWithOwners {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isDeactivated: boolean;
  isLockedUntil: Date | null;
  failedLoginAttempts: number;
  recoveryEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  businesses: { businessId: string; createdAt: Date }[];
}

export interface UserAuthRepository {
  /** Find a user by email with password hash and owner businesses (for login). */
  findByEmail(email: string): Promise<UserWithOwners | null>;
  /** Find a user by id (light — no relations). */
  findById(id: string): Promise<User | null>;
  /** Atomic increment of failedLoginAttempts; returns the new count. */
  incrementFailedLoginAttempts(userId: string): Promise<number>;
  /** Reset failedLoginAttempts to 0 and update lastLoginAt (successful login). */
  recordSuccessfulLogin(userId: string, now: Date): Promise<void>;
  /** Set isLockedUntil (lockout trigger). */
  setLockedUntil(userId: string, lockedUntil: Date | null): Promise<void>;
  /** Set a new password hash, clears lockout, and marks passwordChangedAt. */
  updatePassword(userId: string, passwordHash: string, now: Date): Promise<void>;
  /** Count active admin accounts. */
  countActiveAdmins(): Promise<number>;
  /** List all admin users (ACTIVE, not deactivated). */
  listAdmins(): Promise<User[]>;
  /**
   * Create an admin user with role ADMIN inside a serialized transaction that
   * enforces the two-active-admin cap (REQ-038). Returns the created user, or
   * null when the cap is already reached — no second admin can win concurrently.
   */
  createAdmin(args: { id: string; email: string; passwordHash: string; recoveryEmail?: string }): Promise<User | null>;
  /** Deactivate a user (set isDeactivated = true). */
  deactivateUser(userId: string): Promise<void>;
  /** Set the Super Admin recovery email. */
  setRecoveryEmail(userId: string, email: string): Promise<void>;
}
