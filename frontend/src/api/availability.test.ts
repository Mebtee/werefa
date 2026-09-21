import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicAvailability } from './availability'
import { ApiError, isApiError } from './errors'
import type { PublicAvailabilityView } from './types'

/**
 * Contract tests for the Prompt 48 availability API client: the call must use
 * exactly the implemented backend route (`POST /api/v1/public/businesses/:slug/
 * availability` — HttpCode 200), send the multi-service selections in the wire
 * shape (the backend, not the client, computes the appointment totals,
 * REQ-070/074), and map the architecture error envelope to the typed ApiError
 * model.
 */

const BASE = 'http://localhost:3000/api/v1'
const SLUG = 'addis-beauty-lounge'

const SERVICE_ID = '11111111-1111-4111-8111-111111111111'
const VARIATION_ID = '22222222-2222-4222-8222-222222222222'
const ADD_ON_ID = '33333333-3333-4333-8333-333333333333'

const VIEW: PublicAvailabilityView = {
  date: '2026-11-20',
  slots: [
    { startAt: '2026-11-20T09:00:00.000Z', endAt: '2026-11-20T10:00:00.000Z' },
    { startAt: '2026-11-20T10:00:00.000Z', endAt: '2026-11-20T11:00:00.000Z' },
  ],
  computedDurationMinutes: 60,
  computedTotalPriceMinor: 30000,
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function envelopeResponse(status: number, code: string, detail: string): Response {
  return new Response(JSON.stringify({ error: { code, title: code, detail } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPublicAvailability', () => {
  it('POSTs the multi-service selection to the availability route', async () => {
    const calls = stubFetch(() => jsonResponse(VIEW))
    const result = await getPublicAvailability(SLUG, {
      date: '2026-11-20',
      selections: [
        { serviceId: SERVICE_ID, variationId: VARIATION_ID, addOnIds: [ADD_ON_ID] },
      ],
    })

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/public/businesses/${SLUG}/availability`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      date: '2026-11-20',
      selections: [
        {
          serviceId: SERVICE_ID,
          variationId: VARIATION_ID,
          addOnIds: [ADD_ON_ID],
        },
      ],
    })
    expect(result).toEqual(VIEW)
  })

  it('omits an empty addOnIds list from the wire body', async () => {
    const calls = stubFetch(() => jsonResponse(VIEW))
    await getPublicAvailability(SLUG, {
      date: '2026-11-20',
      selections: [{ serviceId: SERVICE_ID }],
    })

    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      date: '2026-11-20',
      selections: [{ serviceId: SERVICE_ID }],
    })
  })

  it('maps a validation-error envelope to a validation ApiError', async () => {
    stubFetch(() =>
      envelopeResponse(422, 'VALIDATION_ERROR', 'selections must not be empty.'),
    )
    const thrown = await getPublicAvailability(SLUG, {
      date: '2026-11-20',
      selections: [],
    }).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('validation')
  })

  it('maps a 404 to a not-found ApiError for a renamed page', async () => {
    stubFetch(() => envelopeResponse(404, 'NOT_FOUND', 'Business not found.'))
    const thrown = await getPublicAvailability('old-page', {
      date: '2026-11-20',
      selections: [{ serviceId: SERVICE_ID }],
    }).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
  })
})