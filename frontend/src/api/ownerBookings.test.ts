import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptOwnerBooking,
  downloadOwnerBookingProof,
  getOwnerBookingDetail,
  rejectOwnerBooking,
} from './ownerBookings'
import { ApiError } from './errors'
import { fileNameFromContentDisposition } from './http'
import type { OwnerBookingDetailView } from './types'

/**
 * Contract tests for the Prompt 51 owner payment-proof review client. The calls
 * must use exactly the implemented owner routes (tenant-scoped by `businessId`),
 * send the rejection reason as JSON, stream the proof as binary, and surface the
 * backend error envelope as an `ApiError`.
 */

const BASE = 'http://localhost:3000/api/v1'
const BUSINESS_ID = '00000000-0000-4000-8000-0000000000a'
const BOOKING_ID = '42'
const PROOF_ID = '11111111-1111-4111-8111-111111111111'
const PATH = `/owner/businesses/${BUSINESS_ID}/bookings/${BOOKING_ID}`

const DETAIL: OwnerBookingDetailView = {
  bookingId: 42,
  status: 'PAYMENT_PENDING',
  customerName: 'Awit',
  customerPhone: '+251911000000',
  note: null,
  startAt: '2026-09-20T09:00:00.000Z',
  endAt: '2026-09-20T09:30:00.000Z',
  createdAt: '2026-09-18T09:00:00.000Z',
  updatedAt: '2026-09-18T09:00:00.000Z',
  payment: { status: 'PENDING', method: 'BANK_TRANSFER', prepaidMinor: 10000 },
  components: [
    { componentType: 'SERVICE', name: 'Haircut', unitPriceMinor: 20000, durationMinutes: 30 },
  ],
  totalPriceMinor: 20000,
  actorType: 'CUSTOMER',
  history: [
    {
      occurredAt: '2026-09-18T09:00:00.000Z',
      fromStatus: null,
      toStatus: 'PAYMENT_PENDING',
      actorType: 'CUSTOMER',
      actorUserId: null,
      reason: null,
    },
  ],
  proofs: [
    {
      proofId: PROOF_ID,
      submittedAt: '2026-09-18T09:00:00.000Z',
      fileName: 'payment-proof-11111111.png',
      mimeType: 'image/png',
      sizeBytes: 5120,
      replaced: false,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('owner booking detail', () => {
  it('GETs the owner-scoped booking detail and returns the projection', async () => {
    const calls = stubFetch(() => jsonResponse(DETAIL))
    const detail = await getOwnerBookingDetail(BUSINESS_ID, BOOKING_ID)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}${PATH}`)
    expect(calls[0].init?.method).toBe('GET')
    expect(detail).toEqual(DETAIL)
  })

  it('treats a booking from another business as a 404 ApiError', async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: 'NOT_FOUND', title: 'Not found', detail: 'Booking not found.' } },
        404,
      ),
    )
    await expect(getOwnerBookingDetail(BUSINESS_ID, 'other')).rejects.toMatchObject({
      status: 404,
      kind: 'not-found',
    })
  })
})

describe('owner accept / reject', () => {
  it('POSTs accept to the owner-scoped route', async () => {
    const calls = stubFetch(() => jsonResponse({ ...DETAIL, status: 'CONFIRMED' }))
    const updated = await acceptOwnerBooking(BUSINESS_ID, BOOKING_ID)

    expect(calls[0].url).toBe(`${BASE}${PATH}/accept`)
    expect(calls[0].init?.method).toBe('POST')
    expect(updated.status).toBe('CONFIRMED')
  })

  it('POSTs reject with the reason as a JSON body', async () => {
    const calls = stubFetch(() => jsonResponse({ ...DETAIL, status: 'REJECTED' }))
    await rejectOwnerBooking(BUSINESS_ID, BOOKING_ID, 'The transfer reference is missing.')

    expect(calls[0].url).toBe(`${BASE}${PATH}/reject`)
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      reason: 'The transfer reference is missing.',
    })
  })

  it('maps an invalid-transition conflict to an ApiError', async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: 'INVALID_TRANSITION',
            title: 'Conflict',
            detail: 'Only a Payment Pending booking can be accepted.',
          },
        },
        409,
      ),
    )
    const error = await acceptOwnerBooking(BUSINESS_ID, BOOKING_ID).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('conflict')
  })
})

describe('owner proof download', () => {
  it('streams the proof as a Blob with the server filename', async () => {
    const calls = stubFetch(
      () =>
        new Response(new Blob(['bytes'], { type: 'image/png' }), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-disposition': 'attachment; filename="payment-proof-11111111.png"',
          },
        }),
    )
    const proof = await downloadOwnerBookingProof(BUSINESS_ID, BOOKING_ID, PROOF_ID)

    expect(calls[0].url).toBe(`${BASE}${PATH}/proofs/${PROOF_ID}`)
    expect(proof.contentType).toBe('image/png')
    expect(proof.fileName).toBe('payment-proof-11111111.png')
    expect(proof.blob.size).toBeGreaterThan(0)
  })

  it('parses an RFC 5987 filename', () => {
    expect(
      fileNameFromContentDisposition("attachment; filename*=UTF-8''payment%20proof.png"),
    ).toBe('payment proof.png')
    expect(fileNameFromContentDisposition(null)).toBeNull()
  })
})
