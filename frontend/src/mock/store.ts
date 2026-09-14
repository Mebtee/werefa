import type {
  BusinessDetails,
  BusinessPage,
  DateString,
  PauseState,
  Service,
  ServiceAddOn,
  ServiceVariation,
  SpecialDay,
  WeeklyWorkingHours,
} from '@/types/models'
import { buildPages } from '@/mock/data'

/**
 * In-memory mock store — the single source of truth for business data in this
 * phase (mock repository boundary).
 *
 * Both the public booking surface and the owner portal read and write through
 * this store, so owner edits are immediately reflected on the public page
 * without a second copy of the data. It is deliberately mutable: the real
 * backend (later phase) replaces this module, not the UI.
 *
 * `resetStore()` restores the pristine seed data and is used by tests.
 */

export const PUBLIC_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{3,62}[a-z0-9]$/

interface StorePage {
  business: BusinessDetails
  services: Service[]
}

let pages: StorePage[]

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const stamp = Date.now().toString(36).slice(-3)
  return `${prefix}-${rand}${stamp}`
}

function seed(): void {
  pages = buildPages().map((page: BusinessPage) => ({
    business: page.business,
    services: page.services.map((service) => ({
      ...service,
      variations: service.variations.map((v) => ({ ...v })),
      addOns: service.addOns.map((a) => ({ ...a })),
    })),
  }))
}

seed()

export function resetStore(): void {
  seed()
}

export function getPage(slug: string): StorePage | undefined {
  return pages.find((page) => page.business.slug === slug)
}

export function getBusinessPage(slug: string): BusinessPage | undefined {
  const page = getPage(slug)
  return page ? { business: page.business, services: page.services } : undefined
}

export function getBusiness(slug: string): BusinessDetails | undefined {
  return getPage(slug)?.business
}

export function getServices(slug: string): readonly Service[] {
  return getPage(slug)?.services ?? []
}

export type StoreResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function missing(): { ok: false; error: 'Business not found.' } {
  return { ok: false, error: 'Business not found.' }
}

export function updateBusiness(
  slug: string,
  patch: Partial<BusinessDetails>,
): StoreResult<BusinessDetails> {
  const page = getPage(slug)
  if (!page) return missing()
  page.business = { ...page.business, ...patch }
  return { ok: true, value: page.business }
}

/** Validates a custom public link (REQ-048). */
export function validatePublicSlug(slug: string): string | null {
  if (!PUBLIC_SLUG_PATTERN.test(slug)) {
    return 'Use 5–64 characters: lowercase letters, numbers and single hyphens, no leading or trailing dash.'
  }
  return null
}

export function isSlugTakenByOther(slug: string, current: string): boolean {
  return pages.some((page) => page.business.slug === slug && slug !== current)
}

export function changeBusinessSlug(
  slug: string,
  next: string,
): StoreResult<string> {
  const invalid = validatePublicSlug(next)
  if (invalid) return { ok: false, error: invalid }
  const page = getPage(slug)
  if (!page) return missing()
  if (next === slug) return { ok: true, value: slug }
  if (isSlugTakenByOther(next, slug)) {
    return { ok: false, error: 'That public link is already taken by another business.' }
  }
  page.business = { ...page.business, slug: next }
  return { ok: true, value: next }
}

export interface NewServiceInput {
  id?: string
  name: string
  description?: string
  basePrice: number
  baseDurationMinutes: number
  variations?: readonly ServiceVariation[]
  addOns?: readonly ServiceAddOn[]
}

export function createService(
  slug: string,
  input: NewServiceInput,
): StoreResult<Service> {
  const page = getPage(slug)
  if (!page) return missing()
  const service: Service = {
    id: input.id ?? makeId('svc'),
    name: input.name,
    description: input.description,
    basePrice: input.basePrice,
    baseDurationMinutes: input.baseDurationMinutes,
    variations: input.variations ? input.variations.map((v) => ({ ...v })) : [],
    addOns: input.addOns ? input.addOns.map((a) => ({ ...a })) : [],
    isActive: true,
  }
  page.services = [...page.services, service]
  return { ok: true, value: service }
}

export function updateService(
  slug: string,
  serviceId: string,
  patch: Partial<Service>,
): StoreResult<Service> {
  const page = getPage(slug)
  if (!page) return missing()
  const index = page.services.findIndex((s) => s.id === serviceId)
  if (index < 0) return { ok: false, error: 'Service not found.' }
  const next: Service = { ...page.services[index], ...patch }
  page.services = [
    ...page.services.slice(0, index),
    next,
    ...page.services.slice(index + 1),
  ]
  return { ok: true, value: next }
}

export function setServiceActive(
  slug: string,
  serviceId: string,
  active: boolean,
): StoreResult<Service> {
  return updateService(slug, serviceId, { isActive: active })
}

export function saveWorkingHours(
  slug: string,
  workingHours: WeeklyWorkingHours,
): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { workingHours })
}

export function saveBookingInterval(
  slug: string,
  bookingIntervalMinutes: number,
): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { bookingIntervalMinutes })
}

export function saveSpecialDays(
  slug: string,
  specialDays: Readonly<Record<DateString, SpecialDay>>,
): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { specialDays })
}

export function setPause(slug: string, pause: PauseState): StoreResult<BusinessDetails> {
  return updateBusiness(slug, { pause })
}