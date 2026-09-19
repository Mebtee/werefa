import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  changeOwnedBusinessSlug,
  getOwnedBusiness,
  getPublicBusiness,
  getPrimaryOwnedBusiness,
  isNotFoundError,
  listOwnedBusinesses,
  loadPrimaryOwnedBusiness,
  pauseOwnedBusiness,
  resumeOwnedBusiness,
  subscribePrimaryOwnedBusiness,
  updateOwnedBusinessProfile,
} from './business'
import { ApiError, isApiError } from './errors'
import type { OwnerBusinessView, PublicCategoryView } from './types'

/**
 * Contract tests for the Prompt 45 business API client: every call must use
 * exactly the implemented backend route, method, headers and body, and map the
 * architecture error envelope to the typed ApiError model.
 */

const BASE = 'http://localhost:3000/api/v1'
const CATEGORY: PublicCategoryView = { code: 'SALON_AND_BARBER', label: 'Salon & Barber' }

const OWNER_VIEW: OwnerBusinessView = {
  id: '00000000-0000-4000-8000-0000000000a',
  slug: 'addis-beauty-lounge',
  name: 'Addis Beauty Lounge',
  category: CATEGORY,
  description: 'desc',
  address: 'addr',
  phonePublic: '+251 911 000 000',
  coordinates: { latitude: 9.0108, longitude: 38.7612 },
  isDeactivated: false,
  isPaused: false,
  pauseMessage: null,
  reopenAt: null,
  bookingIntervalMinutes: 60,
  prepaymentMode: 'NONE',
  prepaymentPercent: null,
  prepaymentFixedMinor: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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

function errorResponse(status: number, code: string, detail: string): Response {
  return jsonResponse(
    { error: { code, title: code, detail, fields: null } },
    status,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listOwnedBusinesses', () => {
  it('GETs the owner business list with session credentials', async () => {
    const calls = stubFetch(() => jsonResponse([OWNER_VIEW]))
    const result = await listOwnedBusinesses()

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.credentials).toBe('include')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
    expect(init?.headers).toHaveProperty('X-Request-Id')
    expect(result).toEqual([OWNER_VIEW])
  })
})

describe('getOwnedBusiness', () => {
  it('GETs one business by id', async () => {
    const calls = stubFetch(() => jsonResponse(OWNER_VIEW))
    const result = await getOwnedBusiness(OWNER_VIEW.id)

    expect(calls[0].url).toBe(`${BASE}/owner/businesses/${OWNER_VIEW.id}`)
    expect(result).toEqual(OWNER_VIEW)
  })
})

describe('updateOwnedBusinessProfile', () => {
  it('PATCHes only the profile fields incl. coordinates', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_VIEW, name: 'Addis Hair Studio' }))
    const result = await updateOwnedBusinessProfile(OWNER_VIEW.id, {
      name: 'Addis Hair Studio',
      categoryCode: 'SALON_AND_BARBER',
      description: '   ',
      phonePublic: '+251911000000',
      address: 'Bole',
      latitude: 9.0108,
      longitude: 38.7612,
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${OWNER_VIEW.id}`)
    expect(init?.method).toBe('PATCH')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Addis Hair Studio',
      categoryCode: 'SALON_AND_BARBER',
      description: '   ',
      phonePublic: '+251911000000',
      address: 'Bole',
      latitude: 9.0108,
      longitude: 38.7612,
    })
    expect(result.name).toBe('Addis Hair Studio')
  })
})

describe('changeOwnedBusinessSlug', () => {
  it('PATCHes the slug route with a body of the new public link', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_VIEW, slug: 'adde-urban-lounge' }))
    const result = await changeOwnedBusinessSlug(OWNER_VIEW.id, 'adde-urban-lounge')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${OWNER_VIEW.id}/slug`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ publicSlug: 'adde-urban-lounge' })
    expect(result.slug).toBe('adde-urban-lounge')
  })
})

describe('pauseOwnedBusiness / resumeOwnedBusiness', () => {
  it('POSTs pause with a message and ISO reopen time', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_VIEW, isPaused: true }))
    await pauseOwnedBusiness(OWNER_VIEW.id, {
      pauseMessage: 'Closed for holidays',
      reopenAt: '2026-12-25T00:00:00.000Z',
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${OWNER_VIEW.id}/pause`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      pauseMessage: 'Closed for holidays',
      reopenAt: '2026-12-25T00:00:00.000Z',
    })
  })

  it('POSTs resume with no body', async () => {
    const calls = stubFetch(() => jsonResponse({ ...OWNER_VIEW, isPaused: false }))
    await resumeOwnedBusiness(OWNER_VIEW.id)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${OWNER_VIEW.id}/resume`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })
})

describe('getPublicBusiness', () => {
  it('GETs the public business page by slug', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        slug: 'addis-beauty-lounge',
        name: 'Addis Beauty Lounge',
        description: null,
        address: 'Bole Road',
        phonePublic: null,
        category: CATEGORY,
        coordinates: { latitude: null, longitude: null },
        isDeactivated: false,
        isPaused: false,
        pauseMessage: null,
        reopenAt: null,
        bookingIntervalMinutes: 60,
        branding: { logoUrl: null, coverUrl: null },
      }),
    )
    const result = await getPublicBusiness('addis-beauty-lounge')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/public/businesses/addis-beauty-lounge`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result.slug).toBe('addis-beauty-lounge')
  })
})

describe('error mapping', () => {
  it('maps 404 to a not-found ApiError', async () => {
    stubFetch(() => errorResponse(404, 'NOT_FOUND', 'Business not found.'))
    const thrown = await getPublicBusiness('no-such-page').catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
    expect(isNotFoundError(thrown)).toBe(true)
  })

  it('maps 409 to a conflict ApiError (already-taken slug)', async () => {
    stubFetch(() => errorResponse(409, 'CONFLICT', 'This public slug is already in use.'))
    const thrown = await changeOwnedBusinessSlug(OWNER_VIEW.id, 'marathon-auto-care').catch(
      (e: unknown) => e,
    )
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('conflict')
    expect(isNotFoundError(thrown)).toBe(false)
  })

  it('maps 401 to an authentication ApiError', async () => {
    stubFetch(() => errorResponse(401, 'UNAUTHENTICATED', 'Not signed in.'))
    const thrown = await listOwnedBusinesses().catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('authentication')
  })
})

describe('primary owned business cache', () => {
  it('resolves the first owned business and notifies subscribers on slug changes', async () => {
    const calls = stubFetch(() => jsonResponse([OWNER_VIEW]))

    const primary = await loadPrimaryOwnedBusiness()
    expect(primary).toEqual({ id: OWNER_VIEW.id, slug: OWNER_VIEW.slug })
    expect(calls[0].url).toBe(`${BASE}/owner/businesses`)
    expect(getPrimaryOwnedBusiness()).toEqual(primary)

    let notified = 0
    const unsubscribe = subscribePrimaryOwnedBusiness(() => {
      notified += 1
    })

    const { setPrimaryOwnedBusiness } = await import('./business')
    setPrimaryOwnedBusiness({ id: OWNER_VIEW.id, slug: 'adde-urban-lounge' })
    expect(notified).toBe(1)
    expect(getPrimaryOwnedBusiness()?.slug).toBe('adde-urban-lounge')
    unsubscribe()

    setPrimaryOwnedBusiness({ id: OWNER_VIEW.id, slug: 'another-leap' })
    expect(notified).toBe(1)
  })

  it('rejects when the caller owns no businesses', async () => {
    stubFetch(() => jsonResponse([]))
    const thrown = await loadPrimaryOwnedBusiness().catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
  })
})