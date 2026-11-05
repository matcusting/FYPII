import { randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import argon2 from 'argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Only synthetic accounts in a migrated disposable PostgreSQL database.
describe.skipIf(!process.env.TEST_DATABASE_URL)('privileged account invitations', () => {
  let server: Server
  let base = ''
  let prisma: typeof import('../core/db.js').prisma
  let invite: typeof import('../../prisma/invite-account.js').invitePrivilegedAccount
  let recoverMfa: typeof import('../../prisma/recover-privileged-mfa.js').recoverPrivilegedMfa
  const adminEmail = `inviter-${randomUUID()}@example.test`
  const reviewerEmail = `invitee-${randomUUID()}@example.test`
  const adminId = randomUUID()
  const newPassword = 'Synthetic-Invitation-Password-123!'

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.NODE_ENV = 'production'
    process.env.FRONTEND_ORIGIN = 'https://housing.example.test'
    process.env.PUBLIC_BASE_URL = 'https://housing.example.test'
    process.env.SESSION_SECRET = 'production-invitation-integration-secret-1234567890'
    process.env.SMTP_HOST = 'smtp.example.test' // never contacted by this test
    process.env.EMAIL_FROM = 'UTS Housing <noreply@housing.example.test>'
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('hex')
    const [appModule, dbModule, inviteModule, recoverModule] = await Promise.all([
      import('../app.js'), import('../core/db.js'), import('../../prisma/invite-account.js'), import('../../prisma/recover-privileged-mfa.js'),
    ])
    prisma = dbModule.prisma
    invite = inviteModule.invitePrivilegedAccount
    recoverMfa = recoverModule.recoverPrivilegedMfa
    await prisma.user.create({ data: {
      id: adminId, name: 'Synthetic Operator', email: adminEmail,
      passwordHash: await argon2.hash('Synthetic-Admin-Password-123!'), roles: ['ADMIN'], emailVerifiedAt: new Date(),
    } })
    server = await new Promise<Server>(resolve => { const started = appModule.app.listen(0, '127.0.0.1', () => resolve(started)) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server failed to bind.')
    base = `http://127.0.0.1:${address.port}/api/v1`
  })

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (prisma) {
      const lawyer = await prisma.user.findUnique({ where: { email: reviewerEmail }, select: { id: true } })
      await prisma.auditLog.deleteMany({ where: { actorId: { in: lawyer ? [adminId, lawyer.id] : [adminId] } } })
      await prisma.emailJob.deleteMany({ where: { to: reviewerEmail } })
      await prisma.user.deleteMany({ where: { email: { in: [adminEmail, reviewerEmail] } } })
      await prisma.$disconnect()
    }
    delete process.env.SMTP_HOST
    delete process.env.EMAIL_FROM
    delete process.env.MFA_ENCRYPTION_KEY
  })

  async function request(path: string, body?: Record<string, unknown>, cookie?: string) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
      Origin: 'https://housing.example.test', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}),
    }, body: body ? JSON.stringify(body) : undefined })
    return { response, payload: await response.json() as { data?: Record<string, unknown>; error?: { code: string } } }
  }

  it('requires an active verified administrator and does not upgrade an existing account', async () => {
    await expect(invite({ role: 'LAWYER', name: 'Synthetic Reviewer', email: reviewerEmail })).rejects.toThrow('verified active administrator')
    await expect(invite({ role: 'LAWYER', name: 'Synthetic Reviewer', email: adminEmail, actorEmail: adminEmail })).rejects.toThrow()
  })

  it('keeps the lawyer suspended until a replacement one-time link is accepted', async () => {
    const result = await invite({ role: 'LAWYER', name: 'Synthetic Reviewer', email: reviewerEmail, actorEmail: adminEmail })
    expect(result).toEqual({ role: 'LAWYER', email: reviewerEmail, resent: false })
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: reviewerEmail } })
    expect(pending.status).toBe('SUSPENDED')
    expect(pending.emailVerifiedAt).toBeNull()
    expect(pending.roles).toEqual(['LAWYER'])
    expect((await request('/auth/login', { email: reviewerEmail, password: newPassword })).response.status).toBe(401)
    const firstJob = await prisma.emailJob.findFirstOrThrow({ where: { to: reviewerEmail, template: 'account-invite' }, orderBy: { createdAt: 'desc' } })
    const firstUrl = (firstJob.payload as { url: string }).url
    expect(firstUrl).toMatch(/^https:\/\/housing\.example\.test\/accept-invite\?token=[a-f0-9]{64}$/)
    const firstToken = new URL(firstUrl).searchParams.get('token')!
    expect((await request('/auth/accept-invite', { token: 'a'.repeat(64), password: newPassword })).payload.error?.code).toBe('INVALID_INVITATION')
    await expect(invite({ role: 'LAWYER', name: 'Synthetic Reviewer', email: reviewerEmail, actorEmail: adminEmail })).rejects.toThrow('already has an account')

    const resent = await invite({ role: 'LAWYER', name: 'Synthetic Reviewer', email: reviewerEmail, actorEmail: adminEmail, resend: true })
    expect(resent.resent).toBe(true)
    const stale = await prisma.emailJob.findUniqueOrThrow({ where: { id: firstJob.id } })
    expect(stale.payload).toEqual({})
    expect(stale.attempts).toBe(5)
    expect((await request('/auth/accept-invite', { token: firstToken, password: newPassword })).payload.error?.code).toBe('INVALID_INVITATION')
    const nextJob = await prisma.emailJob.findFirstOrThrow({ where: { to: reviewerEmail, template: 'account-invite', status: 'PENDING' }, orderBy: { createdAt: 'desc' } })
    const currentToken = new URL((nextJob.payload as { url: string }).url).searchParams.get('token')!
    expect(currentToken).not.toBe(firstToken)
    expect((await request('/auth/accept-invite', { token: currentToken, password: 'weak' })).response.status).toBe(400)
    const accepted = await request('/auth/accept-invite', { token: currentToken, password: newPassword })
    expect(accepted.payload.data).toEqual({ accepted: true, role: 'LAWYER' })
    expect((await request('/auth/accept-invite', { token: currentToken, password: newPassword })).payload.error?.code).toBe('INVALID_INVITATION')
    const activated = await prisma.user.findUniqueOrThrow({ where: { email: reviewerEmail } })
    expect(activated.status).toBe('ACTIVE')
    expect(activated.emailVerifiedAt).not.toBeNull()
    expect(await argon2.verify(activated.passwordHash, newPassword)).toBe(true)
    const initialLogin = await request('/auth/login', { email: reviewerEmail, password: newPassword })
    expect(initialLogin.response.status).toBe(200)
    expect(initialLogin.payload.data?.mfaSetupRequired).toBe(true)
    expect(initialLogin.response.headers.get('set-cookie')).toContain('Secure')
    const limitedCookie = initialLogin.response.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/lawyer/cases', undefined, limitedCookie)).response.status).toBe(403)

    const setup = await request('/auth/mfa/setup', { password: newPassword }, limitedCookie)
    expect(setup.response.status).toBe(200)
    const secret = String(setup.payload.data?.secret)
    const { totpAt } = await import('../core/mfa.js')
    const code = totpAt(secret, Math.floor(Date.now() / 30_000))
    const confirmed = await request('/auth/mfa/confirm', { code }, limitedCookie)
    expect(confirmed.response.status).toBe(200)
    const recoveryCodes = confirmed.payload.data?.recoveryCodes as string[]
    expect(recoveryCodes).toHaveLength(8)
    expect((await request('/lawyer/cases', undefined, limitedCookie)).response.status).toBe(200)

    const login = await request('/auth/login', { email: reviewerEmail, password: newPassword, mfaCode: recoveryCodes[0] })
    expect(login.response.status).toBe(200)
    const cookie = login.response.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/lawyer/cases', undefined, cookie)).response.status).toBe(200)
    expect((await request('/admin/overview', undefined, cookie)).response.status).toBe(403)

    await expect(recoverMfa({ targetEmail: reviewerEmail, actorEmail: reviewerEmail, reason: 'Synthetic out-of-band identity confirmation', soleAdmin: false })).rejects.toThrow()
    expect(await recoverMfa({ targetEmail: reviewerEmail, actorEmail: adminEmail,
      reason: 'Synthetic out-of-band identity confirmation', soleAdmin: false })).toEqual({ role: 'LAWYER', email: reviewerEmail })
    const recovered = await prisma.user.findUniqueOrThrow({ where: { email: reviewerEmail } })
    expect(recovered.mfaSecretEncrypted).toBeNull()
    expect(recovered.mfaRecoveryHashes).toEqual([])
    expect(await argon2.verify(recovered.passwordHash, newPassword)).toBe(false)
    expect((await request('/lawyer/cases', undefined, cookie)).response.status).toBe(401)
    const resetJob = await prisma.emailJob.findFirstOrThrow({ where: { to: reviewerEmail, template: 'password-reset', status: 'PENDING' } })
    const resetToken = new URL((resetJob.payload as { url: string }).url).searchParams.get('token')!
    expect((await request('/auth/reset-password', { token: resetToken, password: newPassword })).response.status).toBe(200)
    const freshLogin = await request('/auth/login', { email: reviewerEmail, password: newPassword })
    expect(freshLogin.payload.data?.mfaSetupRequired).toBe(true)
    const freshCookie = freshLogin.response.headers.get('set-cookie')!.split(';')[0]
    expect((await request('/lawyer/cases', undefined, freshCookie)).response.status).toBe(403)
    expect(await prisma.auditLog.count({ where: { targetId: recovered.id, action: 'PRIVILEGED_MFA_EMERGENCY_RESET' } })).toBe(1)
  })
})
