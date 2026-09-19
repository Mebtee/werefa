import { apiRequest } from './http'
import type {
  CreateServiceInput,
  CreateServiceVariantInput,
  OwnerServiceView,
  PublicServiceView,
  UpdateServiceInput,
} from './types'
import { servicesOwnedFromApi, servicesPublicFromApi } from './catalog.mapper'
import type { Service } from '@/types/models'

/**
 * Owner + public Service Catalog API client (Prompt 46).
 *
 * Exactly the implemented backend routes are consumed (Prompt 42 §7): owner
 * routes require the session cookie and are scoped server-side to the owned
 * business (the frontend never trusts a client-supplied tenant), and the
 * public endpoint is unauthenticated and emits only active services (REQ-079).
 *
 * There is deliberately no hard-delete client: the backend exposes no delete
 * route (REQ-077/078) — owners deactivate/reactivate instead.
 */

const OWNER_SERVICES = (businessId: string) => `/owner/businesses/${businessId}/services`

export function listOwnerServices(
  businessId: string,
  signal?: AbortSignal,
): Promise<Service[]> {
  return apiRequest<OwnerServiceView[]>(OWNER_SERVICES(businessId), { signal }).then(
    ({ data }) => servicesOwnedFromApi(data),
  )
}

export function createOwnerService(
  businessId: string,
  input: CreateServiceInput,
): Promise<Service> {
  return apiRequest<OwnerServiceView>(OWNER_SERVICES(businessId), {
    method: 'POST',
    body: input,
  }).then(({ data }) => servicesOwnedFromApi([data])[0])
}

export function updateOwnerService(
  businessId: string,
  serviceId: string,
  input: UpdateServiceInput,
): Promise<Service> {
  return apiRequest<OwnerServiceView>(`${OWNER_SERVICES(businessId)}/${serviceId}`, {
    method: 'PATCH',
    body: input,
  }).then(({ data }) => servicesOwnedFromApi([data])[0])
}

export function deactivateOwnerService(
  businessId: string,
  serviceId: string,
): Promise<Service> {
  return apiRequest<OwnerServiceView>(`${OWNER_SERVICES(businessId)}/${serviceId}/deactivate`, {
    method: 'POST',
  }).then(({ data }) => servicesOwnedFromApi([data])[0])
}

export function reactivateOwnerService(
  businessId: string,
  serviceId: string,
): Promise<Service> {
  return apiRequest<OwnerServiceView>(`${OWNER_SERVICES(businessId)}/${serviceId}/reactivate`, {
    method: 'POST',
  }).then(({ data }) => servicesOwnedFromApi([data])[0])
}

export function createServiceVariation(
  businessId: string,
  serviceId: string,
  input: CreateServiceVariantInput,
): Promise<void> {
  return apiRequest<unknown>(`${OWNER_SERVICES(businessId)}/${serviceId}/variations`, {
    method: 'POST',
    body: input,
  }).then(() => undefined)
}

export function createServiceAddOn(
  businessId: string,
  serviceId: string,
  input: CreateServiceVariantInput,
): Promise<void> {
  return apiRequest<unknown>(`${OWNER_SERVICES(businessId)}/${serviceId}/addons`, {
    method: 'POST',
    body: input,
  }).then(() => undefined)
}

export function getPublicServices(
  slug: string,
  signal?: AbortSignal,
): Promise<Service[]> {
  return apiRequest<PublicServiceView[]>(`/public/businesses/${slug}/services`, {
    signal,
  }).then(({ data }) => servicesPublicFromApi(data))
}