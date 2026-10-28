import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Run against a migrated disposable PostgreSQL database with synthetic documents.
describe.skipIf(!process.env.TEST_DATABASE_URL)('landlord and property authorization integration', () => {
  let server: Server
  let base = ''
  let privateDir = ''
  let prisma: typeof import('../core/db.js').prisma
  const campusId = randomUUID()
  const landlordId = randomUUID()
  const adminId = randomUUID()
  const studentId = randomUUID()
  const listingId = randomUUID()
  const landlordEmail = `landlord-${landlordId}@example.test`
  const adminEmail = `reviewer-${adminId}@example.test`
  const studentEmail = `student-${studentId}@example.test`
  const address = '123 Synthetic Test Lane, Sibu, Sarawak 96000'
  const cookies: Record<'landlord' | 'admin' | 'student', string> = { landlord: '', admin: '', student: '' }
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11])
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_SECRET = 'local-landlord-test-secret-123456789'
    privateDir = await mkdtemp(join(tmpdir(), 'housing-landlord-integration-'))
    process.env.MEDIA_PRIVATE_DIR = privateDir
    const [appModule, dbModule, authModule] = await Promise.all([
      import('../app.js'), import('../core/db.js'), import('../core/auth.js'),
    ])
    prisma = dbModule.prisma
    await prisma.campus.create({ data: { id: campusId, name: 'Synthetic Review Campus', university: 'Synthetic University', latitude: 2.322, longitude: 111.839 } })
    await prisma.user.createMany({ data: [
      { id: landlordId, name: 'Synthetic Landlord', email: landlordEmail, passwordHash: 'test-only', roles: ['LANDLORD'], emailVerifiedAt: new Date() },
      { id: adminId, name: 'Synthetic Reviewer', email: adminEmail, passwordHash: 'test-only', roles: ['ADMIN'], emailVerifiedAt: new Date() },
      { id: studentId, name: 'Synthetic Student', email: studentEmail, passwordHash: 'test-only', roles: ['STUDENT'], emailVerifiedAt: new Date(), studentVerified: true, verificationStatus: 'APPROVED' },
    ] })
    await prisma.profile.create({ data: { userId: landlordId, displayName: 'Synthetic Landlord', phone: '+60 12-345 6789' } })
    await prisma.listing.create({ data: {
      id: listingId, ownerId: landlordId, campusId, title: 'Synthetic two-bedroom house',
      description: 'A synthetic property listing used only for verification testing.', propertyType: 'HOUSE', roomType: 'SINGLE',
      rent: '550.00', deposit: '550.00', availableFrom: new Date('2027-01-01T00:00:00.000Z'), approximateArea: 'Sibu test district',
      address, status: 'DRAFT', photos: { create: { storageKey: randomUUID(), mimeType: 'image/jpeg' } },
    } })
    for (const [role, userId] of [['landlord', landlordId], ['admin', adminId], ['student', studentId]] as const) {
      const token = randomBytes(32).toString('hex')
      await prisma.session.create({ data: { userId, tokenHash: authModule.tokenHash(token), expiresAt: new Date(Date.now() + 60_000) } })
      cookies[role] = `housing_session=${token}`
    }
    server = await new Promise<Server>(resolve => {
      const started = appModule.app.listen(0, '127.0.0.1', () => resolve(started))
    })
    const bound = server.address()
    if (!bound || typeof bound === 'string') throw new Error('Test server failed to bind.')
    base = `http://127.0.0.1:${bound.port}/api/v1`
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
      await prisma.emailJob.deleteMany({ where: { to: { in: [landlordEmail, adminEmail, studentEmail] } } })
      await prisma.notification.deleteMany({ where: { userId: landlordId } })
      await prisma.deletionRequest.deleteMany({ where: { userId: landlordId } })
      await prisma.listing.deleteMany({ where: { id: listingId } })
      await prisma.user.deleteMany({ where: { id: { in: [landlordId, adminId, studentId] } } })
      await prisma.campus.deleteMany({ where: { id: campusId } })
      await prisma.$disconnect()
    }
    if (privateDir) await rm(privateDir, { recursive: true, force: true })
    delete process.env.MEDIA_PRIVATE_DIR
  })

  function request(path: string, role: 'landlord' | 'admin' | 'student' | 'guest', method = 'GET', body?: BodyInit) {
    return fetch(base + path, { method, headers: {
      Origin: 'http://localhost:5173',
      ...(role === 'guest' ? {} : { Cookie: cookies[role] }),
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    }, body })
  }

  function identityForm() {
    const body = new FormData()
    body.set('kind', 'INDIVIDUAL')
    body.set('identity', new Blob([jpeg], { type: 'image/jpeg' }), 'synthetic-id.jpg')
    return body
  }

  function propertyForm() {
    const body = new FormData()
    body.set('kind', 'OWNER')
    body.set('proof', new Blob([pdf], { type: 'application/pdf' }), 'synthetic-ownership.pdf')
    return body
  }

  async function code(response: Response) {
    const body = await response.json() as { error?: { code?: string } }
    return body.error?.code
  }

  it('requires independent identity and property approval, protects documents and removes them on account deletion', async () => {
    const submittedIdentity = await request('/landlord-verifications/identity', 'landlord', 'POST', identityForm())
    expect(submittedIdentity.status).toBe(201)
    const identityId = (await prisma.landlordVerification.findFirstOrThrow({ where: { userId: landlordId } })).id
    expect((await request(`/admin/landlord-verifications/${identityId}/identity`, 'guest')).status).toBe(401)
    expect((await request(`/admin/landlord-verifications/${identityId}/identity`, 'landlord')).status).toBe(403)
    const identityDocument = await request(`/admin/landlord-verifications/${identityId}/identity`, 'admin')
    expect(identityDocument.status).toBe(200)
    expect(identityDocument.headers.get('cache-control')).toContain('no-store')
    expect(Buffer.from(await identityDocument.arrayBuffer())).toEqual(jpeg)
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(403)

    // The generic listing status endpoint must not let an administrator skip
    // identity and property review by republishing a paused listing directly.
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'PAUSED' } })
    const directPublish = await request(`/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))
    expect(directPublish.status).toBe(404)
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('PAUSED')
    const migratedListingRepublish = await request(`/admin/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))
    expect(await code(migratedListingRepublish)).toBe('IDENTITY_REQUIRED')
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('PAUSED')
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'DRAFT' } })

    await prisma.listing.update({ where: { id: listingId }, data: { status: 'PENDING_REVIEW' } })
    const publishWithoutIdentity = await request(`/admin/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))
    expect(await code(publishWithoutIdentity)).toBe('IDENTITY_REQUIRED')
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'DRAFT' } })

    const identityDecision = await request(`/admin/landlord-verifications/${identityId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED' }))
    expect(identityDecision.status).toBe(200)
    expect((await prisma.landlordVerification.findUniqueOrThrow({ where: { id: identityId } })).expiresAt!.getTime()).toBeGreaterThan(Date.now())
    const agentWithoutOwnerConsent = new FormData()
    agentWithoutOwnerConsent.set('kind', 'AGENT')
    agentWithoutOwnerConsent.set('proof', new Blob([pdf], { type: 'application/pdf' }), 'synthetic-ownership.pdf')
    expect((await request(`/landlord-verifications/listings/${listingId}`, 'landlord', 'POST', agentWithoutOwnerConsent)).status).toBe(400)
    const submittedProperty = await request(`/landlord-verifications/listings/${listingId}`, 'landlord', 'POST', propertyForm())
    expect(submittedProperty.status).toBe(201)
    const propertyId = (await prisma.propertyAuthorization.findFirstOrThrow({ where: { listingId } })).id

    // Verify that both kinds of landlord evidence survive an API restart.
    await new Promise<void>(resolve => server.close(() => resolve()))
    const { app } = await import('../app.js')
    server = await new Promise<Server>(resolve => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started))
    })
    const restartedAddress = server.address()
    if (!restartedAddress || typeof restartedAddress === 'string') throw new Error('Test server failed to restart.')
    base = `http://127.0.0.1:${restartedAddress.port}/api/v1`
    const persistedIdentity = await request(`/admin/landlord-verifications/${identityId}/identity`, 'admin')
    expect(persistedIdentity.status).toBe(200)
    expect(Buffer.from(await persistedIdentity.arrayBuffer())).toEqual(jpeg)

    expect((await request(`/admin/property-authorizations/${propertyId}/proof`, 'landlord')).status).toBe(403)
    const propertyDocument = await request(`/admin/property-authorizations/${propertyId}/proof`, 'admin')
    expect(propertyDocument.status).toBe(200)
    expect(Buffer.from(await propertyDocument.arrayBuffer())).toEqual(pdf)
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(403)

    await prisma.listing.update({ where: { id: listingId }, data: { status: 'PENDING_REVIEW' } })
    const publishWithoutAuthority = await request(`/admin/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))
    expect(await code(publishWithoutAuthority)).toBe('AUTHORIZATION_REQUIRED')
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'DRAFT' } })

    const propertyDecision = await request(`/admin/property-authorizations/${propertyId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED' }))
    expect(propertyDecision.status).toBe(200)
    expect((await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: propertyId } })).expiresAt!.getTime()).toBeGreaterThan(Date.now())
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(200)
    const published = await request(`/admin/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))
    expect(published.status).toBe(200)
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('PUBLISHED')

    // Returning to an old address must not revive its old approved proof.
    const otherAddress = '456 Different Synthetic Lane, Sibu, Sarawak 96000'
    expect((await request(`/listings/${listingId}`, 'landlord', 'PATCH', JSON.stringify({ address: otherAddress }))).status).toBe(200)
    expect((await request(`/listings/${listingId}`, 'landlord', 'PATCH', JSON.stringify({ address }))).status).toBe(200)
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(403)
    expect((await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: propertyId } })).status).toBe('REJECTED')

    // A fresh review restores publication, but an expired approval must hide
    // the property immediately even if the expiry worker has not run.
    expect((await request(`/landlord-verifications/listings/${listingId}`, 'landlord', 'POST', propertyForm())).status).toBe(201)
    const renewalId = (await prisma.propertyAuthorization.findFirstOrThrow({ where: { listingId }, orderBy: { createdAt: 'desc' } })).id
    expect((await request(`/admin/property-authorizations/${renewalId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED' }))).status).toBe(200)
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(200)
    expect((await request(`/admin/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))).status).toBe(200)
    const future = (await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: renewalId } })).expiresAt!
    await prisma.propertyAuthorization.update({ where: { id: renewalId }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    expect((await request(`/listings/${listingId}`, 'guest')).status).toBe(404)
    expect((await request('/favorites', 'student', 'POST', JSON.stringify({ listingId }))).status).toBe(404)
    const favoritesAfterExpiry = await request('/favorites', 'student')
    expect(((await favoritesAfterExpiry.json()) as { data: { items: unknown[] } }).data.items).toHaveLength(0)
    expect((await request(`/listings/${listingId}/inquiries`, 'student', 'POST', JSON.stringify({ message: 'Is this test room still available?' }))).status).toBe(404)
    expect((await request(`/listings/${listingId}/reviews`, 'student')).status).toBe(404)
    const publicSearch = await request('/listings', 'guest')
    expect(((await publicSearch.json()) as { data: { items: Array<{ id: string }> } }).data.items.some(item => item.id === listingId)).toBe(false)
    const photo = await prisma.listingPhoto.findFirstOrThrow({ where: { listingId } })
    expect((await request(`/media/${photo.storageKey}`, 'guest')).status).toBe(404)
    expect((await request(`/landlord-verifications/listings/${listingId}`, 'landlord').then(response => response.json()) as { data: { status: string } }).data.status).toBe('EXPIRED')
    await prisma.propertyAuthorization.update({ where: { id: renewalId }, data: { expiresAt: future } })

    // Revoking one property's authorization pauses its live listing. Renewing
    // it does not restore a later-revoked landlord identity.
    expect((await request(`/admin/property-authorizations/${renewalId}`, 'admin', 'PATCH', JSON.stringify({ status: 'REVOKED', reason: 'Synthetic ownership dispute.' }))).status).toBe(200)
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('PAUSED')
    expect((await request(`/listings/${listingId}`, 'guest')).status).toBe(404)
    expect((await request(`/landlord-verifications/listings/${listingId}`, 'landlord', 'POST', propertyForm())).status).toBe(201)
    const finalAuthorizationId = (await prisma.propertyAuthorization.findFirstOrThrow({ where: { listingId }, orderBy: { createdAt: 'desc' } })).id
    expect((await request(`/admin/property-authorizations/${finalAuthorizationId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED' }))).status).toBe(200)
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(200)
    expect((await request(`/admin/listings/${listingId}`, 'admin', 'PATCH', JSON.stringify({ status: 'PUBLISHED' }))).status).toBe(200)
    const identityFuture = (await prisma.landlordVerification.findUniqueOrThrow({ where: { id: identityId } })).expiresAt!
    await prisma.landlordVerification.update({ where: { id: identityId }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    expect((await request(`/listings/${listingId}`, 'guest')).status).toBe(404)
    expect((await request('/landlord-verifications/me', 'landlord').then(response => response.json()) as { data: { status: string } }).data.status).toBe('EXPIRED')
    const { pauseListingsWithoutCurrentApproval } = await import('../workers/approval-expiry.js')
    expect(await pauseListingsWithoutCurrentApproval()).toBeGreaterThanOrEqual(1)
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('PAUSED')
    await prisma.landlordVerification.update({ where: { id: identityId }, data: { expiresAt: identityFuture } })
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'PUBLISHED' } })
    expect((await request(`/admin/landlord-verifications/${identityId}`, 'admin', 'PATCH', JSON.stringify({ status: 'REVOKED', reason: 'Synthetic identity dispute.' }))).status).toBe(200)
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('PAUSED')
    expect((await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: finalAuthorizationId } })).status).toBe('REVOKED')
    expect((await request(`/listings/${listingId}/submit`, 'landlord', 'POST')).status).toBe(403)

    const deletion = await request('/account/deletion-requests', 'landlord', 'POST', JSON.stringify({ confirmation: 'DELETE_ACCOUNT' }))
    expect(deletion.status).toBe(201)
    const deletionId = (await prisma.deletionRequest.findFirstOrThrow({ where: { userId: landlordId } })).id
    const removed = await request(`/admin/deletion-requests/${deletionId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: 'Synthetic landlord requested deletion.' }))
    expect(removed.status).toBe(200)
    expect(await readdir(join(privateDir, 'landlord-verifications'))).toHaveLength(0)
    expect(await prisma.landlordVerification.count({ where: { userId: landlordId } })).toBe(0)
    expect(await prisma.propertyAuthorization.count({ where: { listingId } })).toBe(0)
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('ARCHIVED')
  })
})
