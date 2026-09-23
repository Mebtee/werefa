import { describe, expect, it } from 'vitest'
import type { BusinessDetails } from '@/types/models'
import { getBusinessPage } from '@/mock/store'
import { computeAvailableTimes, periodsForDate } from '@/mock/availability'

// Self-contained fixture: deterministic dates far in the future, so the
// results never depend on which day of the week the test suite runs.
function makeBusiness(overrides: Partial<BusinessDetails> = {}): BusinessDetails {
  return {
    slug: 'unit-test-business',    name: 'Unit Test Shop',
    category: 'other',
    tagline: '',
    description: '',
    accentColor: '#000000',
    address: '',
    lat: 0,
    lng: 0,
    mapProvider: 'osm',
    phone: '',
    // Mon-Fri 09:00-13:00 and 14:00-18:00, Saturday 09:00-14:00, Sunday closed
    workingHours: [
      [],
      [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }],
      [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }],
      [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }],
      [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }],
      [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }],
      [{ start: '09:00', end: '14:00' }],
    ],
    bookingIntervalMinutes: 30,
    blockedDays: ['2030-03-22'], // a Friday
    blockedPeriods: [{ date: '2030-03-13', start: '12:00', end: '14:00' }], // Wednesday
    specialDays: {
      '2030-04-01': { kind: 'closed' }, // Monday
      '2030-04-02': { kind: 'hours', periods: [{ start: '10:00', end: '14:00' }] },
    },
    pause: null,
    prepayment: { mode: 'none' },
    paymentInstructions: { methods: [] },
    currency: 'ETB',
    bookingWindowDays: 30,
    telegramConnected: false,
    logo: null,
    coverPhoto: null,
    ...overrides,
  }
}

const MONDAY = '2030-03-04'

describe('periodsForDate', () => {
  const business = makeBusiness()

  it('returns weekly hours on a normal Monday', () => {
    expect(periodsForDate(business, MONDAY)).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ])
  })

  it('returns no periods on a blocked day', () => {
    expect(periodsForDate(business, '2030-03-22')).toEqual([])
  })

  it('returns custom periods on a special hours day', () => {
    expect(periodsForDate(business, '2030-04-02')).toEqual([
      { start: '10:00', end: '14:00' },
    ])
  })

  it('returns no periods on a special closed day', () => {
    expect(periodsForDate(business, '2030-04-01')).toEqual([])
  })

  it('returns no periods on Sunday', () => {
    expect(periodsForDate(business, '2030-03-10')).toEqual([])
  })
})

describe('computeAvailableTimes', () => {
  const business = makeBusiness()

  it('does not offer a slot that would run past closing time', () => {
    const times = computeAvailableTimes(business, MONDAY, 60)
    expect(times).not.toContain('12:30') // 12:30+60 = 13:30, past 13:00
    expect(times).toContain('12:00')
  })

  it('excludes times that overlap a business-level blocked period', () => {
    const times = computeAvailableTimes(business, '2030-03-13', 60)
    expect(times).not.toContain('12:00')
    expect(times).not.toContain('11:30')
    expect(times).toContain('11:00')
  })

  it('has no times on a blocked day', () => {
    expect(computeAvailableTimes(business, '2030-03-22', 60)).toEqual([])
  })

  it('only offers slots that fit the full duration', () => {
    const times = computeAvailableTimes(business, MONDAY, 120)
    expect(times).toContain('09:00')
    expect(times).not.toContain('12:00') // 12:00+120 = 14:00, past 13:00
  })

  it('offers no slots when the duration exceeds any period length', () => {
    expect(computeAvailableTimes(business, '2030-04-02', 300)).toEqual([])
  })
})

describe('mock data sanity', () => {
  it('businesses have unique slugs', () => {
    const slugs = [
      'addis-beauty-lounge',
      'marathon-auto-care',
      'riverside-dry-cleaning',
    ].map((slug) => slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('the primary demo business exists', () => {
    const page = getBusinessPage('addis-beauty-lounge')
    expect(page?.business.name).toBe('Addis Beauty Lounge')
    expect(page?.services.length).toBeGreaterThan(0)
  })
})