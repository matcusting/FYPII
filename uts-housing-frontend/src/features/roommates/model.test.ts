import { describe, expect, it } from 'vitest'
import { matchOf, profileOf, profilePayload } from './model'

describe('roommate privacy boundary', () => {
  it('keeps optional candidate fields hidden unless the response marks them public', () => {
    const candidate = {
      userId: 'student-1', score: 85,
      profile: { displayName: 'Sam', bio: 'Private note', university: 'Private school', budgetMin: 300, moveInDate: '2026-11-01' },
    }
    expect(matchOf(candidate)).toMatchObject({ id: 'student-1', score: 85, bio: '', university: '', moveInDate: '' })
    expect(matchOf(candidate)?.budgetMin).toBeUndefined()
    expect(matchOf({ ...candidate, publicProfile: { displayName: 'Sam', bio: 'Public note' } })?.bio).toBe('Public note')
  })

  it('does not invent a score when the server reports insufficient data', () => {
    expect(matchOf({ id: 'student-2', score: null, explanation: 'Not enough answers to calculate a score' })?.score).toBeUndefined()
  })
})

describe('profile defaults', () => {
  it('starts discovery and all optional visibility controls disabled', () => {
    const profile = profileOf(null)
    expect(profile.discoverable).toBe(false)
    expect(Object.values(profile.visibility).every(value => value === false)).toBe(true)
    expect(profilePayload(profile).budgetMin).toBeNull()
  })
})
