/** DI token for the BusinessRepository implementation. */
export const BUSINESS_REPOSITORY = Symbol('BUSINESS_REPOSITORY');

/** DI token for the BookingRepository implementation. */
export const BOOKING_REPOSITORY = Symbol('BOOKING_REPOSITORY');

/** DI token for the ScheduleRepository implementation. */
export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');

/** DI token for the PaymentRepository implementation. */
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

/** DI token for the ResubmissionVerificationRepository implementation. */
export const RESUBMISSION_REPOSITORY = Symbol('RESUBMISSION_REPOSITORY');

/** DI token for the SubscriptionRepository implementation. */
export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');

// ---------------------------------------------------------------------------
// Auth repos (Prompt 43)
// ---------------------------------------------------------------------------

/** DI token for the UserAuthRepository implementation. */
export const USER_AUTH_REPOSITORY = Symbol('USER_AUTH_REPOSITORY');

/** DI token for the SessionRepository implementation. */
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

/** DI token for the EmergencyRecoveryRepository implementation. */
export const EMERGENCY_RECOVERY_REPOSITORY = Symbol('EMERGENCY_RECOVERY_REPOSITORY');

/** DI token for the SecurityEventAuthRepository implementation. */
export const SECURITY_EVENT_AUTH_REPOSITORY = Symbol('SECURITY_EVENT_AUTH_REPOSITORY');

/** DI token for the AuditEventAuthRepository implementation. */
export const AUDIT_EVENT_AUTH_REPOSITORY = Symbol('AUDIT_EVENT_AUTH_REPOSITORY');

// ---------------------------------------------------------------------------
// Proof file integration (Prompt 50)
// ---------------------------------------------------------------------------

/** DI token for the FileRepository implementation. */
export const FILE_REPOSITORY = Symbol('FILE_REPOSITORY');

/** DI token for the PaymentProofStorage implementation. */
export const PROOF_STORAGE = Symbol('PROOF_STORAGE');