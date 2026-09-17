/**
 * Audit event repository for platform admin actions (Prompt 43).
 *
 * Admin management and security-history deletion are audited via AuditEvent
 * rows (REQ-201–206). Distinct from SecurityEvent rows which record
 * authentication/login events.
 */
export interface AuditEventAuthRepository {
  create(args: {
    actorUserId: string;
    actorRole: string;
    action: string;
    businessId?: string;
    detail?: string;
  }): Promise<void>;
}