// ---------------------------------------------------------------------------
// Prepayment rules (REQ-110 / REQ-111). Shared by the booking service (which
// ENFORCES the deposit: proof is required when prepaid > 0, spec §31) and the
// public availability projection (which DISCLOSES the deposit to the customer
// so the booking wizard can show the payment-proof step before submitting).
// One implementation, one authoritative amount.
// ---------------------------------------------------------------------------

export interface PrepaymentSettingsInput {
  prepaymentMode: string | null | undefined;
  prepaymentPercent: number | null;
  prepaymentFixedMinor: bigint | null;
}

/**
 * Deposit due for a booking total in minor units. `NONE` (or missing settings)
 * always yields 0 — a business that does not configure prepayment must never
 * force a payment proof on the customer.
 */
export function computePrepaidAmount(
  settings: PrepaymentSettingsInput | null | undefined,
  totalPriceMinor: bigint,
): bigint {
  const settings_ = settings ?? { prepaymentMode: null, prepaymentPercent: null, prepaymentFixedMinor: null };
  const mode = settings_.prepaymentMode;
  if (mode === 'PERCENTAGE') {
    return (totalPriceMinor * BigInt(settings_.prepaymentPercent ?? 0)) / 100n;
  }
  if (mode === 'FIXED') {
    return settings_.prepaymentFixedMinor ?? 0n;
  }
  return 0n;
}