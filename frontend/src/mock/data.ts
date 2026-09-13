import type {
  BlockedPeriod,
  BusinessPage,
  DateString,
  Money,
  Service,
  WeeklyWorkingHours,
} from '@/types/models'
import { addDays, toDateString } from '@/lib/time'

export const PRIMARY_BUSINESS_SLUG = 'addis-beauty-lounge'

function weekdays(
  sunday: readonly string[] = [],
  monday: readonly string[] = [],
  tuesday: readonly string[] = [],
  wednesday: readonly string[] = [],
  thursday: readonly string[] = [],
  friday: readonly string[] = [],
  saturday: readonly string[] = [],
): WeeklyWorkingHours {
  return [sunday, monday, tuesday, wednesday, thursday, friday, saturday].map(
    (periods) =>
      periods.map((p) => {
        const [start, end] = p.split('-')
        return { start, end }
      }),
  ) as WeeklyWorkingHours
}

const salonHours = weekdays(
  [],
  ['09:00-13:00', '14:00-18:00'],
  ['09:00-13:00', '14:00-18:00'],
  ['09:00-13:00', '14:00-18:00'],
  ['09:00-13:00', '14:00-18:00'],
  ['09:00-13:00', '14:00-18:00'],
  ['09:00-14:00'],
)

const autoCareHours = weekdays(
  [],
  ['08:00-12:00', '13:00-17:00'],
  ['08:00-12:00', '13:00-17:00'],
  ['08:00-12:00', '13:00-17:00'],
  ['08:00-12:00', '13:00-17:00'],
  ['08:00-12:00', '13:00-17:00'],
  ['08:00-13:00'],
)

const dryCleaningHours = weekdays(
  [],
  ['08:30-12:30', '13:30-17:30'],
  ['08:30-12:30', '13:30-17:30'],
  ['08:30-12:30', '13:30-17:30'],
  ['08:30-12:30', '13:30-17:30'],
  ['08:30-12:30', '13:30-17:30'],
  ['09:00-13:00'],
)

function service(input: {
  id: string
  name: string
  description?: string
  basePrice: Money
  baseDurationMinutes: number
}): Service {
  return { ...input, variations: [], addOns: [] }
}

const salonServices: Service[] = [
  {
    id: 'haircut-styling',
    name: 'Women’s Haircut & Styling',
    description: 'Cut, wash and hairstyle tailored to your hair type.',
    basePrice: 90000,
    baseDurationMinutes: 60,
    variations: [
      { id: 'basic', name: 'Basic cut', priceDelta: 0, durationDeltaMinutes: 0 },
      {
        id: 'premium',
        name: 'Premium styling',
        priceDelta: 30000,
        durationDeltaMinutes: 15,
      },
    ],
    addOns: [
      { id: 'hair-wash', name: 'Deep-conditioning wash', price: 15000, durationMinutes: 15 },
      { id: 'blowdry', name: 'Blow-dry finish', price: 10000, durationMinutes: 10 },
    ],
  },
  {
    id: 'mens-haircut',
    name: 'Men’s Cut',
    basePrice: 40000,
    baseDurationMinutes: 30,
    variations: [
      { id: 'basic', name: 'Classic', priceDelta: 0, durationDeltaMinutes: 0 },
      { id: 'fade', name: 'Skin fade', priceDelta: 10000, durationDeltaMinutes: 10 },
    ],
    addOns: [{ id: 'beard-trim', name: 'Beard trim', price: 15000, durationMinutes: 15 }],
  },
  {
    id: 'mani-pedi',
    name: 'Manicure & Pedicure',
    description: 'Full care for hands and feet.',
    basePrice: 75000,
    baseDurationMinutes: 75,
    variations: [
      { id: 'std', name: 'Standard', priceDelta: 0, durationDeltaMinutes: 0 },
      { id: 'gel', name: 'Gel polish', priceDelta: 40000, durationDeltaMinutes: 20 },
    ],
    addOns: [
      { id: 'paraffin', name: 'Paraffin treatment', price: 20000, durationMinutes: 10 },
    ],
  },
  {
    id: 'facial',
    name: 'Deep-Cleansing Facial',
    description: 'Gentle, thorough cleanse with steam and mask.',
    basePrice: 85000,
    baseDurationMinutes: 60,
    variations: [
      { id: 'std', name: 'Standard', priceDelta: 0, durationDeltaMinutes: 0 },
      { id: 'gold', name: 'Gold infusion', priceDelta: 50000, durationDeltaMinutes: 20 },
    ],
    addOns: [
      { id: 'dermaplane', name: 'Express dermaplaning', price: 25000, durationMinutes: 15 },
    ],
  },
]

const autoCareServices: Service[] = [
  {
    id: 'oil-change',
    name: 'Oil Change & Filter Swap',
    description: 'Engine oil and oil filter replacement.',
    basePrice: 120000,
    baseDurationMinutes: 45,
    variations: [
      { id: 'std', name: 'Standard oil', priceDelta: 0, durationDeltaMinutes: 0 },
      { id: 'synthetic', name: 'Synthetic oil', priceDelta: 60000, durationDeltaMinutes: 0 },
    ],
    addOns: [
      { id: 'tyre-pressure', name: 'Tyre pressure check (all 4)', price: 20000, durationMinutes: 20 },
    ],
  },
  service({ id: 'hand-wash', name: 'Exterior Hand Wash', basePrice: 50000, baseDurationMinutes: 30 }),
  service({
    id: 'wheel-align',
    name: 'Wheel Alignment',
    description: 'Front + rear alignment setup.',
    basePrice: 180000,
    baseDurationMinutes: 60,
  }),
]

const dryCleaningServices: Service[] = [
  service({ id: 'laundry-kg', name: 'Standard Laundry (per kg)', basePrice: 25000, baseDurationMinutes: 120 }),
  service({ id: 'dry-clean-item', name: 'Dry Cleaning (per item)', basePrice: 60000, baseDurationMinutes: 90 }),
]

function seedBookings(slug: string, date: DateString): readonly BlockedPeriod[] {
  const today = toDateString(new Date())
  const at = (offsetDays: number) => addDays(today, offsetDays)

  switch (slug) {
    case 'addis-beauty-lounge': {
      if (date === at(0)) {
        return [
          { date, start: '10:00', end: '11:00' },
          { date, start: '15:00', end: '16:00' },
        ]
      }
      if (date === at(1)) return [{ date, start: '11:00', end: '12:00' }]
      if (date === at(2)) return [{ date, start: '09:00', end: '10:00' }]
      return []
    }
    case 'marathon-auto-care': {
      if (date === at(0)) return [{ date, start: '08:00', end: '09:00' }]
      if (date === at(1)) return [{ date, start: '16:00', end: '16:45' }]
      return []
    }
    default:
      return []
  }
}

function buildPages(): readonly BusinessPage[] {
  const today = toDateString(new Date())

  return [
    {
      business: {
        slug: 'addis-beauty-lounge',
        name: 'Addis Beauty Lounge',
        category: 'salon-barber',
        tagline: 'Hair, skin and nails — booked in under a minute.',
        description:
          'Addis Beauty Lounge is a full-service salon and barber. Every booking is confirmed by our team by phone, so you always know where you stand.',
        accentColor: '#b4457f',
        address: 'Bole Road, Addis Ababa (opposite the roundabout)',
        lat: 9.0108,
        lng: 38.7612,
        mapProvider: 'osm',
        phone: '+251 911 000 000',
        workingHours: salonHours,
        bookingIntervalMinutes: 30,
        blockedDays: [addDays(today, 5)],
        blockedPeriods: [{ date: addDays(today, 4), start: '12:00', end: '14:00' }],
        specialDays: {
          [addDays(today, 6)]: { kind: 'closed' },
          [addDays(today, 7)]: { kind: 'hours', periods: [{ start: '10:00', end: '14:00' }] },
        },
        pause: null,
        subscriptionStatus: 'active',
        prepayment: { mode: 'percentage', value: 20 },
        paymentInstructions: {
          methods: [
            {
              id: 'bank-transfer',
              label: 'Bank transfer',
              steps: [
                'Transfer the deposit to the account below. Use your phone number as the payment reference so we can match it to your booking.',
                'Bank: Demo Bank (placeholder)',
                'Account name: Addis Beauty Lounge',
                'Account number: 1000 0000 0000',
              ],
            },
            {
              id: 'telebirr',
              label: 'Telebirr (mobile money)',
              steps: [
                'Send the deposit to the number below. Your phone number will be attached automatically.',
                'Telebirr number: 09XX XXX XXXX (placeholder)',
                'Account name: Addis Beauty Lounge',
              ],
            },
          ],
        },
        currency: 'ETB',
        bookingWindowDays: 14,
      },
      services: salonServices,
    },
    {
      business: {
        slug: 'marathon-auto-care',
        name: 'Marathon Auto Care',
        category: 'other',
        tagline: 'Honest car care, on time.',
        description:
          'Routine maintenance and detailing for cars and light trucks. You drop off the keys, we call you when it is ready.',
        accentColor: '#2f6db3',
        address: 'Mexico Square, Addis Ababa, near the petrol station',
        lat: 9.0214,
        lng: 38.7604,
        mapProvider: 'google',
        phone: '+251 922 000 000',
        workingHours: autoCareHours,
        bookingIntervalMinutes: 30,
        blockedDays: [],
        blockedPeriods: [],
        specialDays: {},
        pause: null,
        subscriptionStatus: 'active',
        prepayment: { mode: 'none' },
        paymentInstructions: {
          methods: [
            {
              id: 'bank-transfer',
              label: 'Bank transfer',
              steps: [
                'Pay when you collect. If a deposit is ever required we will tell you first.',
                'Bank: Demo Bank (placeholder)',
                'Account number: 2000 0000 0000',
              ],
            },
            {
              id: 'telebirr',
              label: 'Telebirr (mobile money)',
              steps: [
                'Pay at pick-up via Telebirr.',
                'Telebirr number: 09XY XXX XXX (placeholder)',
              ],
            },
          ],
        },
        currency: 'ETB',
        bookingWindowDays: 14,
      },
      services: autoCareServices,
    },
    {
      business: {
        slug: 'riverside-dry-cleaning',
        name: 'Riverside Dry Cleaning',
        category: 'other',
        tagline: 'Clean clothes, collected and delivered.',
        description:
          'Laundry and dry cleaning pickup. Book a window and we collect from your doorstep.',
        accentColor: '#1f8a70',
        address: 'Kazanchis, Addis Ababa, 2nd floor, corner shop',
        lat: 9.0155,
        lng: 38.7721,
        mapProvider: 'osm',
        phone: '+251 933 000 000',
        workingHours: dryCleaningHours,
        bookingIntervalMinutes: 30,
        blockedDays: [],
        blockedPeriods: [],
        specialDays: {},
        pause: {
          kind: 'until',
          reopenDate: addDays(today, 21),
          message:
            'We are closed for end-of-season cleaning. New bookings open on the listed date.',
        },
        subscriptionStatus: 'active',
        prepayment: { mode: 'percentage', value: 20 },
        paymentInstructions: {
          methods: [
            {
              id: 'telebirr',
              label: 'Telebirr (mobile money)',
              steps: [
                'Send the deposit to 09XZ XXX XXX. Your phone number is attached automatically.',
              ],
            },
          ],
        },
        currency: 'ETB',
        bookingWindowDays: 14,
      },
      services: dryCleaningServices,
    },
  ]
}

const PAGES: readonly BusinessPage[] = buildPages()

export const MOCK_BUSINESS_PAGES: readonly BusinessPage[] = PAGES

export function findBusinessPage(slug: string): BusinessPage | undefined {
  return PAGES.find((page) => page.business.slug === slug)
}

/**
 * Mock-only: deterministic "already taken" bookings for a business+date.
 * Kept under the mock seam so it can be replaced by the real API later.
 */
export function mockTakenBlocks(slug: string, date: DateString): readonly BlockedPeriod[] {
  return seedBookings(slug, date)
}

/**
 * Mock-only: a slot that the mock API lets the customer pick but always
 * reports back as "unavailable" on submit, to exercise the lost-race path
 * (a slot can be offered, yet taken by another customer first). It is the next
 * 30-minute boundary after now so it is always a "future" slot that is shown.
 */
export function mockRaceSlot(slug: string): { date: DateString; time: string } | null {
  if (slug !== 'addis-beauty-lounge') return null
  const now = new Date()
  const minutesIntoDay = now.getHours() * 60 + now.getMinutes()
  const next = Math.ceil((minutesIntoDay + 1) / 30) * 30
  const h = Math.floor(next / 60)
  const m = next % 60
  return {
    date: toDateString(now),
    time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  }
}