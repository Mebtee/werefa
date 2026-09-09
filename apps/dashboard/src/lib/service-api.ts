import { api } from './api';

export interface ServiceChild {
  id: string;
  name: string;
  priceDeltaMinor: number;
  durationDeltaMinutes: number;
  isActive: boolean;
}

export interface ServiceDetail {
  id: string;
  businessId: string;
  name: string;
  basePriceMinor: number;
  baseDurationMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variations: ServiceChild[];
  addOns: ServiceChild[];
}

export interface ServiceInput {
  name?: string;
  basePriceMinor?: number;
  baseDurationMinutes?: number;
}

export interface ServiceChildInput {
  name?: string;
  priceDeltaMinor?: number;
  durationDeltaMinutes?: number;
  isActive?: boolean;
}

/**
 * Money is stored/transported as integer minor units. The dashboard edits in
 * major units (2 decimals) and converts on the boundary so no float rounding
 * can sneak into the API payload.
 */
export function majorFromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Converts a major-units string (e.g. "45.50") to integer minor units. */
export function minorFromMajor(value: string): number | null {
  const major = Number.parseFloat(value);
  if (!Number.isFinite(major) || major < 0) return null;
  return Math.round(major * 100);
}

export const serviceApi = {
  list: (businessId: string) =>
    api
      .get<{ services: ServiceDetail[] }>(`/api/v1/businesses/${businessId}/services`)
      .then((r) => r.services),
  create: (businessId: string, input: ServiceInput) =>
    api
      .post<{ service: ServiceDetail }>(`/api/v1/businesses/${businessId}/services`, input)
      .then((r) => r.service),
  update: (businessId: string, serviceId: string, input: ServiceInput) =>
    api
      .patch<{ service: ServiceDetail }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}`,
        input,
      )
      .then((r) => r.service),
  deactivate: (businessId: string, serviceId: string) =>
    api
      .post<{ service: ServiceDetail }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/deactivate`,
      )
      .then((r) => r.service),
  reactivate: (businessId: string, serviceId: string) =>
    api
      .post<{ service: ServiceDetail }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/reactivate`,
      )
      .then((r) => r.service),
  remove: (businessId: string, serviceId: string) =>
    api
      .del<{ service: ServiceDetail }>(`/api/v1/businesses/${businessId}/services/${serviceId}`)
      .then((r) => r.service),

  createVariation: (businessId: string, serviceId: string, input: ServiceChildInput) =>
    api
      .post<{ variation: ServiceChild }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/variations`,
        input,
      )
      .then((r) => r.variation),
  updateVariation: (
    businessId: string,
    serviceId: string,
    variationId: string,
    input: ServiceChildInput,
  ) =>
    api
      .patch<{ variation: ServiceChild }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/variations/${variationId}`,
        input,
      )
      .then((r) => r.variation),
  deleteVariation: (businessId: string, serviceId: string, variationId: string) =>
    api
      .del<{ variation: ServiceChild }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/variations/${variationId}`,
      )
      .then((r) => r.variation),

  createAddOn: (businessId: string, serviceId: string, input: ServiceChildInput) =>
    api
      .post<{ addOn: ServiceChild }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/add-ons`,
        input,
      )
      .then((r) => r.addOn),
  updateAddOn: (businessId: string, serviceId: string, addOnId: string, input: ServiceChildInput) =>
    api
      .patch<{ addOn: ServiceChild }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/add-ons/${addOnId}`,
        input,
      )
      .then((r) => r.addOn),
  deleteAddOn: (businessId: string, serviceId: string, addOnId: string) =>
    api
      .del<{ addOn: ServiceChild }>(
        `/api/v1/businesses/${businessId}/services/${serviceId}/add-ons/${addOnId}`,
      )
      .then((r) => r.addOn),
};
