import { describe, expect, it } from 'vitest'
import { firstOverlap, periodsOverlap } from '@/lib/periods'

describe('periodsOverlap', () => {
  it('detects genuine overlaps', () => {
    expect(periodsOverlap({ start: '09:00', end: '12:00' }, { start: '10:00', end: '14:00' })).toBe(true)
    expect(periodsOverlap({ start: '09:00', end: '12:00' }, { start: '08:00', end: '10:00' })).toBe(true)
    expect(periodsOverlap({ start: '09:00', end: '12:00' }, { start: '11:30', end: '13:30' })).toBe(true)
  })

  it('treats touching edges (end === start) as disjoint', () => {
    expect(periodsOverlap({ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' })).toBe(false)
    expect(periodsOverlap({ start: '10:00', end: '11:00' }, { start: '09:00', end: '10:00' })).toBe(false)
  })

  it('returns false for clearly separated periods', () => {
    expect(periodsOverlap({ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' })).toBe(false)
  })

  it('handles a period fully inside another as overlapping', () => {
    expect(periodsOverlap({ start: '09:00', end: '18:00' }, { start: '10:00', end: '11:00' })).toBe(true)
  })
})

describe('firstOverlap', () => {
  it('returns the first overlapping pair', () => {
    const pair = firstOverlap([
      { start: '09:00', end: '13:00' },
      { start: '11:00', end: '14:00' },
      { start: '14:00', end: '18:00' },
    ])
    expect(pair).toEqual({
      a: { start: '09:00', end: '13:00' },
      b: { start: '11:00', end: '14:00' },
    })
  })

  it('returns null when every period is disjoint', () => {
    expect(
      firstOverlap([
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ]),
    ).toBeNull()
  })

  it('returns null for empty or single-period lists', () => {
    expect(firstOverlap([])).toBeNull()
    expect(firstOverlap([{ start: '09:00', end: '17:00' }])).toBeNull()
  })
})