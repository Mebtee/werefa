import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCustomerBooking,
  getCustomerBookingStatus,
  requestResubmissionCode,
  verifyResubmission,
} from './booking'
import {
  bookingStateFromWire,
  createdResultFromView,
  statusEntriesFromView,
} from './booking.mapper'
import { ApiError, isApiError } from './errors'
import type { CustomerBookingView, CustomerStatusView } from './types'

/**
 * Contract tests for the Prompt 49 booking API client: the calls must use
 * exactly the implemented backend routes (`POST /api/v1/customer/bookings`
 * idempotent by submissionKey, REQ-121; `GET /api/v1/customer/status?slug=&
 * phone=`), send the multi-service selections (the backend is authoritative
 * for prices/durations, REQ-074/076), and map the PUBLIC_STATUS strings into
 * the UI BookingState model truthfully.
 */

const BASE = 'http://localhost:3000/api/v1'
const SLUG = 'addis-beauty-lounge'

const SERVICE_ID = '11111111-1111-4111-8111-111111111111'

const CREATE_VIEW: CustomerBookingView = {
  status: 'awaiting-verification',
  startAt: '2026-11-20T09:00:00.000Z',
  endAt: '2026-11-20T10:45:00.000Z',
  serviceNames: ['Haircut', 'Styling', 'Wash'],
  businessSlug: SLUG,
  totalPriceMinor: 20500,
  prepaidMinor: 4100,
  paymentMethod: 'BANK_TRANSFER',
  note: null,
}

const STATUS_VIEW: CustomerStatusView = {
  bookings: [
    {
      startAt: '2026-11-22T10:00:00.000Z',
      endAt: '2026-11-22T11:00:00.000Z',
      status: 'confirmed',
    },
    {
      startAt: '2026-11-20T09:00:00.000Z',
      endAt: '2026-11-20T09:45:00.000Z',
      status: 'awaiting-verification',
    },
  ],
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

/** The JSON `payload` text field of a multipart request body. */
function multipartPayloadOf(init?: RequestInit): unknown {
  const form = init?.body
  if (!(form instanceof FormData)) return undefined
  const text = form.get('payload')
  return typeof text === 'string' ? (JSON.parse(text) as unknown) : undefined
}

/** The `proof` file field of a multipart request body, if any. */
function multipartProofOf(init?: RequestInit): File | null {
  const form = init?.body
  if (!(form instanceof FormData)) return null
  const file = form.get('proof')
  return file instanceof File ? file : null
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createCustomerBooking', () => {
  it('POSTs the wire body (selections + submissionKey) to the customer bookings route', async () => {
    const calls = stubFetch(() => jsonResponse(CREATE_VIEW))
    const result = await createCustomerBooking({
      businessSlug: SLUG,
      selections: [
        {
          serviceId: SERVICE_ID,
          variationId: '22222222-2222-4222-8222-222222222222',
          addOnIds: ['33333333-3333-4333-8333-333333333333'],
        },
      ],
      customerName: 'Awit Haile',
      customerPhone: '+251911112233',
      note: 'by the window',
      startAt: '2026-11-20T09:00:00.000Z',
      submissionKey: 'invoice-20261120-0001',
      paymentMethod: 'BANK_TRANSFER',
    })

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/customer/bookings`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    // Prompt 50: booking-create is multipart — the JSON lives in the `payload`
    // text field, and no proof file was supplied here (prepayment NONE).
    expect(init?.body).toBeInstanceOf(FormData)
    expect(multipartPayloadOf(init)).toEqual({
      businessSlug: SLUG,
      selections: [
        {
          serviceId: SERVICE_ID,
          variationId: '22222222-2222-4222-8222-222222222222',
          addOnIds: ['33333333-3333-4333-8333-333333333333'],
        },
      ],
      customerName: 'Awit Haile',
      customerPhone: '+251911112233',
      note: 'by the window',
      startAt: '2026-11-20T09:00:00.000Z',
      submissionKey: 'invoice-20261120-0001',
      paymentMethod: 'BANK_TRANSFER',
    })
    expect(multipartProofOf(init)).toBeNull()
    expect(result).toEqual(CREATE_VIEW)
  })

  it('attaches the payment proof as the multipart `proof` file field', async () => {
    const calls = stubFetch(() => jsonResponse(CREATE_VIEW))
    const proof = new File(['png-bytes'], 'receipt.png', { type: 'image/png' })
    await createCustomerBooking(
      {
        businessSlug: SLUG,
        selections: [{ serviceId: SERVICE_ID }],
        customerName: 'Awit Haile',
        customerPhone: '+251911112233',
        startAt: '2026-11-20T09:00:00.000Z',
        submissionKey: 'invoice-20261120-0002',
        paymentMethod: 'BANK_TRANSFER',
      },
      proof,
    )

    const [{ init }] = calls
    // The client must NOT set a JSON content type on a multipart request; the
    // browser supplies the boundary-bearing type.
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBeUndefined()
    const sent = multipartProofOf(init)
    expect(sent?.name).toBe('receipt.png')
    expect(sent?.type).toBe('image/png')
  })

  it('maps a slot conflict to a conflict ApiError (SLOT_UNAVAILABLE)', async () => {
    stubFetch(() =>
      envelopeResponse(409, 'SLOT_UNAVAILABLE', 'The requested time is no longer available.'),
    )
    const thrown = await createCustomerBooking({
      businessSlug: SLUG,
      selections: [{ serviceId: SERVICE_ID }],
      customerName: 'Awit Haile',
      customerPhone: '+251911112233',
      startAt: '2026-11-20T09:00:00.000Z',
      submissionKey: 'invoice-20261120-0001',
    }).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('conflict')
    expect((thrown as ApiError).code).toBe('SLOT_UNAVAILABLE')
  })

  it('maps an idempotency conflict (same key, different request) to a conflict ApiError', async () => {
    stubFetch(() =>
      envelopeResponse(409, 'CONFLICT', 'This submission key was already used for a different booking request.'),
    )
    const thrown = await createCustomerBooking({
      businessSlug: SLUG,
      selections: [{ serviceId: SERVICE_ID }],
      customerName: 'Awit Haile',
      customerPhone: '+251911112233',
      startAt: '2026-11-20T11:00:00.000Z',
      submissionKey: 'invoice-20261120-0001',
    }).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).code).toBe('CONFLICT')
    expect((thrown as ApiError).kind).toBe('conflict')
  })
})

describe('getCustomerBookingStatus', () => {
  it('GETs the customer status route with slug + phone query params', async () => {
    const calls = stubFetch(() => jsonResponse(STATUS_VIEW))
    const result = await getCustomerBookingStatus(SLUG, '+251911112233')

    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/customer/status?slug=${SLUG}&phone=${encodeURIComponent('+251911112233')}`)
    expect(init?.method).toBe('GET')
    expect(result).toEqual(STATUS_VIEW)
  })

  it('maps an unknown business to a not-found ApiError', async () => {
    stubFetch(() => envelopeResponse(404, 'NOT_FOUND', 'Business not found.'))
    const thrown = await getCustomerBookingStatus('no-such-business', '+251911112233').catch(
      (e: unknown) => e,
    )
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('not-found')
  })
})

describe('resubmission API client', () => {
  it('POSTs the JSON code request to the resubmission route', async () => {
    const calls = stubFetch(() => jsonResponse({ expiresAt: '2026-11-20T09:10:00.000Z' }))
    const result = await requestResubmissionCode({
      businessSlug: SLUG,
      phone: '+251911112233',
    })

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/customer/resubmission/request-code`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      businessSlug: SLUG,
      phone: '+251911112233',
    })
    expect(result).toEqual({ expiresAt: '2026-11-20T09:10:00.000Z' })
  })

  it('POSTs the code + fresh proof as multipart to the verify route', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ booking: CREATE_VIEW, outcome: 'PROOF_RECEIVED' }),
    )
    const proof = new File(['pdf-bytes'], 'receipt.pdf', { type: 'application/pdf' })
    const result = await verifyResubmission(
      {
        businessSlug: SLUG,
        phone: '+251911112233',
        code: '123456',
        submissionKey: 'resub-1',
      },
      proof,
    )

    const [{ url, init }] = calls
    expect(url).toBe(`${BASE}/customer/resubmission/verify`)
    expect(init?.method).toBe('POST')
    expect(multipartPayloadOf(init)).toEqual({
      businessSlug: SLUG,
      phone: '+251911112233',
      code: '123456',
      submissionKey: 'resub-1',
    })
    expect(multipartProofOf(init)?.name).toBe('receipt.pdf')
    expect(result.outcome).toBe('PROOF_RECEIVED')
    expect(result.booking).toEqual(CREATE_VIEW)
  })

  it('maps an invalid code (400 VALIDATION_ERROR) through to the UI', async () => {
    stubFetch(() =>
      envelopeResponse(400, 'VALIDATION_ERROR', 'The verification code is invalid.'),
    )
    const thrown = await verifyResubmission(
      {
        businessSlug: SLUG,
        phone: '+251911112233',
        code: '000000',
        submissionKey: 'resub-1',
      },
      new File(['x'], 'receipt.png', { type: 'image/png' }),
    ).catch((e: unknown) => e)
    expect(isApiError(thrown)).toBe(true)
    expect((thrown as ApiError).kind).toBe('validation')
  })
})

describe('booking.mapper', () => {
  it('maps the backend awaiting-verification state to payment-pending', () => {
    expect(bookingStateFromWire('awaiting-verification')).toBe('payment-pending')
    expect(bookingStateFromWire('confirmed')).toBe('confirmed')
    expect(bookingStateFromWire('rejected')).toBe('rejected')
    expect(bookingStateFromWire('cancelled')).toBe('cancelled')
    expect(bookingStateFromWire('completed')).toBe('completed')
    expect(bookingStateFromWire('no-show')).toBe('no-show')
    expect(bookingStateFromWire('weird-state')).toBe('payment-pending')
  })

  it('turns a create response into a created result (payment-pending)', () => {
    expect(createdResultFromView(CREATE_VIEW)).toEqual({
      status: 'created',
      disposition: 'payment-pending',
    })
  })

  it('keeps the served order of status entries (newest first) and maps statuses', () => {
    const entries = statusEntriesFromView(STATUS_VIEW)
    expect(entries).toEqual([
      {
        startAt: '2026-11-22T10:00:00.000Z',
        endAt: '2026-11-22T11:00:00.000Z',
        bookingState: 'confirmed',
      },
      {
        startAt: '2026-11-20T09:00:00.000Z',
        endAt: '2026-11-20T09:45:00.000Z',
        bookingState: 'payment-pending',
      },
    ])
  })
})