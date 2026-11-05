import { randomBytes, randomInt } from 'node:crypto'
import argon2 from 'argon2'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { asyncRoute, fail, ok } from '../core/http.js'
import { clearSession, createSession, currentUser, requireAuth, requireSession, tokenHash } from '../core/auth.js'
import { queueEmail } from '../core/mail.js'
import { authenticatorUri, decryptMfaSecret, encryptMfaSecret, matchingTotpStep, newMfaSecret, newRecoveryCodes, normalizeRecoveryCode } from '../core/mfa.js'
import { normalizeSmsPhone } from '../core/sms.js'
import { effectiveStudentVerificationStatus, studentVerificationIsCurrent } from '../core/student-verification.js'

const router = Router()
const email = z.email().max(254).transform(value => value.trim().toLowerCase())
const password = z.string().min(8).max(128)
const phone = z.string().trim().min(7).max(25)
  .regex(/^\+?[0-9][0-9 ()-]*$/)
  .refine(value => { const digits = value.replace(/\D/g, '').length; return digits >= 7 && digits <= 15 && Boolean(normalizeSmsPhone(value)) })
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100), email, password,
  role: z.enum(['STUDENT', 'LANDLORD']), phone: phone.optional(), acceptTerms: z.literal(true),
})
const loginSchema = z.object({ email, password: z.string().min(1).max(128), mfaCode: z.string().trim().max(30).optional() })
const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) })
const verificationSchema = z.union([tokenSchema, z.object({
  email, code: z.string().trim().regex(/^[a-z0-9]{6}$/i).transform(value => value.toUpperCase()),
})])
const resetSchema = tokenSchema.extend({ password })
const inviteSchema = tokenSchema.extend({ password: z.string().min(12).max(128) })
const forgotSchema = z.object({ email })

const limiter = (max: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => { fail(res, 429, 'Too many attempts. Please try again later.', 'RATE_LIMITED') },
})

function publicUser(user: { id: string; name: string; email: string; roles: string[]; status: string; emailVerifiedAt: Date | null; studentVerified: boolean; studentVerifiedUntil: Date | null; verificationStatus: string; mfaSecretEncrypted: string | null }, mfaVerified = false) {
  return { id: user.id, name: user.name, email: user.email, roles: user.roles, status: user.status,
    emailVerified: !!user.emailVerifiedAt, studentVerified: studentVerificationIsCurrent(user),
    studentVerifiedUntil: user.studentVerifiedUntil?.toISOString().slice(0, 10) || null,
    verificationStatus: effectiveStudentVerificationStatus(user),
    mfaSetupRequired: process.env.NODE_ENV === 'production' && user.roles.some(role => role === 'ADMIN' || role === 'LAWYER') && !user.mfaSecretEncrypted,
    mfaVerified }
}

async function verifyLoginMfa(userId: string, submittedCode: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    const account = await tx.user.findUnique({ where: { id: userId } })
    if (!account || account.status !== 'ACTIVE' || !account.mfaSecretEncrypted) return false
    const now = new Date()
    if (account.mfaLockedUntil && account.mfaLockedUntil > now) return false
    const secret = decryptMfaSecret(account.mfaSecretEncrypted, account.id)
    const step = matchingTotpStep(secret, submittedCode)
    const recovery = normalizeRecoveryCode(submittedCode)
    const recoveryHash = recovery ? tokenHash(`mfa-recovery:${account.id}:${recovery}`) : null
    const recoveryIndex = recoveryHash ? account.mfaRecoveryHashes.indexOf(recoveryHash) : -1
    if (step !== null && (account.mfaLastUsedStep === null || step > account.mfaLastUsedStep)) {
      await tx.user.update({ where: { id: account.id }, data: { mfaLastUsedStep: step, mfaFailedAttempts: 0, mfaLockedUntil: null } })
      return true
    }
    if (recoveryIndex >= 0) {
      await tx.user.update({ where: { id: account.id }, data: {
        mfaRecoveryHashes: account.mfaRecoveryHashes.filter((_, index) => index !== recoveryIndex), mfaFailedAttempts: 0, mfaLockedUntil: null,
      } })
      await tx.auditLog.create({ data: { actorId: account.id, action: 'MFA_RECOVERY_CODE_USED', targetType: 'ACCOUNT', targetId: account.id } })
      return true
    }
    const attempts = (account.mfaLockedUntil && account.mfaLockedUntil <= now ? 0 : account.mfaFailedAttempts) + 1
    await tx.user.update({ where: { id: account.id }, data: {
      mfaFailedAttempts: attempts >= 8 ? 0 : attempts,
      mfaLockedUntil: attempts >= 8 ? new Date(now.getTime() + 15 * 60_000) : null,
    } })
    return false
  })
}

function authUrl(path: string, token: string) {
  const base = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  const url = new URL(path, base)
  url.searchParams.set('token', token)
  return url.toString()
}

function verificationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('') }
  while (!/[A-Z]/.test(code) || !/[2-9]/.test(code))
  return code
}

function verificationUrl(address: string): string {
  const base = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  const url = new URL('/verify-email', base)
  url.searchParams.set('email', address)
  return url.toString()
}

router.post('/register', limiter(10), asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a valid name, email, password and account type, then accept the terms.', 'VALIDATION_ERROR')
  const { name, email: address, password: rawPassword, role, phone: contactPhone } = parsed.data
  if (role === 'LANDLORD' && !contactPhone) return fail(res, 400, 'Enter a contact phone number for a landlord account.', 'PHONE_REQUIRED')
  if (/^(password|password123|12345678|qwerty123)$/i.test(rawPassword)) return fail(res, 400, 'Choose a less common password.', 'WEAK_PASSWORD')
  if (role === 'STUDENT') {
    const emailDomain = address.split('@')[1]
    const campuses = await prisma.campus.findMany({ where: { active: true }, select: { domains: true } })
    const accepted = campuses.some(campus => campus.domains.some(domain => domain.trim().toLowerCase() === emailDomain))
    if (!accepted) return fail(res, 400, 'Use a university-issued student email address from an approved campus.', 'STUDENT_EMAIL_REQUIRED')
  }
  const existing = await prisma.user.findUnique({ where: { email: address }, select: { id: true } })
  if (existing) return fail(res, 409, 'An account with this email already exists.', 'EMAIL_IN_USE')
  const code = verificationCode()
  const hash = await argon2.hash(rawPassword, { type: argon2.argon2id })
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({ data: { name, email: address, passwordHash: hash, roles: [role], profile: { create: { displayName: name, phone: role === 'LANDLORD' ? contactPhone : null } }, notificationPreference: { create: {} } } })
    await tx.authToken.create({ data: { userId: created.id, tokenHash: tokenHash(`${address}:${code}`), kind: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
    return created
  })
  await queueEmail(user.email, 'Verify your UTS Housing email', 'email-verification', { name: user.name, url: verificationUrl(user.email), code })
  return ok(res, { id: user.id, email: user.email, verificationRequired: true }, 201)
}))

router.post('/login', limiter(12), asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a valid email and password.', 'VALIDATION_ERROR')
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
    return fail(res, 401, 'Invalid email or password.', 'INVALID_CREDENTIALS')
  }
  if (process.env.NODE_ENV === 'production' && user.roles.some(role => role === 'ADMIN' || role === 'LAWYER') && !user.emailVerifiedAt) {
    return fail(res, 403, 'Verify the privileged account email before signing in.', 'EMAIL_NOT_VERIFIED')
  }
  const privileged = user.roles.some(role => role === 'ADMIN' || role === 'LAWYER')
  let mfaVerified = false
  if (privileged && user.mfaSecretEncrypted) {
    if (!parsed.data.mfaCode) return fail(res, 401, 'Enter your authenticator or recovery code.', 'MFA_REQUIRED')
    mfaVerified = await verifyLoginMfa(user.id, parsed.data.mfaCode)
    if (!mfaVerified) return fail(res, 401, 'The authenticator or recovery code is invalid or temporarily locked.', 'INVALID_MFA_CODE')
  }
  if (req.authSessionId) await prisma.session.updateMany({ where: { id: req.authSessionId }, data: { revokedAt: new Date() } })
  await createSession(res, user, req, mfaVerified)
  return ok(res, publicUser(user, mfaVerified))
}))

router.get('/delivery-mode', (_req, res) => ok(res, { localOutbox: process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST }))

router.get('/me', requireSession, (req, res) => ok(res, publicUser(currentUser(req)!, Boolean(req.authMfaVerified))))

router.post('/logout', asyncRoute(async (req, res) => {
  if (req.authSessionId && currentUser(req)) await prisma.session.updateMany({ where: { id: req.authSessionId, userId: currentUser(req)!.id }, data: { revokedAt: new Date() } })
  clearSession(res)
  return ok(res, { signedOut: true })
}))

router.get('/sessions', requireAuth, asyncRoute(async (req, res) => {
  const sessions = await prisma.session.findMany({ where: { userId: currentUser(req)!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, device: true, createdAt: true, lastActiveAt: true }, orderBy: { lastActiveAt: 'desc' }, take: 100 })
  return ok(res, { sessions: sessions.map(session => ({ ...session, current: session.id === req.authSessionId })) })
}))

router.delete('/sessions/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await prisma.session.updateMany({ where: { id: String(req.params.id), userId: currentUser(req)!.id, revokedAt: null }, data: { revokedAt: new Date() } })
  if (!result.count) return fail(res, 404, 'Session not found.', 'NOT_FOUND')
  if (req.authSessionId === req.params.id) clearSession(res)
  return ok(res, { revoked: true })
}))

// An invited administrator/reviewer can access these two endpoints with a
// limited password-authenticated session. All other production routes require
// a session upgraded by a confirmed authenticator code.
function mayEnrollMfa(req: Parameters<typeof currentUser>[0]): boolean {
  const account = currentUser(req)
  return Boolean(account && req.authSessionId && account.emailVerifiedAt
    && account.roles.some(role => role === 'ADMIN' || role === 'LAWYER')
    && (!account.mfaSecretEncrypted || req.authMfaVerified))
}

router.post('/mfa/setup', requireSession, limiter(8), asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (!mayEnrollMfa(req)) return fail(res, 403, 'A verified privileged session is required.', 'MFA_SETUP_FORBIDDEN')
  const parsed = z.object({ password: z.string().min(1).max(128) }).safeParse(req.body)
  if (!parsed.success || !(await argon2.verify(currentUser(req)!.passwordHash, parsed.data.password))) {
    return fail(res, 401, 'The password is incorrect.', 'INVALID_CREDENTIALS')
  }
  const account = currentUser(req)!
  const secret = newMfaSecret()
  const pendingEncrypted = encryptMfaSecret(secret, account.id)
  await prisma.user.update({ where: { id: account.id }, data: { mfaPendingEncrypted: pendingEncrypted, mfaPendingCreatedAt: new Date(), mfaFailedAttempts: 0, mfaLockedUntil: null } })
  return ok(res, { secret, authenticatorUri: authenticatorUri(secret, account.email), expiresInSeconds: 600 })
}))

router.post('/mfa/confirm', requireSession, limiter(12), asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (!mayEnrollMfa(req)) return fail(res, 403, 'A verified privileged session is required.', 'MFA_SETUP_FORBIDDEN')
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter the six-digit code from your authenticator.', 'INVALID_MFA_CODE')
  const userId = currentUser(req)!.id
  const sessionId = req.authSessionId!
  const outcome = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    const account = await tx.user.findUnique({ where: { id: userId } })
    const now = new Date()
    if (!account || account.status !== 'ACTIVE' || !account.emailVerifiedAt || !account.mfaPendingEncrypted
      || !account.mfaPendingCreatedAt || account.mfaPendingCreatedAt.getTime() + 600_000 <= now.getTime()
      || (account.mfaSecretEncrypted && !req.authMfaVerified)) return null
    if (account.mfaLockedUntil && account.mfaLockedUntil > now) return null
    const secret = decryptMfaSecret(account.mfaPendingEncrypted, account.id)
    const step = matchingTotpStep(secret, parsed.data.code, now.getTime())
    if (step === null) {
      const attempts = account.mfaFailedAttempts + 1
      await tx.user.update({ where: { id: userId }, data: {
        mfaFailedAttempts: attempts >= 8 ? 0 : attempts,
        mfaLockedUntil: attempts >= 8 ? new Date(now.getTime() + 15 * 60_000) : null,
      } })
      return null
    }
    const codes = newRecoveryCodes()
    await tx.user.update({ where: { id: userId }, data: {
      mfaSecretEncrypted: account.mfaPendingEncrypted, mfaPendingEncrypted: null, mfaPendingCreatedAt: null,
      mfaRecoveryHashes: codes.map(code => tokenHash(`mfa-recovery:${userId}:${normalizeRecoveryCode(code)}`)),
      mfaLastUsedStep: step, mfaFailedAttempts: 0, mfaLockedUntil: null,
    } })
    await tx.session.updateMany({ where: { userId, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: now } })
    const upgraded = await tx.session.updateMany({ where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } }, data: { mfaVerifiedAt: now } })
    if (!upgraded.count) throw new Error('The enrolment session expired.')
    await tx.auditLog.create({ data: { actorId: userId, action: account.mfaSecretEncrypted ? 'MFA_ROTATED' : 'MFA_ENROLLED', targetType: 'ACCOUNT', targetId: userId } })
    return codes
  })
  if (!outcome) return fail(res, 400, 'The authenticator code is invalid, expired, or temporarily locked.', 'INVALID_MFA_CODE')
  return ok(res, { enrolled: true, recoveryCodes: outcome })
}))

router.post('/verify-email', limiter(20), asyncRoute(async (req, res) => {
  const invalid = () => fail(res, 400, 'The verification code is invalid or expired.', 'INVALID_TOKEN')
  const parsed = verificationSchema.safeParse(req.body)
  if (!parsed.success) return invalid()
  let token
  if ('token' in parsed.data) {
    // Existing long links remain valid until their original expiry.
    token = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) } })
  } else {
    const account = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } })
    if (!account) return invalid()
    token = await prisma.authToken.findFirst({ where: { userId: account.id, kind: 'EMAIL_VERIFY' }, orderBy: { createdAt: 'desc' } })
    if (!token || token.tokenHash !== tokenHash(`${parsed.data.email}:${parsed.data.code}`)) {
      if (token?.usedAt === null && token.expiresAt > new Date()) {
        await prisma.authToken.updateMany({ where: { id: token.id, usedAt: null, failedAttempts: { lt: 10 } }, data: { failedAttempts: { increment: 1 } } })
      }
      return invalid()
    }
  }
  if (!token || token.kind !== 'EMAIL_VERIFY' || token.usedAt || token.expiresAt <= new Date() || token.failedAttempts >= 10) return invalid()
  const consumed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${token.userId}))::text`
    const account = await tx.user.findUnique({ where: { id: token.userId }, select: { status: true, emailVerifiedAt: true } })
    if (!account || account.status !== 'ACTIVE' || account.emailVerifiedAt) return false
    const result = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() }, failedAttempts: { lt: 10 } }, data: { usedAt: new Date() } })
    if (!result.count) return false
    await tx.authToken.updateMany({ where: { userId: token.userId, kind: 'EMAIL_VERIFY', usedAt: null }, data: { usedAt: new Date() } })
    await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } })
    return true
  })
  if (!consumed) return invalid()
  return ok(res, { verified: true })
}))

// A forgotten or expired registration link must not strand an account. Keep the
// response identical for unknown, verified and inactive addresses, and limit
// requests per IP and per account so this cannot become a mail relay.
router.post('/resend-verification', limiter(5), asyncRoute(async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a valid email address.', 'VALIDATION_ERROR')
  const accepted = { accepted: true }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } })
  if (!user) return ok(res, accepted)

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text`
    const account = await tx.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, status: true, emailVerifiedAt: true } })
    if (!account || account.status !== 'ACTIVE' || account.emailVerifiedAt) return
    const mostRecent = await tx.authToken.findFirst({
      where: { userId: user.id, kind: 'EMAIL_VERIFY' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, tokenHash: true },
    })
    if (mostRecent && mostRecent.createdAt > new Date(Date.now() - 10 * 60 * 1000)) return

    let code = verificationCode()
    while (mostRecent?.tokenHash === tokenHash(`${account.email}:${code}`)) code = verificationCode()
    await tx.authToken.updateMany({ where: { userId: user.id, kind: 'EMAIL_VERIFY', usedAt: null }, data: { usedAt: new Date() } })
    await tx.authToken.create({ data: { userId: user.id, tokenHash: tokenHash(`${account.email}:${code}`), kind: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
    await tx.emailJob.create({ data: {
      to: account.email, subject: 'Verify your UTS Housing email', template: 'email-verification',
      payload: { name: account.name, url: verificationUrl(account.email), code },
    } })
  })
  return ok(res, accepted)
}))

router.post('/forgot-password', limiter(8), asyncRoute(async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a valid email address.', 'VALIDATION_ERROR')
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (user && user.status === 'ACTIVE') {
    const token = randomBytes(32).toString('hex')
    await prisma.$transaction(async tx => {
      await tx.authToken.updateMany({ where: { userId: user.id, kind: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } })
      await tx.authToken.create({ data: { userId: user.id, kind: 'PASSWORD_RESET', tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } })
    })
    await queueEmail(user.email, 'Reset your UTS Housing password', 'password-reset', { name: user.name, url: authUrl('/reset-password', token) })
  }
  return ok(res, { accepted: true })
}))

router.post('/reset-password', limiter(12), asyncRoute(async (req, res) => {
  const parsed = resetSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a valid reset token and a password of at least 8 characters.', 'VALIDATION_ERROR')
  const token = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) } })
  if (!token || token.kind !== 'PASSWORD_RESET' || token.usedAt || token.expiresAt <= new Date()) return fail(res, 400, 'The reset token is invalid or expired.', 'INVALID_TOKEN')
  const hash = await argon2.hash(parsed.data.password, { type: argon2.argon2id })
  const consumed = await prisma.$transaction(async tx => {
    const result = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
    if (!result.count) return false
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash: hash } })
    await tx.session.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    return true
  })
  if (!consumed) return fail(res, 400, 'The reset token is invalid or expired.', 'INVALID_TOKEN')
  clearSession(res)
  return ok(res, { reset: true })
}))

// Privileged accounts are created suspended by an operator-only database CLI.
// This single-use mailbox link verifies the recipient and lets them choose a
// password without ever placing that password in CLI output or server logs.
router.post('/accept-invite', limiter(8), asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const invalid = () => fail(res, 400, 'The invitation is invalid, expired, or already used.', 'INVALID_INVITATION')
  const parsed = inviteSchema.safeParse(req.body)
  if (!parsed.success || /^(password|password123|12345678|qwerty123)$/i.test(parsed.data.password)) return invalid()
  const token = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) } })
  if (!token || token.kind !== 'ACCOUNT_INVITE' || token.usedAt || token.expiresAt <= new Date()) return invalid()
  const hash = await argon2.hash(parsed.data.password, { type: argon2.argon2id })
  const accepted = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${token.userId} FOR UPDATE`
    const currentToken = await tx.authToken.findUnique({ where: { id: token.id } })
    const account = await tx.user.findUnique({ where: { id: token.userId } })
    if (!currentToken || currentToken.kind !== 'ACCOUNT_INVITE' || currentToken.usedAt || currentToken.expiresAt <= new Date()
      || !account || account.status !== 'SUSPENDED' || account.emailVerifiedAt
      || account.roles.length !== 1 || (account.roles[0] !== 'ADMIN' && account.roles[0] !== 'LAWYER')) return null
    const now = new Date()
    const consumed = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
    if (!consumed.count) return null
    await tx.authToken.updateMany({ where: { userId: account.id, kind: 'ACCOUNT_INVITE', usedAt: null }, data: { usedAt: now } })
    await tx.user.update({ where: { id: account.id }, data: { status: 'ACTIVE', emailVerifiedAt: now, passwordHash: hash } })
    await tx.session.updateMany({ where: { userId: account.id, revokedAt: null }, data: { revokedAt: now } })
    if (req.authSessionId) await tx.session.updateMany({ where: { id: req.authSessionId, revokedAt: null }, data: { revokedAt: now } })
    await tx.auditLog.create({ data: { actorId: account.id, action: 'PRIVILEGED_INVITE_ACCEPTED', targetType: 'ACCOUNT',
      targetId: account.id, after: { role: account.roles[0], emailVerified: true } } })
    return account.roles[0]
  })
  if (!accepted) return invalid()
  clearSession(res)
  return ok(res, { accepted: true, role: accepted })
}))

export default router
