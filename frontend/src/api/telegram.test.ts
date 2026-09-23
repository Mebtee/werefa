import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  connectCustomerTelegram,
  connectOwnerTelegram,
  getOwnerTelegramStatus,
  telegramLinkFromView,
} from './telegram'
import { ApiError, isApiError } from './errors'
import type { TelegramConnectionView } from './types'

/**
 * Contract tests for the Prompt 51 Telegram client: the calls must use exactly
 * the implemented backend routes (`POST /public/businesses/:slug/telegram/
 * connect`, `GET`/`POST /owner/businesses/:id/telegram/status|connect`), send
 * the customer phone per REQ-056, and map the connection view — a never-exposed
 * plain code, only the one-time deep link / expiry — into the UI `TelegramLinkState`.
 */

const BASE = 'http://localhost:3000/api/v1'
const SLUG = 'addis-beauty-lounge'
const BIZ_ID = 'c0de0000-0000-4000-8000-000000000001'

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

const jsonBodyOf = (init?: RequestInit): unknown => {
  if (typeof init?.body !== 'string') return undefined
  try {
    return JSON.parse(init.body) as unknown
  } catch {
    return undefined
  }
}

const READY_VIEW: TelegramConnectionView = {
  status: 'ready',
  deepLink: 'https://t.me/werefademo?start=abc123broken456secret',
  expiresInMs: 600000,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('connectCustomerTelegram', () => {
  it('POSTs only the phone to the public telegram connect route (REQ-056)', async () => {
    const calls = stubFetch(() => jsonResponse(READY_VIEW))
    const result = await connectCustomerTelegram(SLUG, '+251911223344')

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/public/businesses/${SLUG}/telegram/connect`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(jsonBodyOf(init)).toEqual({ phone: '+251911223344' })
    expect(init?.headers).not.toBeUndefined()

    // The caller never receives the plain code — only the deep link + expiry.
    expect(result.deepLink).toBe(READY_VIEW.deepLink)
    expect(result.expiresInMs).toBe(READY_VIEW.expiresInMs)
  })

  it('answers already-linked connections with status connected (no new code)', async () => {
    stubFetch(() =>
      jsonResponse({ status: 'connected', deepLink: null, expiresInMs: null }),
    )
    const result = await connectCustomerTelegram(SLUG, '+251911223344')
    expect(result).toEqual({ status: 'connected', deepLink: null, expiresInMs: null })
  })

  it('rejects with ApiError when the backend refuses the business/slug', async () => {
    stubFetch(() => envelopeResponse(404, 'NOT_FOUND', 'Business not found.'))
    const error = await connectCustomerTelegram('nope', '+251911223344').then(
      () => null,
      (e: unknown) => e,
    )
    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(404)
  })
})

describe('getOwnerTelegramStatus', () => {
  it('GETs the owner connection state keyed by business id', async () => {
    const calls = stubFetch(() => jsonResponse({ connected: true }))
    const result = await getOwnerTelegramStatus(BIZ_ID)

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BIZ_ID}/telegram/status`)
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('include')
    expect(result).toEqual({ connected: true })
  })

  it('rejects with ApiError on a non-owner business', async () => {
    stubFetch(() => envelopeResponse(403, 'FORBIDDEN', 'Not your business.'))
    const error = await getOwnerTelegramStatus(BIZ_ID).then(
      () => null,
      (e: unknown) => e,
    )
    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(403)
  })
})

describe('connectOwnerTelegram', () => {
  it('POSTs with no body to the owner connect route', async () => {
    const calls = stubFetch(() => jsonResponse(READY_VIEW))
    const result = await connectOwnerTelegram(BIZ_ID)

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BIZ_ID}/telegram/connect`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(init?.body ?? null).toBeNull()
    expect(result.deepLink).toBe(READY_VIEW.deepLink)
  })
})

describe('telegramLinkFromView', () => {
  it('maps a connected view to the connected state', () => {
    const link = telegramLinkFromView({ status: 'connected', deepLink: null, expiresInMs: null })
    expect(link.state).toBe('connected')
  })

  it('carries the one-time deep link and expiry for a ready view', () => {
    // Inject a deterministic clock so the expiry wall-clock is exact.
    const now = new Date('2026-09-23T12:00:00.000Z').getTime()
    const link = telegramLinkFromView(READY_VIEW, now)
    expect(link.state).toBe('ready')
    if (link.state !== 'ready') return
    expect(link.deepLink).toBe('https://t.me/werefademo?start=abc123broken456secret')
    // `expiresAtMs` is the absolute instant the 10-minute code lapses, derived
    // from the server-issued duration at response time.
    const duration = READY_VIEW.expiresInMs
    expect(duration).not.toBeNull()
    expect(link.expiresAtMs).toBe(now + (duration as number))
    expect(link.expiresAtMs).toBeGreaterThan(now)
  })

  it('never leaks a plain auth code — the deep link query holds it, not a field', () => {
    const link = telegramLinkFromView(READY_VIEW)
    if (link.state !== 'ready') return
    expect(link).not.toHaveProperty('code')
    expect(JSON.stringify(READY_VIEW)).not.toContain('"code"')
  })
})