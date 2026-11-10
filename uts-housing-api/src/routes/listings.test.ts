import type { User } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'

const database = vi.hoisted(() => ({
  listing: { count: vi.fn(), findMany: vi.fn() },
}))
vi.mock('../core/db.js', () => ({ prisma: database }))

import router, { canViewExactLocation, listingInput, listingPatch, serializeListing } from './listings.js'

function search(query: Record<string, string>) {
  const url = `/listings?${new URLSearchParams(query)}`
  const request = { method: 'GET', url, originalUrl: url, query } as unknown as Request
  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    let statusCode = 200
    const responseMethods = {
      status(code: number) { statusCode = code; return responseMethods },
      json(data: Record<string, unknown>) { resolve({ status: statusCode, data }); return responseMethods },
    }
    router(request, responseMethods as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}

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
      id: 'property', ownerId: 'owner', status: 'PUBLISHED', showExactLocation: false, genderPreference: 'FEMALE',
      title: 'Property near UTS', rent: 650, deposit: 650, latitude: 2.286, longitude: 111.835, distanceKm: 2.1,
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
      expect(hidden.distanceKm).toBe(2.1)
      expect(hidden.genderPreference).toBe('FEMALE')
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
    const valid = listingInput.safeParse({ ...draft, address: 'No. 12, Jalan Example, Sibu' })
    expect(valid.success).toBe(true)
    if (valid.success) expect(valid.data.genderPreference).toBe('ALL')
    expect(listingInput.safeParse({ ...draft, address: 'No. 12, Jalan Example, Sibu', genderPreference: 'MALE' }).success).toBe(true)
    expect(listingInput.safeParse({ ...draft, address: 'No. 12, Jalan Example, Sibu', genderPreference: 'UNKNOWN' }).success).toBe(false)
    expect(listingInput.safeParse({ ...draft, address: 'Sibu' }).success).toBe(false)
    expect(listingInput.safeParse(draft).success).toBe(false)
  })

  it('does not reset rental policy or other defaults on an unrelated patch', () => {
    expect(listingPatch.parse({ title: 'An updated room title' })).toEqual({ title: 'An updated room title' })
    expect(listingPatch.parse({ genderPreference: 'FEMALE' })).toEqual({ genderPreference: 'FEMALE' })
    expect(listingPatch.safeParse({ genderPreference: 'UNKNOWN' }).success).toBe(false)
  })
})

describe('listing gender preference search', () => {
  it('filters exactly by the requested rental policy', async () => {
    database.listing.count.mockReset().mockResolvedValue(0)
    database.listing.findMany.mockReset().mockResolvedValue([])
    const result = await search({ genderPreference: 'MALE' })
    expect(result.status).toBe(200)
    expect(database.listing.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ genderPreference: 'MALE' }]) }),
    }))
  })

  it('rejects an unsupported rental policy', async () => {
    database.listing.count.mockReset()
    database.listing.findMany.mockReset()
    const result = await search({ genderPreference: 'UNKNOWN' })
    expect(result.status).toBe(400)
    expect(database.listing.count).not.toHaveBeenCalled()
  })
})
