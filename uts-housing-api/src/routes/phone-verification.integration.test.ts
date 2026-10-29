import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('phone verification integration', () => {
  let server: Server
  let prisma: typeof import('../core/db.js').prisma
  let base = ''
  let cookie = ''
  let outbox = ''
  const userId = randomUUID()
  const email = `sms-integration-${userId}@student.uts.edu.my`

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.SESSION_SECRET = 'sms-integration-secret-not-for-production-123456'
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
    process.env.SMS_PROVIDER = 'localOutbox'
    outbox = await mkdtemp(join(tmpdir(), 'housing-sms-integration-'))
    process.env.SMS_OUTBOX_DIR = outbox
    const [appModule, dbModule, authModule] = await Promise.all([import('../app.js'), import('../core/db.js'), import('../core/auth.js')])
    prisma = dbModule.prisma
    await prisma.user.create({ data: {
      id: userId, name: 'SMS Test', email, passwordHash: 'integration-only', roles: ['STUDENT'], emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'SMS Test', phone: '012-345 6789' } },
    } })
    const rawSession = randomBytes(32).toString('hex')
    await prisma.session.create({ data: { userId, tokenHash: authModule.tokenHash(rawSession), expiresAt: new Date(Date.now() + 3_600_000) } })
    cookie = `housing_session=${rawSession}`
    server = await new Promise<Server>(resolve => { const started = appModule.app.listen(0, '127.0.0.1', () => resolve(started)) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server failed to bind.')
    base = `http://127.0.0.1:${address.port}/api/v1`
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (prisma) { await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect() }
    if (outbox) await rm(outbox, { force: true, recursive: true })
  })

  async function request(path: string, method = 'GET', body?: Record<string, unknown>) {
    const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: 'http://localhost:5173', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, payload: await response.json() as { data?: Record<string, unknown>; error?: { code: string } } }
  }

  async function newCode(previous: Set<string>) {
    const files = await readdir(outbox)
    const newFiles = files.filter(file => !previous.has(file))
    expect(newFiles).toHaveLength(1)
    const message = await readFile(join(outbox, newFiles[0]!), 'utf8')
    return message.match(/code: (\d{6})/)?.[1] || ''
  }

  it('sends only to the saved phone, limits attempts, verifies a code, and revokes verification after a phone change', async () => {
    const first = await request('/phone-verification')
    expect(first.payload.data).toMatchObject({ phone: '012-345 6789', verified: false, localOutbox: true })
    const beforeFirst = new Set(await readdir(outbox))
    expect((await request('/phone-verification/request', 'POST')).status).toBe(200)
    const code = await newCode(beforeFirst)
    expect(code).toMatch(/^\d{6}$/)
    const stored = await prisma.phoneVerificationChallenge.findUniqueOrThrow({ where: { userId } })
    expect(stored.phone).toBe('+60123456789')
    expect(stored.codeHash).not.toBe(code)
    expect((await request('/phone-verification/request', 'POST')).payload.error?.code).toBe('SMS_COOLDOWN')
    const wrong = code === '999999' ? '000000' : '999999'
    expect((await request('/phone-verification/confirm', 'POST', { code: wrong })).payload.error?.code).toBe('INVALID_SMS_CODE')
    const accepted = await request('/phone-verification/confirm', 'POST', { code })
    expect(accepted.status).toBe(200)
    expect(accepted.payload.data).toMatchObject({ verified: false, testCompleted: true })
    expect((await request('/phone-verification')).payload.data).toMatchObject({ verified: false, testCompleted: true })
    expect((await prisma.profile.findUnique({ where: { userId } }))?.phoneVerifiedAt).toBeNull()
    expect((await request('/phone-verification/confirm', 'POST', { code })).status).toBe(400)

    const changed = await request('/profile', 'PATCH', { phone: '013-444 5566' })
    expect(changed.status).toBe(200)
    expect((await request('/phone-verification')).payload.data).toMatchObject({ verified: false, testCompleted: false })
    expect(await prisma.phoneVerificationChallenge.findUnique({ where: { userId } })).toBeNull()
    const beforeSecond = new Set(await readdir(outbox))
    expect((await request('/phone-verification/request', 'POST')).status).toBe(200)
    const secondCode = await newCode(beforeSecond)
    expect((await request('/phone-verification/confirm', 'POST', { code })).status).toBe(400)
    await prisma.phoneVerificationChallenge.update({ where: { userId }, data: { failedAttempts: 4 } })
    expect((await request('/phone-verification/confirm', 'POST', { code: secondCode === '999999' ? '000000' : '999999' })).status).toBe(400)
    expect((await request('/phone-verification/confirm', 'POST', { code: secondCode })).status).toBe(400)
    await prisma.phoneVerificationChallenge.update({ where: { userId }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } })
    const beforeThird = new Set(await readdir(outbox))
    expect((await request('/phone-verification/request', 'POST')).status).toBe(200)
    expect((await request('/phone-verification/confirm', 'POST', { code: await newCode(beforeThird) })).status).toBe(200)
  })
})
