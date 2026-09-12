import { api } from './api';

export type PrepaymentMode = 'PERCENTAGE' | 'FIXED';

export interface PrepaymentConfig {
  enabled: boolean;
  type: PrepaymentMode | null;
  percentage: number | null;
  fixedMinor: number | null;
}

/**
 * Client for the owner prepayment configuration endpoints (REQ-110/111).
 * Minor amounts are returned as numbers (BigInt serialized as Number like the
 * rest of the API's minor-units fields).
 */
export const prepaymentApi = {
  get: (businessId: string) =>
    api
      .get<{ prepayment: PrepaymentConfig }>(`/api/v1/businesses/${businessId}/prepayment-config`)
      .then((r) => r.prepayment),
  update: (
    businessId: string,
    input: { enabled: boolean; type?: PrepaymentMode; percentage?: number; fixedMinor?: number },
  ) =>
    api
      .patch<{ prepayment: PrepaymentConfig }>(
        `/api/v1/businesses/${businessId}/prepayment-config`,
        input,
      )
      .then((r) => r.prepayment),
};
