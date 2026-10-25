import type { User } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../core/db.js', () => ({ prisma: {} }))

import { canViewExactLocation, listingInput, serializeListing } from './listings.js'

describe('listing location privacy', () => {
  const student = { id: 'student', roles: ['STUDENT'] as const }
  const landlord = { id: 'other-landlord', roles: ['LANDLORD'] as const }
  const owner = { id: 'owner', roles: ['LANDLORD'] as const }
  const admin = { id: 'admin', roles: ['ADMIN'] as const }

  it('requires owner consent and a signed-in student for the full address', () => {
    expect(canViewExactLocation('owner', false, null)).toBe(false)
    expect(canViewExactLocation('owner', true, null)).toBe(false)
    expect(canViewExactLocation('owner', false, { ...student, roles: [...student.roles] })).toBe(false)
    expect(canViewExactLocation('owner', true, { ...student, roles: [...student.roles] })).toBe(true)
    expect(canViewExactLocation('owner', true, { ...landlord, roles: [...landlord.roles] })).toBe(false)
    expect(canViewExactLocation('owner', false, { ...owner, roles: [...owner.roles] })).toBe(true)
    expect(canViewExactLocation('owner', false, { ...admin, roles: [...admin.roles] })).toBe(true)
  })

  it('redacts the full address until consent and student sign-in, and never exposes legacy coordinates', () => {
    const record = {
      id: 'property', ownerId: 'owner', status: 'PUBLISHED', showExactLocation: false,
      title: 'Property near UTS', rent: 650, deposit: 650, latitude: 2.286, longitude: 111.835,
      address: 'Private street address', moderationReason: null,
      campus: { id: 'campus', name: 'UTS', university: 'UTS', latitude: 2.3, longitude: 111.84 },
      owner: { id: 'owner', name: 'Owner' }, photos: [], amenities: [], reviews: [],
      availableFrom: new Date('2026-11-01T00:00:00.000Z'), lastConfirmedAt: null,
      createdAt: new Date('2026-10-21T00:00:00.000Z'), updatedAt: new Date('2026-10-21T00:00:00.000Z'),
    }
    const detail = (userId?: string) => serializeListing(record as unknown as Parameters<typeof serializeListing>[0], userId ? { id: userId, roles: userId === 'student' ? ['STUDENT'] : ['LANDLORD'] } as User : null)
    for (const viewer of [undefined, 'student', 'other-landlord']) {
      const hidden = detail(viewer)
      expect('latitude' in hidden).toBe(false)
      expect('longitude' in hidden).toBe(false)
      expect('distanceKm' in hidden).toBe(false)
      expect(hidden.address).toBeUndefined()
      expect(hidden.showExactLocation).toBe(false)
    }
    expect(detail('owner').address).toBe('Private street address')
    expect('latitude' in detail('owner')).toBe(false)
    expect('longitude' in detail('owner')).toBe(false)
    record.showExactLocation = true
    expect(detail('student').address).toBe('Private street address')
    expect('latitude' in detail('student')).toBe(false)
    expect('longitude' in detail('student')).toBe(false)
    expect(detail('other-landlord').address).toBeUndefined()
    expect('latitude' in detail()).toBe(false)
  })

  it('requires a full written address when a landlord creates a listing', () => {
    const draft = {
      title: 'Room near campus', description: 'Furnished room in a shared home near campus.', campusId: 'campus',
      propertyType: 'HOUSE', roomType: 'SINGLE', rent: '650.00', deposit: '650.00',
      availableFrom: '2026-11-01', approximateArea: 'Sibu Jaya',
    }
    expect(listingInput.safeParse({ ...draft, address: 'No. 12, Jalan Example, Sibu' }).success).toBe(true)
    expect(listingInput.safeParse({ ...draft, address: 'Sibu' }).success).toBe(false)
    expect(listingInput.safeParse(draft).success).toBe(false)
  })
})
