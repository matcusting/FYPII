import { describe, expect, it } from 'vitest'
import { addUtcCalendarYears, parseUtcDateOnly, utcDayAfter } from './retention-dates.js'

describe('verification evidence retention dates', () => {
  it('uses calendar years and clamps leap day to February 28', () => {
    expect(addUtcCalendarYears(new Date('2024-02-29T15:59:59.999Z'), 1).toISOString()).toBe('2025-02-28T15:59:59.999Z')
    expect(addUtcCalendarYears(new Date('2024-02-29T00:00:00.000Z'), 2).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(addUtcCalendarYears(new Date('2024-02-29T00:00:00.000Z'), 4).toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('keeps an offer-letter end date as a real UTC calendar date through its anniversary', () => {
    const studyEnd = parseUtcDateOnly('2025-06-30')
    expect(studyEnd?.toISOString()).toBe('2025-06-30T00:00:00.000Z')
    expect(utcDayAfter(addUtcCalendarYears(studyEnd!, 1)).toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(parseUtcDateOnly('2026-02-30')).toBeNull()
  })
})
