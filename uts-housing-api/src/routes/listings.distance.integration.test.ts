import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Supply TEST_DATABASE_URL for a migrated, disposable PostgreSQL database.
describe.skipIf(!process.env.TEST_DATABASE_URL)('campus distance search and landlord rating', () => {
  let server: Server
  let base = ''
  let prisma: typeof import('../core/db.js').prisma
  const campusId = randomUUID()
  const ownerId = randomUUID()
  const authorId = randomUUID()
  const nearId = randomUUID()
  const farId = randomUUID()

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    const [appModule, dbModule] = await Promise.all([import('../app.js'), import('../core/db.js')])
    prisma = dbModule.prisma
    await prisma.campus.create({ data: { id: campusId, name: 'Synthetic Distance Campus', university: 'Synthetic University', latitude: 2.322, longitude: 111.839 } })
    await prisma.user.createMany({ data: [
      { id: ownerId, name: 'Synthetic Owner', email: `distance-owner-${ownerId}@demo.local`, passwordHash: 'test', roles: ['LANDLORD'], emailVerifiedAt: new Date() },
      { id: authorId, name: 'Synthetic Reviewer', email: `distance-reviewer-${authorId}@demo.local`, passwordHash: 'test', roles: ['STUDENT'], emailVerifiedAt: new Date(), studentVerified: true },
    ] })
    await prisma.landlordVerification.create({ data: { userId: ownerId, kind: 'INDIVIDUAL', status: 'APPROVED', expiresAt: new Date(Date.now() + 86_400_000) } })
    for (const [id, latitude, title] of [[nearId, 2.322, 'Near synthetic home'], [farId, 2.422, 'Far synthetic home']] as const) {
      const address = `${id} Synthetic Road, Sibu, Sarawak 96000`
      await prisma.listing.create({ data: { id, ownerId, campusId, title, description: 'A fictional listing for automated distance and rating checks.', propertyType: 'HOUSE', roomType: 'SINGLE', rent: 500, deposit: 500, availableFrom: new Date('2026-11-01'), approximateArea: 'Synthetic Area', address, latitude, longitude: 111.839, status: 'PUBLISHED', showExactLocation: false } })
      await prisma.propertyAuthorization.create({ data: { listingId: id, requesterId: ownerId, kind: 'OWNER', addressSnapshot: address, status: 'APPROVED', expiresAt: new Date(Date.now() + 86_400_000) } })
    }
    await prisma.review.createMany({ data: [
      { listingId: nearId, landlordId: ownerId, authorId, rating: 5, body: 'Synthetic review of the nearby house.', experienceDescription: 'Synthetic rental experience.', status: 'APPROVED' },
      { listingId: farId, landlordId: ownerId, authorId, rating: 4, body: 'Synthetic review of the farther house.', experienceDescription: 'Synthetic rental experience.', status: 'APPROVED' },
    ] })
    server = await new Promise<Server>(resolve => { const started = appModule.app.listen(0, '127.0.0.1', () => resolve(started)) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server failed to bind.')
    base = `http://127.0.0.1:${address.port}/api/v1`
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (prisma) {
      await prisma.review.deleteMany({ where: { landlordId: ownerId } })
      await prisma.listing.deleteMany({ where: { id: { in: [nearId, farId] } } })
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, authorId] } } })
      await prisma.campus.deleteMany({ where: { id: campusId } })
      await prisma.$disconnect()
    }
  })

  it('filters and sorts by campus distance while keeping the precise location private', async () => {
    const search = async (suffix: string) => {
      const response = await fetch(`${base}/listings?campusId=${campusId}${suffix}`)
      expect(response.status).toBe(200)
      return (await response.json() as { data: { items: Array<Record<string, unknown>>; total: number } }).data
    }
    const nearby = await search('&maxDistanceKm=5')
    expect(nearby.total).toBe(1)
    expect(nearby.items[0]?.id).toBe(nearId)
    expect(nearby.items[0]?.distanceKm).toBe(0)
    expect(nearby.items[0]).not.toHaveProperty('latitude')
    expect(nearby.items[0]).not.toHaveProperty('longitude')
    expect(nearby.items[0]).not.toHaveProperty('address')
    const sorted = await search('&sort=distance')
    expect(sorted.items.map(item => item.id)).toEqual([nearId, farId])
    expect(sorted.items[1]?.distanceKm).toBeGreaterThan(11)
    const detail = await fetch(`${base}/listings/${nearId}`)
    expect(detail.status).toBe(200)
    const body = await detail.json() as { data: { landlordRating: number; landlordReviewCount: number } }
    expect(body.data.landlordRating).toBe(4.5)
    expect(body.data.landlordReviewCount).toBe(2)
  })
})
