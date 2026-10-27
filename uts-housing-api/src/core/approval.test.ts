import { afterEach, describe, expect, it } from 'vitest'
import { approvalExpiresAt, approvalIsCurrent, effectiveApprovalStatus } from './approval.js'

afterEach(() => {
  delete process.env.LANDLORD_IDENTITY_VALID_DAYS
  delete process.env.PROPERTY_AUTHORIZATION_VALID_DAYS
})

describe('approval lifecycle', () => {
  const now = new Date('2026-10-27T10:00:00.000Z')

  it('requires an unexpired approval and presents an expired status', () => {
    expect(approvalIsCurrent({ status: 'APPROVED', expiresAt: new Date('2026-10-28T00:00:00Z') }, now)).toBe(true)
    expect(approvalIsCurrent({ status: 'APPROVED', expiresAt: new Date('2026-10-27T00:00:00Z') }, now)).toBe(false)
    expect(approvalIsCurrent({ status: 'APPROVED', expiresAt: null }, now)).toBe(false)
    expect(effectiveApprovalStatus({ status: 'APPROVED', expiresAt: new Date('2026-10-27T00:00:00Z') }, now)).toBe('EXPIRED')
    expect(effectiveApprovalStatus({ status: 'REVOKED', expiresAt: null }, now)).toBe('REVOKED')
  })

  it('caps reviewer-selected expiry by configured lifetime', () => {
    process.env.PROPERTY_AUTHORIZATION_VALID_DAYS = '30'
    expect(approvalExpiresAt('property', now)?.toISOString()).toBe('2026-11-26T10:00:00.000Z')
    expect(approvalExpiresAt('property', now, '2026-11-15')?.toISOString()).toBe('2026-11-15T15:59:59.999Z')
    expect(approvalExpiresAt('property', now, '2026-11-27')).toBeNull()
    expect(approvalExpiresAt('property', now, '2026-02-30')).toBeNull()
  })
})
