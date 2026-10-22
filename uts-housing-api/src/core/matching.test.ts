import { describe, expect, it } from 'vitest'
import { evaluateMatch, type MatchingProfile } from './matching.js'

const complete: MatchingProfile = {
  preferredLocation: 'Sibu Jaya', budgetMin: 500, budgetMax: 900,
  moveInDate: '2026-11-01', visibility: { lifestyle: true },
  lifestyle: {
    smoking: 'NEVER', studySchedule: 'EVENING', sleepSchedule: 'LATE', cleanliness: 'HIGH',
    noise: 'QUIET', guests: 'RARE', pets: 'NO_PETS',
  },
  roommatePreferences: {
    smoking: 'NEVER', studySchedule: 'EVENING', sleepSchedule: 'LATE', cleanliness: 'HIGH',
    noise: 'QUIET', guests: 'RARE', pets: 'NO_PETS',
  },
}

describe('roommate compatibility', () => {
  it('scores aligned, opted-in lifestyles and explains only visible shared habits', () => {
    const result = evaluateMatch(complete, complete)
    expect(result.eligible).toBe(true)
    expect(result.score).toBe(100)
    expect(result.factors.length).toBeGreaterThan(0)
    expect(result.factors[0]).toMatch(/similar/)
  })

  it('does not invent a percentage from too few answers', () => {
    const sparse = { lifestyle: { smoking: 'NEVER', cleanliness: 'HIGH' } }
    const result = evaluateMatch(sparse, sparse)
    expect(result).toMatchObject({ eligible: true, score: null, factors: [] })
    expect(result.explanation).toMatch(/not enough/i)
  })

  it('normalizes only answered dimensions and honors importance weights', () => {
    const partial = {
      lifestyle: { smoking: 'NEVER', cleanliness: 'HIGH', noise: 'QUIET' },
      roommatePreferences: { smoking: 'NEVER', cleanliness: 'HIGH', noise: 'QUIET' },
    }
    const candidate = {
      lifestyle: { smoking: 'REGULAR', cleanliness: 'HIGH', noise: 'QUIET' },
      roommatePreferences: { smoking: 'NEVER', cleanliness: 'HIGH', noise: 'QUIET' },
    }
    const normal = evaluateMatch(partial, candidate)
    const weighted = evaluateMatch({ ...partial, importanceWeights: { smoking: 5 } }, candidate)
    expect(normal.score).not.toBeNull()
    expect(weighted.score).toBeLessThan(normal.score!)
    expect(evaluateMatch(partial, partial).score).toBe(100)
  })

  it('excludes hard smoking and pet conflicts, non-overlapping budgets and distant move-ins', () => {
    expect(evaluateMatch({ ...complete, smokeFreeOnly: true }, { ...complete, lifestyle: { ...complete.lifestyle as object, smoking: 'REGULAR' } }).eligible).toBe(false)
    expect(evaluateMatch({ ...complete, petFreeOnly: true }, { ...complete, lifestyle: { ...complete.lifestyle as object, pets: 'HAS_PETS' } }).eligible).toBe(false)
    expect(evaluateMatch(complete, { ...complete, budgetMin: 1000, budgetMax: 1500 }).eligible).toBe(false)
    expect(evaluateMatch(complete, { ...complete, moveInDate: '2027-02-01' }).eligible).toBe(false)
    expect(evaluateMatch(complete, { ...complete, preferredLocation: 'Kuching' }).eligible).toBe(false)
  })

  it('keeps private lifestyle answers out of explanation factors', () => {
    const result = evaluateMatch(complete, { ...complete, visibility: { lifestyle: false } })
    expect(result.eligible).toBe(true)
    expect(result.factors.every(factor => !/smoking|cleanliness|schedule|noise|guest|pet/i.test(factor))).toBe(true)
  })
})
