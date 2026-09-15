import type { Booking, ProofFile } from '@/types/models'
import { nextDateStrings, nowTimestamp } from '@/lib/time'
import { buildPages, PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { computeAvailableTimes } from '@/mock/availability'

/**
 * Deterministic demo bookings seeded into the in-memory store so the owner
 * booking queue has realistic data to open and review, without depending on a
 * running backend. The demo slots are the first available slot of the first
 * two usable weekdays, so they never collide with the fixed mock blocks or
 * with a real customer's later choice of the same slot.
 */

interface DemoSlot {
  date: string
  time: string
}

function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function firstAvailableSlot(
  dates: readonly string[],
  business: Parameters<typeof computeAvailableTimes>[0],
  durationMinutes: number,
  occupied?: readonly { date: string; start: string; end: string }[],
): DemoSlot | null {
  for (const date of dates) {
    const times = computeAvailableTimes(business, date, durationMinutes, occupied)
    if (times.length > 0) return { date, time: times[0] }
  }
  return null
}

export function buildDemoBookings(): readonly Booking[] {
  const page = buildPages().find(
    (candidate) => candidate.business.slug === PRIMARY_BUSINESS_SLUG,
  )
  if (!page) return []

  const service = page.services.find((s) => s.id === 'haircut-styling')
  if (!service) return []

  const { business } = page
  const durationMinutes = service.baseDurationMinutes
  const lineItems = [
    {
      name: service.name,
      unitPrice: service.basePrice,
      durationMinutes,
    },
  ]
  const total = service.basePrice
  const deposit =
    business.prepayment.mode === 'percentage'
      ? Math.ceil((total * (business.prepayment.value ?? 0)) / 100)
      : 0

  const dates = nextDateStrings(Math.max(2, business.bookingWindowDays))
  const pendingSlot = firstAvailableSlot(dates, business, durationMinutes)
  if (!pendingSlot) return []

  const confirmedSlot = firstAvailableSlot(
    dates.filter((date) => date > pendingSlot.date),
    business,
    durationMinutes,
    [
      {
        date: pendingSlot.date,
        start: pendingSlot.time,
        end: shiftTime(pendingSlot.time, durationMinutes),
      },
    ],
  )

  const proof: ProofFile = {
    fileName: 'deposit-receipt.png',
    sizeBytes: 245_760,
    mimeType: 'image/png',
  }

  const now = nowTimestamp()

  const pending: Booking = {
    id: 'bk-demo-pending',
    businessSlug: PRIMARY_BUSINESS_SLUG,
    state: 'payment-pending',
    paymentState: 'pending',
    lineItems,
    total,
    totalDurationMinutes: durationMinutes,
    deposit,
    date: pendingSlot.date,
    time: pendingSlot.time,
    customer: {
      name: 'Martha Bekele',
      phone: '+251911223344',
      note: 'Feeling adventurous — surprise me with the styling.',
    },
    paymentMethod: 'bank-transfer',
    proof,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    history: [
      { state: 'payment-pending', previous: null, actor: 'Customer', at: now },
    ],
    telegramNotices: [],
    slotReleased: false,
    scheduleException: null,
  }

  if (!confirmedSlot) return [pending]

  const confirmedAt = nowimestamp(1)
  const confirmed: Booking = {
    ...pending,
    id: 'bk-demo-confirmed',
    state: 'confirmed',
    paymentState: 'accepted',
    date: confirmedSlot.date,
    time: confirmedSlot.time,
    customer: {
      name: 'Selam Tesfaye',
      phone: '+251911123456',
      note: '',
    },
    createdAt: confirmedAt,
    updatedAt: confirmedAt,
    history: [
      {
        state: 'payment-pending',
        previous: null,
        actor: 'Customer',
        at: confirmedAt,
      },
      {
        state: 'confirmed',
        previous: 'payment-pending',
        actor: 'Demo Owner',
        at: confirmedAt,
      },
    ],
  }

  return [pending, confirmed]
}

function nowimestamp(daysAgo: number): string {
  return nowTimestamp(new Date(Date.now() - daysAgo * 86_400_000))
}