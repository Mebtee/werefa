import type { PaymentMethodId } from '@/types/models'

/**
 * Display labels for the payment methods the backend actually accepts.
 *
 * `PaymentMethodId` mirrors the backend `PaymentMethodCode` enum
 * (`BANK_TRANSFER` | `TELEBIRR_MOBILE_MONEY`) — these are real, selectable
 * values carried through booking creation, not placeholders. This map only
 * renders a human label for a stored/selected code.
 *
 * It deliberately carries NO account numbers, bank names, phone numbers or
 * payment steps. Per-business payment instructions must come from the backend
 * projection; when the backend has none, the UI says so instead of inventing
 * payment details.
 */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethodId, string> = {
  'bank-transfer': 'Bank transfer',
  telebirr: 'Telebirr (mobile money)',
}

/** Every payment method the booking API accepts, in display order. */
export const PAYMENT_METHOD_IDS: readonly PaymentMethodId[] = [
  'bank-transfer',
  'telebirr',
]

export function paymentMethodLabel(id: string | null | undefined): string | null {
  if (!id) return null
  return PAYMENT_METHOD_LABEL[id as PaymentMethodId] ?? id
}
