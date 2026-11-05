import { describe, expect, it } from 'vitest'
import { currentMalaysiaDate, effectiveStudentVerificationStatus, studentVerificationIsCurrent } from './student-verification.js'
import { publicListingWhere } from './approval.js'

describe('offer-letter student verification expiry', () => {
  const end = new Date('2028-06-30T00:00:00.000Z')
  const approved = { studentVerified: true, studentVerifiedUntil: end, verificationStatus: 'APPROVED' }

  it('remains active through the study-end date in Malaysia, then expires', () => {
    expect(currentMalaysiaDate(new Date('2028-06-30T15:59:59.999Z'))).toEqual(end)
    expect(studentVerificationIsCurrent(approved, new Date('2028-06-30T15:59:59.999Z'))).toBe(true)
    expect(studentVerificationIsCurrent(approved, new Date('2028-06-30T16:00:00.000Z'))).toBe(false)
    expect(effectiveStudentVerificationStatus(approved, new Date('2028-06-30T16:00:00.000Z'))).toBe('EXPIRED')
  })

  it('does not trust an old boolean without an approved end date', () => {
    expect(studentVerificationIsCurrent({ studentVerified: true, studentVerifiedUntil: null })).toBe(false)
  })

  it('filters public student listings by the same effective date', () => {
    const onNextLocalDay = new Date('2028-06-30T16:00:00.000Z')
    expect(publicListingWhere(onNextLocalDay)).toMatchObject({ owner: { OR: [
      {},
      { studentVerified: true, studentVerifiedUntil: { gte: new Date('2028-07-01T00:00:00.000Z') } },
    ] } })
  })
})
