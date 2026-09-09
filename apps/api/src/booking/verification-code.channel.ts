import { Injectable } from '@nestjs/common';

/**
 * Verification-code delivery seam (master spec REQ-109 / doc 08 §9.4): the code
 * is issued and its sha256 hash persisted, but DELIVERY (SMS/Telegram) is a
 * documented no-op until a real channel ships. The in-memory channel captures
 * what would be sent so the API and tests can reason about issuance without
 * producing a customer-facing delivery. This is captured in-memory only — the
 * persisted verification row keeps only the hash, never the plaintext.
 */
export interface CodeDeliveryInput {
  businessId: string;
  phone: string;
  code: string;
  purpose: string;
}

export interface VerificationCodeChannel {
  deliver(input: CodeDeliveryInput): Promise<void>;
}

@Injectable()
export class InMemoryVerificationCodeChannel implements VerificationCodeChannel {
  readonly sent: (CodeDeliveryInput & { sentAt: Date })[] = [];

  async deliver(input: CodeDeliveryInput): Promise<void> {
    this.sent.push({ ...input, sentAt: new Date() });
  }
}
