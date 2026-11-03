import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Run against a migrated disposable PostgreSQL database.
describe.skipIf(!process.env.TEST_DATABASE_URL)('student document verification integration', () => {
  let server: Server
  let base = ''
  let privateDir = ''
  let prisma: typeof import('../core/db.js').prisma
  const studentId = randomUUID()
  const rejectedStudentId = randomUUID()
  const adminId = randomUUID()
  const campusId = randomUUID()
  const studentEmail = `verification-${studentId}@student.uts.edu.my`
  const rejectedStudentEmail = `verification-${rejectedStudentId}@student.uts.edu.my`
  const cookies: Record<'student' | 'rejectedStudent' | 'admin', string> = { student: '', rejectedStudent: '', admin: '' }
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11])
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_SECRET = 'local-verification-test-secret-123456789'
    privateDir = await mkdtemp(join(tmpdir(), 'housing-verification-integration-'))
    process.env.MEDIA_PRIVATE_DIR = privateDir
    const [appModule, dbModule, authModule] = await Promise.all([
      import('../app.js'), import('../core/db.js'), import('../core/auth.js'),
    ])
    prisma = dbModule.prisma
    await prisma.campus.create({ data: { id: campusId, name: 'Verification Test Campus', university: 'University of Technology Sarawak', latitude: 2.322, longitude: 111.839, domains: ['student.uts.edu.my'] } })
    await prisma.user.createMany({ data: [
      { id: studentId, name: 'Synthetic Student', email: studentEmail, passwordHash: 'test-only', roles: ['STUDENT'], emailVerifiedAt: new Date() },
      { id: rejectedStudentId, name: 'Synthetic Rejected Student', email: rejectedStudentEmail, passwordHash: 'test-only', roles: ['STUDENT'], emailVerifiedAt: new Date() },
      { id: adminId, name: 'Synthetic Reviewer', email: `admin-${adminId}@example.test`, passwordHash: 'test-only', roles: ['ADMIN'], emailVerifiedAt: new Date() },
    ] })
    for (const [role, id] of [['student', studentId], ['rejectedStudent', rejectedStudentId], ['admin', adminId]] as const) {
      const token = randomBytes(32).toString('hex')
      await prisma.session.create({ data: { userId: id, tokenHash: authModule.tokenHash(token), expiresAt: new Date(Date.now() + 60_000) } })
      cookies[role] = `housing_session=${token}`
    }
    server = await new Promise<Server>(resolve => {
      const started = appModule.app.listen(0, '127.0.0.1', () => resolve(started))
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server failed to bind.')
    base = `http://127.0.0.1:${address.port}/api/v1`
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
      await prisma.emailJob.deleteMany({ where: { to: { in: [studentEmail, rejectedStudentEmail] } } })
      await prisma.user.deleteMany({ where: { id: { in: [studentId, rejectedStudentId, adminId] } } })
      await prisma.campus.deleteMany({ where: { id: campusId } })
      await prisma.$disconnect()
    }
    if (privateDir) await rm(privateDir, { recursive: true, force: true })
    delete process.env.MEDIA_PRIVATE_DIR
  })

  function form() {
    const body = new FormData()
    body.set('method', 'DOCUMENTS')
    body.set('studentId', new Blob([jpeg], { type: 'image/jpeg' }), 'synthetic-id.jpg')
    body.set('offerLetter', new Blob([pdf], { type: 'application/pdf' }), 'synthetic-offer.pdf')
    return body
  }

  function request(path: string, role: 'student' | 'rejectedStudent' | 'admin' | 'guest', method = 'GET', body?: BodyInit) {
    return fetch(base + path, { method, headers: {
      Origin: 'http://localhost:5173',
      ...(role === 'guest' ? {} : { Cookie: cookies[role] }),
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    }, body })
  }

  it('accepts one concurrent submission, restricts document access and removes files on account deletion', async () => {
    const responses = await Promise.all([
      request('/verifications', 'student', 'POST', form()),
      request('/verifications', 'student', 'POST', form()),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    expect(await prisma.studentVerification.count({ where: { userId: studentId, status: 'PENDING' } })).toBe(1)
    const storedFiles = await readdir(join(privateDir, 'verifications'))
    expect(storedFiles).toHaveLength(2)

    // The private files remain readable through a new HTTP listener.
    await new Promise<void>(resolve => server.close(() => resolve()))
    const { app } = await import('../app.js')
    server = await new Promise<Server>(resolve => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started))
    })
    const restartedAddress = server.address()
    if (!restartedAddress || typeof restartedAddress === 'string') throw new Error('Test server failed to restart.')
    base = `http://127.0.0.1:${restartedAddress.port}/api/v1`

    const queue = await (await request('/admin/verifications', 'admin')).json() as { data: { items: Array<{ id: string }> } }
    const verificationId = (await prisma.studentVerification.findFirstOrThrow({ where: { userId: studentId } })).id
    expect(queue.data.items.some(item => item.id === verificationId)).toBe(true)
    const detail = await (await request(`/admin/verifications/${verificationId}`, 'admin')).json() as { data: { studentIdUrl: string; offerLetterUrl: string; student: { emailVerified: boolean } } }
    expect(detail.data.student.emailVerified).toBe(true)
    expect(detail.data.studentIdUrl).toContain('/student-id')
    expect(detail.data.offerLetterUrl).toContain('/offer-letter')
    expect((await request(`/admin/verifications/${verificationId}/student-id`, 'guest')).status).toBe(401)
    expect((await request(`/admin/verifications/${verificationId}/student-id`, 'student')).status).toBe(403)
    const studentIdDocument = await request(`/admin/verifications/${verificationId}/student-id`, 'admin')
    expect(studentIdDocument.status).toBe(200)
    expect(Buffer.from(await studentIdDocument.arrayBuffer())).toEqual(jpeg)
    const privateDocument = await request(`/admin/verifications/${verificationId}/offer-letter`, 'admin')
    expect(privateDocument.status).toBe(200)
    expect(privateDocument.headers.get('cache-control')).toContain('no-store')
    expect(Buffer.from(await privateDocument.arrayBuffer())).toEqual(pdf)
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: 'STUDENT_DOCUMENT_VIEWED', targetId: verificationId } })).toBe(2)

    const unchecked = await request(`/admin/verifications/${verificationId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: 'Both synthetic documents reviewed.' }))
    expect(unchecked.status).toBe(400)
    const missingStudyEndDate = await request(`/admin/verifications/${verificationId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: '', studentIdMatchesEmail: true }))
    expect(missingStudyEndDate.status).toBe(400)
    const undocumentedOfficialCheck = await request(`/admin/verifications/${verificationId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: '', studentIdMatchesEmail: true, studyEndsAt: '2028-06-30', enrollmentCheckStatus: 'ACTIVE' }))
    expect(undocumentedOfficialCheck.status).toBe(400)
    const inactive = await request(`/admin/verifications/${verificationId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: '', studentIdMatchesEmail: true, studyEndsAt: '2028-06-30', enrollmentCheckStatus: 'INACTIVE', enrollmentCheckReference: 'synthetic-case-1' }))
    expect(inactive.status).toBe(400)
    const approved = await request(`/admin/verifications/${verificationId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: 'Both synthetic documents reviewed.', studentIdMatchesEmail: true, studyEndsAt: '2028-06-30', enrollmentCheckStatus: 'ACTIVE', enrollmentCheckReference: 'synthetic-case-1' }))
    expect(approved.status).toBe(200)
    const reviewed = await prisma.studentVerification.findUniqueOrThrow({ where: { id: verificationId } })
    expect(reviewed).toMatchObject({ enrollmentCheckStatus: 'ACTIVE', enrollmentCheckReference: 'synthetic-case-1', studyEndsAt: new Date('2028-06-30T00:00:00.000Z'), evidenceRetainUntil: new Date('2029-06-30T00:00:00.000Z') })
    expect(reviewed.enrollmentCheckedAt).toBeInstanceOf(Date)
    const account = await (await request('/auth/me', 'student')).json() as { data: { studentVerified: boolean } }
    expect(account.data.studentVerified).toBe(true)

    const deletion = await request('/account/deletion-requests', 'student', 'POST', JSON.stringify({ confirmation: 'DELETE_ACCOUNT' }))
    expect(deletion.status).toBe(201)
    const deletionId = (await prisma.deletionRequest.findFirstOrThrow({ where: { userId: studentId } })).id
    const removed = await request(`/admin/deletion-requests/${deletionId}`, 'admin', 'PATCH', JSON.stringify({ status: 'APPROVED', reason: 'Requested by synthetic student.' }))
    expect(removed.status).toBe(200)
    expect(await readdir(join(privateDir, 'verifications'))).toHaveLength(0)
    expect(await prisma.studentVerification.count({ where: { userId: studentId } })).toBe(0)
    expect((await request(`/admin/verifications/${verificationId}/offer-letter`, 'admin')).status).toBe(404)
  })

  it('removes rejected student documents and allows another review attempt', async () => {
    expect((await request('/verifications', 'rejectedStudent', 'POST', form())).status).toBe(201)
    const row = await prisma.studentVerification.findFirstOrThrow({ where: { userId: rejectedStudentId } })
    const rejected = await request(`/admin/verifications/${row.id}`, 'admin', 'PATCH', JSON.stringify({ status: 'REJECTED', reason: 'Synthetic documents were unreadable.' }))
    expect(rejected.status).toBe(200)
    expect(await readdir(join(privateDir, 'verifications'))).toHaveLength(0)
    const record = await prisma.studentVerification.findUniqueOrThrow({ where: { id: row.id } })
    expect(record).toMatchObject({ status: 'REJECTED', studentIdKey: null, offerLetterKey: null })
    expect(await prisma.mediaUpload.count({ where: { ownerId: rejectedStudentId, purpose: 'VERIFICATION' } })).toBe(0)
    expect((await request('/verifications', 'rejectedStudent', 'POST', form())).status).toBe(201)
  })
})
