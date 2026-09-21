import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getOwnerSchedule,
  getPublicSchedule,
  listOwnerScheduleConflicts,
  listOwnerScheduleVersions,
  recordScheduleException,
  saveOwnerSchedule,
  updateOwnerScheduleInterval,
} from './schedule'
import { ApiError, isApiError } from './errors'
import type {
  OwnerScheduleConflictView,
  OwnerScheduleSaveResultView,
  OwnerScheduleView,
  PublicScheduleView,
  ScheduleExceptionView,
} from './types'

/**
 * Contract tests for the Prompt 47 schedule API client: every call must use
 * exactly the implemented backend route, method, headers and body, and map the
 * architecture error envelope (Prompt 42 §8) to the typed ApiError model.
 */

const BASE = 'http://localhost:3000/api/v1'
const BUSINESS_ID = '00000000-0000-4000-8000-0000000000aa'

const OWNER_VIEW: OwnerScheduleView = {
  versionId: 'sch-v-1',
  versionNo: 2,
  status: 'ACTIVE',
  name: 'Q3 opening hours',
  appliedAt: '2026-09-18T09:00:00.000Z',
  appliedBy: 'owner@example.com',
  reason: 'Q3 opening hours',
  createdAt: '2026-09-18T09:00:00.000Z',
  workingPeriods: [
    { weekday: 1, startMinutes: 540, endMinutes: 780 },
    { weekday: 1, startMinutes: 840, endMinutes: 1080 },
  ],
  blockedPeriods: [{ dayOfWeek: 1, startMinutes: 570, endMinutes: 630 }],
  specialDates: [{ date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null }],
}

function buildSaveResult(): OwnerScheduleSaveResultView {
  return {
    versionId: 'sch-v-3',
    versionNo: 3,
    activated: true,
    version: { ...OWNER_VIEW, versionId: 'sch-v-3', versionNo: 3 },
  }
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

describe('getOwnerSchedule', () => {
  it('GETs the current owner schedule with session credentials', async () => {
    const calls = stubFetch(() => jsonResponse(OWNER_VIEW))
    const result = await getOwnerSchedule(BUSINESS_ID)

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/schedule/current`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.credentials).toBe('include')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
    expect(result).toEqual(OWNER_VIEW)
  })

  it('maps a 404 to a not-found ApiError', async () => {
    stubFetch(() => errorResponse(404, 'NOT_FOUND', 'Business not found.'))
    const thrown = await getOwnerSchedule(BUSINESS_ID).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
  })
})

describe('listOwnerScheduleVersions', () => {
  it('GETs the owner schedule history', async () => {
    const calls = stubFetch(() => jsonResponse([OWNER_VIEW, { ...OWNER_VIEW, status: 'SUPERSEDED' }]))
    const result = await listOwnerScheduleVersions(BUSINESS_ID)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/schedule/versions`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(OWNER_VIEW)
  })
})

describe('listOwnerScheduleConflicts', () => {
  it('GETs open schedule conflicts', async () => {
    const calls = stubFetch(() => jsonResponse([]))
    const result = await listOwnerScheduleConflicts(BUSINESS_ID)

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/schedule/conflicts`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual([])
  })
})

describe('saveOwnerSchedule', () => {
  it('PUTs the versioned schedule payload', async () => {
    const calls = stubFetch(() => jsonResponse(buildSaveResult()))
    const result = await saveOwnerSchedule(BUSINESS_ID, {
      name: 'Q3 opening hours',
      workingPeriods: [
        { weekday: 1, startMinutes: 540, endMinutes: 780 },
        { weekday: 1, startMinutes: 840, endMinutes: 1080 },
      ],
      blockedPeriods: [{ dayOfWeek: 1, startMinutes: 570, endMinutes: 630 }],
      specialDates: [{ date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null }],
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/schedule`)
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Q3 opening hours',
      workingPeriods: [
        { weekday: 1, startMinutes: 540, endMinutes: 780 },
        { weekday: 1, startMinutes: 840, endMinutes: 1080 },
      ],
      blockedPeriods: [{ dayOfWeek: 1, startMinutes: 570, endMinutes: 630 }],
      specialDates: [{ date: '2026-12-25', kind: 'CLOSED', startMinutes: null, endMinutes: null }],
    })
    expect(result.activated).toBe(true)
    expect(result.version.versionId).toBe('sch-v-3')
  })

  it('maps a 409 to a conflict ApiError', async () => {
    stubFetch(() => errorResponse(409, 'CONFLICT', 'Blocked periods overlap.'))
    const thrown = await saveOwnerSchedule(BUSINESS_ID, {
      workingPeriods: [],
    }).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('conflict')
  })
})

describe('recordScheduleException', () => {
  it('POSTs the Keep-Booking exception (REQ-160/161)', async () => {
    const view: ScheduleExceptionView = {
      id: 'sch-exc-1',
      scheduleVersionId: 'sch-v-3',
      bookingId: 'bk-1',
      reason: 'Kept as a schedule exception.',
      createdAt: '2026-09-18T09:10:00.000Z',
    }
    const calls = stubFetch(() => jsonResponse(view))
    const result = await recordScheduleException(BUSINESS_ID, {
      bookingId: 'bk-1',
      versionId: 'sch-v-3',
      reason: 'Confirmed by phone.',
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/schedule/exceptions`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      bookingId: 'bk-1',
      versionId: 'sch-v-3',
      reason: 'Confirmed by phone.',
    })
    expect(result.bookingId).toBe('bk-1')
  })
})

describe('updateOwnerScheduleInterval', () => {
  it('PATCHes the booking interval on business settings (REQ-086)', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ id: BUSINESS_ID, slug: 'addis-beauty-lounge', bookingIntervalMinutes: 45 }),
    )
    const result = await updateOwnerScheduleInterval(BUSINESS_ID, { bookingIntervalMinutes: 45 })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/settings`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ bookingIntervalMinutes: 45 })
    expect(result.bookingIntervalMinutes).toBe(45)
  })
})

describe('getPublicSchedule', () => {
  it('GETs the public schedule projection by slug', async () => {
    const publicView: PublicScheduleView = {
      workingPeriods: [{ weekday: 1, startMinutes: 540, endMinutes: 780 }],
      blockedPeriods: [],
      specialDates: [],
    }
    const calls = stubFetch(() => jsonResponse(publicView))
    const result = await getPublicSchedule('addis-beauty-lounge')

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/public/businesses/addis-beauty-lounge/schedule`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual(publicView)
  })

  it('maps a 404 to a not-found ApiError for a renamed page', async () => {
    stubFetch(() => errorResponse(404, 'NOT_FOUND', 'This page is no longer published.'))
    const thrown = await getPublicSchedule('old-page').catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
  })
})

describe('conflict view mapping', () => {
  it('passes the conflict fields straight through (Prompt 47 §18)', async () => {
    const conflict: OwnerScheduleConflictView = {
      bookingId: 'bk-1',
      status: 'confirmed',
      startAt: '2030-03-04T10:00:00.000Z',
      endAt: '2030-03-04T11:00:00.000Z',
      createdAt: '2026-09-18T09:00:00.000Z',
      customerName: 'Test Customer',
      customerPhone: '+251911111111',
      note: null,
      reason: 'CLOSED',
      reasonDetail: 'The business is closed on Mon, Mar 4 2030.',
      services: [{ name: 'Haircut', durationMinutes: 60, unitPriceMinor: '30000' }],
    }
    const calls = stubFetch(() => jsonResponse([conflict]))
    const result = await listOwnerScheduleConflicts(BUSINESS_ID)

    expect(calls[0].url).toBe(`${BASE}/owner/businesses/${BUSINESS_ID}/schedule/conflicts`)
    expect(result).toEqual([conflict])
  })
})