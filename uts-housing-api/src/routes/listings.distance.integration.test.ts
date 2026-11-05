import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
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
      { id: authorId, name: 'Synthetic Reviewer', email: `distance-reviewer-${authorId}@demo.local`, passwordHash: 'test', roles: ['STUDENT'], emailVerifiedAt: new Date(), studentVerified: true, studentVerifiedUntil: new Date('2099-12-31') },
    ] })
    await prisma.landlordVerification.create({ data: { userId: ownerId, kind: 'INDIVIDUAL', status: 'APPROVED', expiresAt: new Date(Date.now() + 86_400_000) } })
    for (const [id, latitude, title] of [[nearId, 2.322, 'Near synthetic home'], [farId, 2.422, 'Far synthetic home']] as const) {
      const address = `${id} Synthetic Road, Sibu, Sarawak 96000`
      await prisma.listing.create({ data: { id, ownerId, campusId, title, description: 'A fictional listing for automated distance and rating checks.', propertyType: 'HOUSE', roomType: 'SINGLE', rent: 500, deposit: 500, availableFrom: new Date('2026-11-01'), approximateArea: 'Synthetic Area', address, latitude, longitude: 111.839, status: 'PUBLISHED', showExactLocation: false, lastConfirmedAt: id === nearId ? new Date() : new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } })
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
    const confirmed = await search('&recentlyConfirmed=true')
    expect(confirmed.items.map(item => item.id)).toEqual([nearId])
    expect(confirmed.items[0]?.availabilityStale).toBe(false)
    const invalidConfirmation = await fetch(`${base}/listings?recentlyConfirmed=maybe`)
    expect(invalidConfirmation.status).toBe(400)
    const detail = await fetch(`${base}/listings/${nearId}`)
    expect(detail.status).toBe(200)
    const body = await detail.json() as { data: { landlordRating: number; landlordReviewCount: number } }
    expect(body.data.landlordRating).toBe(4.5)
    expect(body.data.landlordReviewCount).toBe(2)
  })

  it('lets only the owner retry an unmatched address without exposing its coordinates', async () => {
    const id = randomUUID()
    const address = `${id} Fictional Street, 96000 Sibu, Sarawak`
    const token = randomBytes(32).toString('hex')
    const { tokenHash } = await import('../core/auth.js')
    await prisma.session.create({ data: { userId: ownerId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60_000) } })
    await prisma.listing.create({ data: { id, ownerId, campusId, title: 'Unmatched synthetic home', description: 'A fictional listing used to verify private address lookup retry.', propertyType: 'HOUSE', roomType: 'SINGLE', rent: 500, deposit: 500, availableFrom: new Date('2026-11-01'), approximateArea: 'Synthetic Area', address, status: 'DRAFT' } })
    const previousEndpoint = process.env.GEOCODER_URL
    const lookup = createServer((req, res) => {
      const query = new URL(req.url || '/', 'http://localhost').searchParams.get('q') || ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(query.includes(address) ? [{ lat: '2.323', lon: '111.84', addresstype: 'building' }] : []))
    })
    await new Promise<void>(resolve => lookup.listen(0, '127.0.0.1', resolve))
    const bound = lookup.address()
    if (!bound || typeof bound === 'string') throw new Error('Mock geocoder failed to bind.')
    process.env.GEOCODER_URL = `http://127.0.0.1:${bound.port}/search`
    try {
      const path = `${base}/listings/${id}/location/refresh`
      expect((await fetch(path, { method: 'POST' })).status).toBe(401)
      const response = await fetch(path, { method: 'POST', headers: { cookie: `housing_session=${token}`, origin: 'http://localhost:5173' } })
      expect(response.status).toBe(200)
      const body = await response.json() as { data: Record<string, unknown> }
      expect(body.data.distanceKm).toBeGreaterThan(0)
      expect(body.data.address).toBe(address)
      expect(body.data).not.toHaveProperty('latitude')
      expect(body.data).not.toHaveProperty('longitude')
      const point = await prisma.listing.findUniqueOrThrow({ where: { id } })
      expect(point.latitude).toBe(2.323)
      expect(point.longitude).toBe(111.84)
      expect(point.status).toBe('DRAFT')
    } finally {
      if (previousEndpoint === undefined) delete process.env.GEOCODER_URL
      else process.env.GEOCODER_URL = previousEndpoint
      await new Promise<void>(resolve => lookup.close(() => resolve()))
      await prisma.listing.delete({ where: { id } })
    }
  })
})
