/**
 * Application-level email transport boundary.
 *
 * Domain services and the outbox know only this message shape. Provider
 * credentials, SDKs, and transport-specific behavior stay outside the domain.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  template: string;
  data: Record<string, string>;
  idempotencyKey: string;
  correlationId?: string;
}

export interface EmailSendResult {
  ok: boolean;
  accepted: boolean;
  error?: string;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}