import type {
  OwnerBusinessView,
  OwnerServiceView,
  PublicBusinessView,
  PublicServiceView,
} from '@/api/types'
import type { Service } from '@/types/models'
import { getBusiness, getServices } from '@/mock/store'
import { MOCK_BUSINESS_PAGES, PRIMARY_BUSINESS_SLUG } from '@/mock/data'

/**
 * Stateful test double for the real business API endpoints (Prompt 45).
 *
 * Models the implemented backend contract for the endpoints this vertical
 * slice consumes — owner business list/detail/profile/slug/pause and the public
 * business page — so render-based tests exercise the real API client against
 * the true wire shapes. It is deliberately NOT a reimplementation of domain
 * logic: it stores the demo business and applies the same field names the
 * backend accepts/rejects, delegating every other URL to the previously
 * installed `fetch` (so `installFetchStub` routes for auth etc. keep working).
 */

export interface RecordedRequest {
  method: string
  url: string
  body?: unknown
}

export interface BusinessApiStub {
  calls: RecordedRequest[]
  restore(): void
}

const OWNER_ID = '00000000-0000-4000-8000-0000000000a'

function envelope(status: number, code: string, title: string, detail: string): Response {
  return new Response(
    JSON.stringify({ error: { code, title, detail, fields: null } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function validationEnvelope(fields: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        title: 'Validation failed',
        detail: 'One or more fields are invalid.',
        fields,
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

function json<T>(body: T): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function newOwnerState(): OwnerBusinessView {
  const mock = getBusiness(PRIMARY_BUSINESS_SLUG)!
  return {
    id: OWNER_ID,
    slug: mock.slug,
    name: mock.name,
    category: {
      code: mock.category === 'salon-barber' ? 'SALON_AND_BARBER' : 'OTHER',
      label: mock.category === 'salon-barber' ? 'Salon & Barber' : 'Other',
    },
    description: mock.description,
    address: mock.address,
    phonePublic: mock.phone,
    coordinates: { latitude: mock.lat, longitude: mock.lng },
    isDeactivated: false,
    isPaused: mock.pause !== null,
    pauseMessage: mock.pause?.message ?? null,
    reopenAt:
      mock.pause?.kind === 'until' ? `${mock.pause.reopenDate}T00:00:00.000Z` : null,
    bookingIntervalMinutes: mock.bookingIntervalMinutes,
    prepaymentMode:
      mock.prepayment.mode === 'percentage'
        ? 'PERCENTAGE'
        : mock.prepayment.mode === 'fixed'
          ? 'FIXED'
          : 'NONE',
    prepaymentPercent:
      mock.prepayment.mode === 'percentage' ? mock.prepayment.value ?? null : null,
    prepaymentFixedMinor:
      mock.prepayment.mode === 'fixed' ? mock.prepayment.value ?? null : null,
    createdAt: new Date().toISOString(),
  }
}

function publicViewOf(owner: OwnerBusinessView): PublicBusinessView {
  return {
    slug: owner.slug,
    name: owner.name,
    description: owner.description,
    address: owner.address,
    phonePublic: owner.phonePublic,
    category: owner.category,
    coordinates: owner.coordinates,
    isDeactivated: owner.isDeactivated,
    isPaused: owner.isPaused,
    pauseMessage: owner.pauseMessage,
    reopenAt: owner.reopenAt,
    bookingIntervalMinutes: owner.bookingIntervalMinutes,
    branding: { logoUrl: null, coverUrl: null },
  }
}

/**
 * Other demo businesses are also in the simulated database, so the public API
 * serves their profiles too (same contract as the real backend).
 */
function publicViewFromStore(slug: string): PublicBusinessView | undefined {
  const mock = getBusiness(slug)
  if (!mock) return undefined
  return {
    slug: mock.slug,
    name: mock.name,
    description: mock.description || null,
    address: mock.address || null,
    phonePublic: mock.phone || null,
    category: {
      code: mock.category === 'salon-barber' ? 'SALON_AND_BARBER' : 'OTHER',
      label: mock.category === 'salon-barber' ? 'Salon & Barber' : 'Other',
    },
    coordinates: { latitude: mock.lat ?? null, longitude: mock.lng ?? null },
    isDeactivated: false,
    isPaused: mock.pause !== null,
    pauseMessage: mock.pause?.message ?? null,
    reopenAt:
      mock.pause?.kind === 'until' ? `${mock.pause.reopenDate}T00:00:00.000Z` : null,
    bookingIntervalMinutes: mock.bookingIntervalMinutes,
    branding: { logoUrl: null, coverUrl: null },
  }
}

// --- Service catalog (Prompt 46) -------------------------------------------
// The same contract as the real backend: integer-minor money, delta add-ons
// (REQ-073), and the public projection omits `isActive` because the endpoint
// only answers with active services (REQ-079).

function ownerServiceFromStore(s: Service): OwnerServiceView {
  return {
    id: s.id,
    name: s.name,
    basePriceMinor: s.basePriceMinor,
    baseDurationMinutes: s.baseDurationMinutes,
    isActive: s.isActive,
    variations: s.variations.map((v) => ({
      id: v.id,
      name: v.name,
      priceDeltaMinor: v.priceDeltaMinor,
      durationDeltaMinutes: v.durationDeltaMinutes,
    })),
    addOns: s.addOns.map((a) => ({
      id: a.id,
      name: a.name,
      priceDeltaMinor: a.priceDeltaMinor,
      durationDeltaMinutes: a.durationDeltaMinutes,
    })),
  }
}

function publicServiceFromOwner(view: OwnerServiceView): PublicServiceView {
  return {
    id: view.id,
    name: view.name,
    basePriceMinor: view.basePriceMinor,
    baseDurationMinutes: view.baseDurationMinutes,
    variations: view.variations.map((v) => ({ ...v })),
    addOns: view.addOns.map((a) => ({ ...a })),
  }
}

function newServicesState(): OwnerServiceView[] {
  return getServices(PRIMARY_BUSINESS_SLUG).map(ownerServiceFromStore)
}

function validateServiceInput(body: unknown): Record<string, string> | null {
  const input = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    fields.name = 'Service name is required.'
  } else if (input.name.trim().length > 160) {
    fields.name = 'Service name must be 160 characters or fewer.'
  }
  if (typeof input.basePriceMinor !== 'number' || !Number.isInteger(input.basePriceMinor) || input.basePriceMinor < 0) {
    fields.basePriceMinor = 'Price must be a non-negative integer amount (minor units).'
  }
  if (typeof input.baseDurationMinutes !== 'number' || !Number.isInteger(input.baseDurationMinutes) || input.baseDurationMinutes < 1) {
    fields.baseDurationMinutes = 'Duration must be a whole number of minutes, at least 1.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

function validateVariantInput(body: unknown): Record<string, string> | null {
  const input = (body ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    fields.name = 'A name is required.'
  }
  if (typeof input.priceDeltaMinor !== 'number' || !Number.isInteger(input.priceDeltaMinor) || input.priceDeltaMinor < 0) {
    fields.priceDeltaMinor = 'Delta price must be a non-negative integer amount (minor units).'
  }
  if (typeof input.durationDeltaMinutes !== 'number' || !Number.isInteger(input.durationDeltaMinutes) || input.durationDeltaMinutes < 0) {
    fields.durationDeltaMinutes = 'Delta duration must be a non-negative whole number of minutes.'
  }
  return Object.keys(fields).length > 0 ? fields : null
}

export function installBusinessApiStub(
  delegateTo: typeof fetch = globalThis.fetch,
): BusinessApiStub {
  const calls: RecordedRequest[] = []
  const state = newOwnerState()
  const servicesState = newServicesState()
  let variantSerial = 0
  const nextVariantId = () => `variant-${++variantSerial}`
  const nextAddOnId = () => `addon-${++variantSerial}`
  const takenSlugs = new Set(
    MOCK_BUSINESS_PAGES.map((page) => page.business.slug).filter(
      (slug) => slug !== state.slug,
    ),
  )
  // The owned business's mock-store page is a stale duplicate of the live
  // record (`state`); once its slug changes the old slug must 404, so that page
  // is excluded from the "other demo businesses" public fallback.
  const initialOwnedSlug = state.slug
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ method, url, body })

    let pathname: string
    try {
      pathname = new URL(url).pathname
    } catch {
      pathname = url
    }
    const segments = pathname.split('/').filter(Boolean)

    if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'v1') {
      const rest = segments.slice(2)
      if (rest[0] === 'owner' && rest[1] === 'businesses') {
        if (!rest[2]) {
          if (method === 'GET') return json([{ ...state }])
          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this owner business route.')
        }
        if (rest[2] !== OWNER_ID) {
          return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
        }
        const action = rest[3]
        if (!action && method === 'GET') return json({ ...state })
        if (!action && method === 'PATCH') {
          const patch = (body ?? {}) as Record<string, unknown>
          if (typeof patch.name === 'string') state.name = patch.name
          if (typeof patch.description === 'string') state.description = patch.description
          if (typeof patch.address === 'string') state.address = patch.address
          if (typeof patch.phonePublic === 'string') state.phonePublic = patch.phonePublic
          if (patch.categoryCode === 'SALON_AND_BARBER' || patch.categoryCode === 'OTHER') {
            state.category = {
              code: patch.categoryCode,
              label: patch.categoryCode === 'SALON_AND_BARBER' ? 'Salon & Barber' : 'Other',
            }
          }
          if (typeof patch.latitude === 'number') {
            state.coordinates = { ...state.coordinates, latitude: patch.latitude }
          }
          if (typeof patch.longitude === 'number') {
            state.coordinates = { ...state.coordinates, longitude: patch.longitude }
          }
          return json({ ...state })
        }
        if (action === 'slug' && method === 'PATCH') {
          const publicSlug = (body as { publicSlug?: unknown } | undefined)?.publicSlug
          if (typeof publicSlug !== 'string' || takenSlugs.has(publicSlug)) {
            return envelope(409, 'CONFLICT', 'Conflict', 'This public slug is already in use.')
          }
          state.slug = publicSlug
          return json({ ...state })
        }
        if (action === 'pause' && method === 'POST') {
          const pause = (body ?? {}) as { pauseMessage?: unknown; reopenAt?: unknown }
          state.isPaused = true
          state.pauseMessage = typeof pause.pauseMessage === 'string' ? pause.pauseMessage : null
          state.reopenAt = typeof pause.reopenAt === 'string' ? pause.reopenAt : null
          return json({ ...state })
        }
        if (action === 'resume' && method === 'POST') {
          state.isPaused = false
          state.pauseMessage = null
          state.reopenAt = null
          return json({ ...state })
        }
        if (action === 'deactivate' && method === 'POST') {
          state.isDeactivated = true
          return json({ ...state })
        }
        if (action === 'reactivate' && method === 'POST') {
          state.isDeactivated = false
          return json({ ...state })
        }

        if (action === 'services') {
          const serviceId = rest[4]
          if (!serviceId) {
            if (method === 'GET') {
              return json(servicesState.map((s) => ({ ...ownerServiceFromStore(s) })))
            }
            if (method === 'POST') {
              const fields = validateServiceInput(body)
              if (fields) {
                return validationEnvelope(fields)
              }
              const input = body as { name: string; basePriceMinor: number; baseDurationMinutes: number }
              const created: OwnerServiceView = {
                id: `svc-${servicesState.length + 1}`,
                name: input.name.trim(),
                basePriceMinor: input.basePriceMinor,
                baseDurationMinutes: input.baseDurationMinutes,
                isActive: true,
                variations: [],
                addOns: [],
              }
              servicesState.push(created)
              return json(ownerServiceFromStore(created))
            }
            return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this services route.')
          }
          const svc = servicesState.find((s) => s.id === serviceId)
          if (!svc) {
            return envelope(404, 'NOT_FOUND', 'Not found', 'Service not found.')
          }
          const sub = rest[5]
          if (!sub && method === 'PATCH') {
            const input = (body ?? {}) as Record<string, unknown>
            if (typeof input.name === 'string') svc.name = input.name.trim()
            if (typeof input.basePriceMinor === 'number') svc.basePriceMinor = input.basePriceMinor
            if (typeof input.baseDurationMinutes === 'number') {
              svc.baseDurationMinutes = input.baseDurationMinutes
            }
            return json(ownerServiceFromStore(svc))
          }
          if (sub === 'deactivate' && method === 'POST') {
            svc.isActive = false
            return json(ownerServiceFromStore(svc))
          }
          if (sub === 'reactivate' && method === 'POST') {
            svc.isActive = true
            return json(ownerServiceFromStore(svc))
          }
          if (sub === 'variations' && method === 'POST') {
            const fields = validateVariantInput(body)
            if (fields) return validationEnvelope(fields)
            const input = body as { name: string; priceDeltaMinor: number; durationDeltaMinutes: number }
            svc.variations.push({
              id: nextVariantId(),
              name: input.name.trim(),
              priceDeltaMinor: input.priceDeltaMinor,
              durationDeltaMinutes: input.durationDeltaMinutes,
            })
            return json({ ok: true })
          }
          if (sub === 'addons' && method === 'POST') {
            const fields = validateVariantInput(body)
            if (fields) return validationEnvelope(fields)
            const input = body as { name: string; priceDeltaMinor: number; durationDeltaMinutes: number }
            svc.addOns.push({
              id: nextAddOnId(),
              name: input.name.trim(),
              priceDeltaMinor: input.priceDeltaMinor,
              durationDeltaMinutes: input.durationDeltaMinutes,
            })
            return json({ ok: true })
          }
          return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this service route.')
        }
        return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this owner business route.')
      }

      if (rest[0] === 'public' && rest[1] === 'businesses' && rest[2]) {
        if (method === 'GET') {
          if (rest[3] === 'services') {
            if (state.slug === rest[2]) {
              return json(servicesState.filter((s) => s.isActive).map((s) => publicServiceFromOwner(s)))
            }
            if (rest[2] === initialOwnedSlug) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            const storeServices = getServices(rest[2])
            if (!getBusiness(rest[2]) || storeServices.length === 0) {
              return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
            }
            return json(storeServices.filter((s) => s.isActive).map(ownerServiceFromStore).map((s) => publicServiceFromOwner(s)))
          }
          if (state.slug === rest[2]) return json(publicViewOf(state))
          const other =
            rest[2] === initialOwnedSlug ? undefined : publicViewFromStore(rest[2])
          if (other) return json(other)
          return envelope(404, 'NOT_FOUND', 'Not found', 'Business not found.')
        }
        return envelope(404, 'NOT_FOUND', 'Not found', 'No fetch stub for this public route.')
      }
    }

    return delegateTo(input, init)
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}