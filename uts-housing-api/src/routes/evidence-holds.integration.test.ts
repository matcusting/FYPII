import { randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Only a migrated disposable database with synthetic cases is used here.
describe.skipIf(!process.env.TEST_DATABASE_URL)('administrator evidence preservation holds', () => {
  let server: Server
  let base = ''
  let prisma: typeof import('../core/db.js').prisma
  const adminId = randomUUID()
  const studentId = randomUUID()
  const landlordId = randomUUID()
  const campusId = randomUUID()
  const listingId = randomUUID()
  const studentCaseId = randomUUID()
  const identityCaseId = randomUUID()
  const propertyCaseId = randomUUID()
  const cookies: Record<'admin' | 'student', string> = { admin: '', student: '' }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_SECRET = 'synthetic-evidence-hold-test-secret-123456789'
    const [appModule, dbModule, authModule] = await Promise.all([import('../app.js'), import('../core/db.js'), import('../core/auth.js')])
    prisma = dbModule.prisma
    await prisma.user.createMany({ data: [
      { id: adminId, name: 'Synthetic Admin', email: `hold-admin-${adminId}@example.test`, passwordHash: 'synthetic', roles: ['ADMIN'] },
      { id: studentId, name: 'Synthetic Student', email: `hold-student-${studentId}@example.test`, passwordHash: 'synthetic', roles: ['STUDENT'] },
      { id: landlordId, name: 'Synthetic Landlord', email: `hold-landlord-${landlordId}@example.test`, passwordHash: 'synthetic', roles: ['LANDLORD'] },
    ] })
    await prisma.campus.create({ data: { id: campusId, name: 'Synthetic Hold Campus', university: 'Synthetic University', latitude: 2.322, longitude: 111.839 } })
    await prisma.listing.create({ data: { id: listingId, ownerId: landlordId, campusId, title: 'Synthetic hold listing', description: 'Synthetic property used for hold authorization tests.',
      propertyType: 'HOUSE', roomType: 'SINGLE', rent: '500.00', deposit: '500.00', availableFrom: new Date('2027-01-01T00:00:00.000Z'),
      approximateArea: 'Synthetic Sibu', address: '10 Synthetic Street, 96000 Sibu, Sarawak', status: 'DRAFT' } })
    await prisma.studentVerification.create({ data: { id: studentCaseId, userId: studentId, method: 'DOCUMENTS', university: 'Synthetic University' } })
    await prisma.landlordVerification.create({ data: { id: identityCaseId, userId: landlordId, kind: 'INDIVIDUAL' } })
    await prisma.propertyAuthorization.create({ data: { id: propertyCaseId, requesterId: landlordId, listingId, kind: 'OWNER', addressSnapshot: '10 Synthetic Street, 96000 Sibu, Sarawak' } })
    for (const [role, id] of [['admin', adminId], ['student', studentId]] as const) {
      const token = randomBytes(32).toString('hex')
      await prisma.session.create({ data: { userId: id, tokenHash: authModule.tokenHash(token), expiresAt: new Date(Date.now() + 120_000) } })
      cookies[role] = `housing_session=${token}`
    }
    server = await new Promise<Server>(resolve => { const started = appModule.app.listen(0, '127.0.0.1', () => resolve(started)) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
    base = `http://127.0.0.1:${address.port}/api/v1`
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
      await prisma.propertyAuthorization.deleteMany({ where: { id: propertyCaseId } })
      await prisma.landlordVerification.deleteMany({ where: { id: identityCaseId } })
      await prisma.studentVerification.deleteMany({ where: { id: studentCaseId } })
      await prisma.listing.deleteMany({ where: { id: listingId } })
      await prisma.campus.deleteMany({ where: { id: campusId } })
      await prisma.user.deleteMany({ where: { id: { in: [adminId, studentId, landlordId] } } })
      await prisma.$disconnect()
    }
  })

  function request(kind: string, id: string, role: 'admin' | 'student' | 'guest', body: Record<string, unknown>) {
    return fetch(`${base}/admin/evidence-holds/${kind}/${id}`, { method: 'PATCH', headers: {
      Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...(role === 'guest' ? {} : { Cookie: cookies[role] }),
    }, body: JSON.stringify(body) })
  }

  it('requires administrator access and records placing and releasing each case hold', async () => {
    const cases = [['student', studentCaseId], ['identity', identityCaseId], ['property', propertyCaseId]] as const
    expect((await request('student', studentCaseId, 'guest', { hold: true, reason: 'Synthetic dispute case' })).status).toBe(401)
    expect((await request('student', studentCaseId, 'student', { hold: true, reason: 'Synthetic dispute case' })).status).toBe(403)
    expect((await request('student', studentCaseId, 'admin', { hold: true, reason: 'short' })).status).toBe(400)
    for (const [kind, id] of cases) {
      const placed = await request(kind, id, 'admin', { hold: true, reason: 'Synthetic pending legal dispute' })
      expect(placed.status).toBe(200)
      expect((await placed.json() as { data: { evidenceHoldAt: string } }).data.evidenceHoldAt).toBeTruthy()
      expect((await request(kind, id, 'admin', { hold: true, reason: 'Synthetic duplicate hold' })).status).toBe(409)
      expect((await request(kind, id, 'admin', { hold: false, reason: 'Synthetic dispute resolved' })).status).toBe(400)
      const released = await request(kind, id, 'admin', { hold: false, confirmRelease: true, reason: 'Synthetic dispute resolved' })
      expect(released.status).toBe(200)
      expect((await released.json() as { data: { evidenceHoldAt: string | null } }).data.evidenceHoldAt).toBeNull()
    }
    const [student, identity, property] = await Promise.all([
      prisma.studentVerification.findUniqueOrThrow({ where: { id: studentCaseId } }),
      prisma.landlordVerification.findUniqueOrThrow({ where: { id: identityCaseId } }),
      prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: propertyCaseId } }),
    ])
    expect([student.evidenceHoldAt, identity.evidenceHoldAt, property.evidenceHoldAt]).toEqual([null, null, null])
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: { in: ['EVIDENCE_HOLD_PLACED', 'EVIDENCE_HOLD_RELEASED'] } } })).toBe(6)
  })
})
