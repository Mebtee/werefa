/**
 * Verification-code delivery boundary for rejected-booking resubmission
 * (REQ-230; canonical Section 23.3 / BR-35).
 *
 * Section 23.3 fixes the code delivery channel exactly:
 *
 *   "the customer's connected Telegram chat when present; otherwise the
 *    business-held email when one is held; otherwise no code is delivered and
 *    the code is voided (no code path)."
 *
 * This platform models no customer email (bookings carry name/phone only), so
 * the only real channel is the customer's connected Telegram chat. The domain
 * depends on this port — never on the transport — so a test can inject a fake
 * and the production adapter can be swapped without touching the service.
 *
 * The result distinguishes the three canonical outcomes so the caller can void
 * a code that was never delivered:
 *
 *  - `DELIVERED`       — the code reached the customer's chat.
 *  - `NO_CHANNEL`      — the channel is available but this customer has no
 *                        connected chat (or the provider refused): the code
 *                        must be voided so it can never be consumed.
 *  - `CHANNEL_DISABLED`— the Telegram channel is operationally disabled
 *                        (TELEGRAM_ENABLED=false). This is a platform/config
 *                        state, not a customer-level absence; the previous
 *                        out-of-band behavior is preserved.
 */

export type VerificationCodeDeliveryResult = 'DELIVERED' | 'NO_CHANNEL' | 'CHANNEL_DISABLED';

export interface VerificationCodeDeliveryInput {
  businessId: string;
  bookingId: number;
  customerPhone: string;
  /** Plaintext one-time code. Must never be persisted or logged by a channel. */
  code: string;
}

export interface VerificationCodeChannel {
  deliver(input: VerificationCodeDeliveryInput): Promise<VerificationCodeDeliveryResult>;
}

export const VERIFICATION_CODE_CHANNEL = Symbol('VERIFICATION_CODE_CHANNEL');

/**
 * Fail-safe default used when no channel is bound (e.g. a service constructed
 * directly in a unit test). It never claims delivery.
 */
export class NoopVerificationCodeChannel implements VerificationCodeChannel {
  async deliver(): Promise<VerificationCodeDeliveryResult> {
    return 'CHANNEL_DISABLED';
  }
}
