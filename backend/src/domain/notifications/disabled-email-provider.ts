import { EmailMessage, EmailProvider, EmailSendResult } from './email-provider.port';

/**
 * Honest default until deployment configures an approved external provider.
 * It never reports acceptance or delivery.
 */
export class DisabledEmailProvider implements EmailProvider {
  async send(_message: EmailMessage): Promise<EmailSendResult> {
    return { ok: false, accepted: false, error: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  }
}