import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOwnerService,
  createServiceAddOn,
  createServiceVariation,
  deactivateOwnerService,
  getPublicServices,
  listOwnerServices,
  reactivateOwnerService,
  updateOwnerService,
} from './catalog'
import { ApiError, isApiError } from './errors'
import type { OwnerServiceView, PublicServiceView } from './types'

/**
 * Contract tests for the Prompt 46 Service Catalog API client: every call must
 * use exactly the implemented backend route, method, headers and body, and map
 * the architecture envelope to the typed ApiError model. The mapper stays a
 * narrow copy of the backend projections (integer-minor money, delta add-ons).
 */

const BASE = 'http://localhost:3000/api/v1'
const BUSINESS_ID = '00000000-0000-4000-8000-0000000000a'
const SERVICE_ID = 'haircut-styling'

const VARIANT = { id: 'premium', name: 'Premium styling', priceDeltaMinor: 30000, durationDeltaMinutes: 15 }

const OWNER_SERVICE: OwnerServiceView = {
  id: SERVICE_ID,
  name: 'Women’s Haircut & Styling',
  basePriceMinor: 90000,
  baseDurationMinutes: 60,
  isActive: true,
  variations: [VARIANT],
  addOns: [{ id: 'blowdry', name: 'Blow-dry finish', priceDeltaMinor: 10000, durationDeltaMinutes: 10 }],
}

const PUBLIC_SERVICE: PublicServiceView = {
  id: SERVICE_ID,
  name: 'Women’s Haircut & Styling',
  basePriceMinor: 90000,
  baseDurationMinutes: 60,
  variations: [VARIANT],
  addOns: [{ id: 'blowdry', name: 'Blow-dry finish', priceDeltaMinor: 10000, durationDeltaMinutes: 10 }],
}

interface RecordedCall {
  url: string
  init?: RequestInit
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.stubGlobal(
    'fetch',
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : String(input)
      calls.push({ url, init })
      return handler(url, init)
    }) as typeof fetch,
  )
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, detail: string, fields?: Record<string, string>): Response {
  return jsonResponse({ error: { code, title: code, detail, fields: fields ?? null } }, status)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listOwnerServices', () => {
  it('GETs the owner service catalog for the business with session credentials', async () => {
    const calls = stubFetch(() => jsonResponse([OWNER_SERVICE]))
    const result = await listOwnerServices(BUSINESS_ID)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.credentials).toBe('include')
    expect(result).toEqual([
      {
        id: SERVICE_ID,
        name: 'Women’s Haircut & Styling',
        basePriceMinor: 90000,
        baseDurationMinutes: 60,
        isActive: true,
        variations: [VARIANT],
        addOns: [{ id: 'blowdry', name: 'Blow-dry finish', priceDeltaMinor: 10000, durationDeltaMinutes: 10 }],
      },
    ])
  })
})

describe('createOwnerService', () => {
  it('POSTs the create payload and maps the returned service', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_SERVICE, id: 'facial', name: 'Facial Massage' }))
    const result = await createOwnerService(BUSINESS_ID, {
      name: 'Facial Massage',
      basePriceMinor: 25000,
      baseDurationMinutes: 45,
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Facial Massage',
      basePriceMinor: 25000,
      baseDurationMinutes: 45,
    })
    expect(result.id).toBe('facial')
    expect(result.isActive).toBe(true)
  })
})

describe('updateOwnerService', () => {
  it('PATCHes the service with only the changed base fields', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_SERVICE, basePriceMinor: 12000 }))
    const result = await updateOwnerService(BUSINESS_ID, SERVICE_ID, {
      basePriceMinor: 12000,
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services/${SERVICE_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ basePriceMinor: 12000 })
    expect(result.basePriceMinor).toBe(12000)
  })
})

describe('deactivateOwnerService / reactivateOwnerService', () => {
  it('POSTs deactivate with no body', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_SERVICE, isActive: false }))
    const result = await deactivateOwnerService(BUSINESS_ID, SERVICE_ID)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services/${SERVICE_ID}/deactivate`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
    expect(result.isActive).toBe(false)
  })

  it('POSTs reactivate with no body', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_SERVICE, isActive: true }))
    const result = await reactivateOwnerService(BUSINESS_ID, SERVICE_ID)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services/${SERVICE_ID}/reactivate`)
    expect(init?.method).toBe('POST')
    expect(result.isActive).toBe(true)
  })
})

describe('createServiceVariation / createServiceAddOn', () => {
  it('POSTs a variation as a delta', async () => {
    const calls = stubFetch(() => jsonResponse({ ok: true }))
    await createServiceVariation(BUSINESS_ID, SERVICE_ID, {
      name: 'Premium styling',
      priceDeltaMinor: 30000,
      durationDeltaMinutes: 15,
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services/${SERVICE_ID}/variations`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Premium styling',
      priceDeltaMinor: 30000,
      durationDeltaMinutes: 15,
    })
  })

  it('POSTs an add-on to the addons route', async () => {
    const calls = stubFetch(() => jsonResponse({ ok: true }))
    await createServiceAddOn(BUSINESS_ID, SERVICE_ID, {
      name: 'Blow-dry finish',
      priceDeltaMinor: 10000,
      durationDeltaMinutes: 10,
    })

    const [{ url }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/services/${SERVICE_ID}/addons`)
  })
})

describe('getPublicServices', () => {
  it('GETs the public active services by slug and marks them active', async () => {
    const calls = stubFetch(() => jsonResponse([PUBLIC_SERVICE]))
    const result = await getPublicServices('addis-beauty-lounge')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/public/businesses/addis-beauty-lounge/services`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual([{ ...PUBLIC_SERVICE, isActive: true }])
  })
})

describe('error mapping', () => {
  it('maps 404 to a not-found ApiError', async () => {
    stubFetch(() => errorResponse(404, 'NOT_FOUND', 'Service not found.'))
    const thrown = await listOwnerServices(BUSINESS_ID).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
  })

  it('surfaces the backend validation fields for a bad create', async () => {
    stubFetch(() =>
      errorResponse(400, 'VALIDATION_ERROR', 'One or more fields are invalid.', {
        name: 'Service name is required.',
        basePriceMinor: 'Price must be a non-negative integer.',
      }),
    )
    const thrown = await createOwnerService(BUSINESS_ID, {
      name: '',
      basePriceMinor: -1,
      baseDurationMinutes: 0,
    }).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('validation')
    expect((thrown as ApiError).fields).toEqual({
      name: 'Service name is required.',
      basePriceMinor: 'Price must be a non-negative integer.',
    })
  })
})