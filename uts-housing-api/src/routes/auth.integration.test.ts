import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Run with TEST_DATABASE_URL set to a migrated disposable PostgreSQL database.
describe.skipIf(!process.env.TEST_DATABASE_URL)('auth and account integration', () => {
  let server: Server
  let base = ''
  let outbox = ''
  let prisma: typeof import('../core/db.js').prisma
  let processEmailJobs: typeof import('../workers/email.js').processEmailJobs
  const email = `auth-integration-${Date.now()}@student.uts.edu.my`
  const campusId = randomUUID()
  const password = 'IntegrationOnly123!'

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_SECRET = 'local-integration-secret-not-for-production-123456'
    delete process.env.SMTP_HOST
    outbox = await mkdtemp(join(tmpdir(), 'housing-auth-outbox-'))
    process.env.EMAIL_OUTBOX_DIR = outbox
    const [appModule, dbModule, workerModule] = await Promise.all([
      import('../app.js'), import('../core/db.js'), import('../workers/email.js'),
    ])
    prisma = dbModule.prisma
    processEmailJobs = workerModule.processEmailJobs
    await prisma.campus.create({ data: {
      id: campusId, name: 'Integration Test Campus', university: 'University of Technology Sarawak',
      latitude: 2.322, longitude: 111.839, domains: ['student.uts.edu.my'],
    } })
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
      await prisma.emailJob.deleteMany({ where: { to: email } })
      await prisma.user.deleteMany({ where: { email } })
      await prisma.campus.deleteMany({ where: { id: campusId } })
      await prisma.$disconnect()
    }
    if (outbox) await rm(outbox, { force: true, recursive: true })
  })

  it('registers, verifies, signs in, enforces CSRF, and invalidates sessions after reset', async () => {
    const deliveryMode = await fetch(base + '/auth/delivery-mode')
    expect((await deliveryMode.json() as { data: { localOutbox: boolean } }).data.localOutbox).toBe(true)
    let cookie = ''
    const request = async (path: string, method = 'GET', body?: Record<string, unknown>, includeOrigin = true) => {
      const headers: Record<string, string> = {}
      if (body) headers['Content-Type'] = 'application/json'
      if (cookie) headers.Cookie = cookie
      if (includeOrigin) headers.Origin = 'http://localhost:5173'
      const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
      return { response, payload: await response.json() as { data?: Record<string, unknown>; error?: { code: string } } }
    }
    const emailToken = async (subject: string, exclude?: string) => {
      await processEmailJobs()
      const files = (await readdir(outbox)).sort().reverse()
      for (const file of files) {
        const text = await readFile(join(outbox, file), 'utf8')
        if (text.includes(`To: ${email}`) && text.includes(`Subject: ${subject}`)) {
          const match = text.match(/token=([a-f0-9]{64})/)
          if (match && match[1] !== exclude) return match[1]
        }
      }
      throw new Error(`Missing ${subject} email`)
    }
    const emailCode = async (exclude?: string) => {
      await processEmailJobs()
      const files = (await readdir(outbox)).sort().reverse()
      for (const file of files) {
        const text = await readFile(join(outbox, file), 'utf8')
        if (!text.includes(`To: ${email}`) || !text.includes('Subject: Verify your UTS Housing email')) continue
        const match = text.match(/verification code is: ([A-Z2-9]{6})/)
        if (match && match[1] !== exclude) return match[1]
      }
      throw new Error('Missing verification code email')
    }

    const personalEmail = await request('/auth/register', 'POST', { name: 'Integration Student', email: `auth-integration-${Date.now()}@example.test`, password, role: 'STUDENT', acceptTerms: true })
    expect(personalEmail.response.status).toBe(400)
    expect(personalEmail.payload.error?.code).toBe('STUDENT_EMAIL_REQUIRED')
    expect((await request('/auth/register', 'POST', { name: 'Integration Student', email, password, role: 'STUDENT', acceptTerms: true })).response.status).toBe(201)
    const firstVerificationCode = await emailCode()
    expect(firstVerificationCode).toMatch(/^(?=.*[A-Z])(?=.*[2-9])[A-Z2-9]{6}$/)
    const student = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await request('/auth/verify-email', 'POST', { email, code: 'AAAAAA' })).response.status).toBe(400)
    }
    expect((await request('/auth/verify-email', 'POST', { email, code: firstVerificationCode })).response.status).toBe(400)
    await prisma.authToken.updateMany({ where: { userId: student.id, kind: 'EMAIL_VERIFY' }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } })
    expect((await request('/auth/resend-verification', 'POST', { email })).payload.data?.accepted).toBe(true)
    const verificationCode = await emailCode(firstVerificationCode)
    expect(verificationCode).not.toBe(firstVerificationCode)
    expect((await request('/auth/verify-email', 'POST', { email, code: firstVerificationCode })).response.status).toBe(400)
    expect((await request('/auth/verify-email', 'POST', { email, code: verificationCode.toLowerCase() })).response.status).toBe(200)
    expect((await request('/auth/verify-email', 'POST', { email, code: verificationCode })).response.status).toBe(400)
    const signed = await request('/auth/login', 'POST', { email, password })
    expect(signed.response.status).toBe(200)
    expect(signed.payload.data).not.toHaveProperty('passwordHash')
    expect(signed.response.headers.get('set-cookie')).toContain('HttpOnly')
    cookie = signed.response.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/auth/me')).payload.data?.emailVerified).toBe(true)
    expect((await request('/profile', 'PATCH', { displayName: 'Blocked' }, false)).response.status).toBe(403)
    expect((await request('/profile', 'PATCH', { displayName: 'Updated Student', budgetMin: 200, budgetMax: 800 })).response.status).toBe(200)
    expect((await request('/notifications/preferences', 'PATCH', { emailProductUpdates: true })).response.status).toBe(200)
    const sessions = await request('/auth/sessions')
    expect(sessions.response.status).toBe(200)
    expect((sessions.payload.data?.sessions as Array<{ current: boolean }>)[0].current).toBe(true)
    expect((await request('/auth/forgot-password', 'POST', { email })).response.status).toBe(200)
    const resetToken = await emailToken('Reset your UTS Housing password')
    expect((await request('/auth/reset-password', 'POST', { token: resetToken, password: 'ChangedOnly123!' })).response.status).toBe(200)
    expect((await request('/auth/reset-password', 'POST', { token: resetToken, password: 'ChangedOnly123!' })).response.status).toBe(400)
    expect((await request('/auth/me')).response.status).toBe(401)
    expect((await request('/auth/login', 'POST', { email, password })).response.status).toBe(401)
    expect((await request('/auth/login', 'POST', { email, password: 'ChangedOnly123!' })).response.status).toBe(200)
  })
})
