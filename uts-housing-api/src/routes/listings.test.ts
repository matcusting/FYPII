import type { User } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../core/db.js', () => ({ prisma: {} }))

import { canViewExactLocation, distanceAnchor, haversineKm, serializeListing } from './listings.js'

describe('listing location privacy', () => {
  const student = { id: 'student', roles: ['STUDENT'] as const }
  const landlord = { id: 'other-landlord', roles: ['LANDLORD'] as const }
  const owner = { id: 'owner', roles: ['LANDLORD'] as const }
  const admin = { id: 'admin', roles: ['ADMIN'] as const }

  it('requires owner consent and a signed-in student for the exact public pin', () => {
    expect(canViewExactLocation('owner', false, null)).toBe(false)
    expect(canViewExactLocation('owner', true, null)).toBe(false)
    expect(canViewExactLocation('owner', false, { ...student, roles: [...student.roles] })).toBe(false)
    expect(canViewExactLocation('owner', true, { ...student, roles: [...student.roles] })).toBe(true)
    expect(canViewExactLocation('owner', true, { ...landlord, roles: [...landlord.roles] })).toBe(false)
    expect(canViewExactLocation('owner', false, { ...owner, roles: [...owner.roles] })).toBe(true)
    expect(canViewExactLocation('owner', false, { ...admin, roles: [...admin.roles] })).toBe(true)
  })

  it('uses one coarse cell for nearby hidden pins so distance queries cannot recover them', () => {
    const first = distanceAnchor(2.286, 111.835, false)
    const second = distanceAnchor(2.287, 111.834, false)
    expect(first).toEqual(second)
    expect(haversineKm(first.latitude, first.longitude, 2.3, 111.84)).toBe(haversineKm(second.latitude, second.longitude, 2.3, 111.84))
    expect(distanceAnchor(2.286, 111.835, true)).toEqual({ latitude: 2.286, longitude: 111.835 })
  })

  it('redacts the stored address and pin in listing responses until consent and student sign-in', () => {
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
      expect(hidden.latitude).toBeUndefined()
      expect(hidden.longitude).toBeUndefined()
      expect(hidden.address).toBeUndefined()
      expect(hidden.showExactLocation).toBe(false)
    }
    expect(detail('owner')).toMatchObject({ latitude: 2.286, longitude: 111.835, address: 'Private street address' })
    record.showExactLocation = true
    expect(detail('student')).toMatchObject({ latitude: 2.286, longitude: 111.835, address: 'Private street address' })
    expect(detail('other-landlord').address).toBeUndefined()
    expect(detail().latitude).toBeUndefined()
  })
})
