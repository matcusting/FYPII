import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { asyncRoute, fail, ok } from '../core/http.js'
import { clearSession, createSession, currentUser, requireAuth, tokenHash } from '../core/auth.js'
import { queueEmail } from '../core/mail.js'

const router = Router()
const email = z.email().max(254).transform(value => value.trim().toLowerCase())
const password = z.string().min(8).max(128)
const phone = z.string().trim().min(7).max(25)
  .regex(/^\+?[0-9][0-9 ()-]*$/)
  .refine(value => { const digits = value.replace(/\D/g, '').length; return digits >= 7 && digits <= 15 })
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100), email, password,
  role: z.enum(['STUDENT', 'LANDLORD']), phone: phone.optional(), acceptTerms: z.literal(true),
})
const loginSchema = z.object({ email, password: z.string().min(1).max(128) })
const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) })
const resetSchema = tokenSchema.extend({ password })
const forgotSchema = z.object({ email })

const limiter = (max: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => { fail(res, 429, 'Too many attempts. Please try again later.', 'RATE_LIMITED') },
})

function publicUser(user: { id: string; name: string; email: string; roles: string[]; status: string; emailVerifiedAt: Date | null; studentVerified: boolean; verificationStatus: string }) {
  return { id: user.id, name: user.name, email: user.email, roles: user.roles, status: user.status,
    emailVerified: !!user.emailVerifiedAt, studentVerified: user.studentVerified, verificationStatus: user.verificationStatus }
}

function authUrl(path: string, token: string) {
  const base = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  const url = new URL(path, base)
  url.searchParams.set('token', token)
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
  const token = randomBytes(32).toString('hex')
  const hash = await argon2.hash(rawPassword, { type: argon2.argon2id })
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({ data: { name, email: address, passwordHash: hash, roles: [role], profile: { create: { displayName: name, phone: role === 'LANDLORD' ? contactPhone : null } }, notificationPreference: { create: {} } } })
    await tx.authToken.create({ data: { userId: created.id, tokenHash: tokenHash(token), kind: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
    return created
  })
  await queueEmail(user.email, 'Verify your UTS Housing email', 'email-verification', { name: user.name, url: authUrl('/verify-email', token) })
  return ok(res, { id: user.id, email: user.email, verificationRequired: true }, 201)
}))

router.post('/login', limiter(12), asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a valid email and password.', 'VALIDATION_ERROR')
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
    return fail(res, 401, 'Invalid email or password.', 'INVALID_CREDENTIALS')
  }
  if (req.authSessionId) await prisma.session.updateMany({ where: { id: req.authSessionId }, data: { revokedAt: new Date() } })
  await createSession(res, user.id, req)
  return ok(res, publicUser(user))
}))

router.get('/me', requireAuth, (req, res) => ok(res, publicUser(currentUser(req)!)))

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

router.post('/verify-email', limiter(20), asyncRoute(async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'The verification token is invalid or expired.', 'INVALID_TOKEN')
  const token = await prisma.authToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) } })
  if (!token || token.kind !== 'EMAIL_VERIFY' || token.usedAt || token.expiresAt <= new Date()) return fail(res, 400, 'The verification token is invalid or expired.', 'INVALID_TOKEN')
  const consumed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${token.userId}))::text`
    const account = await tx.user.findUnique({ where: { id: token.userId }, select: { status: true, emailVerifiedAt: true } })
    if (!account || account.status !== 'ACTIVE' || account.emailVerifiedAt) return false
    const result = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
    if (!result.count) return false
    await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } })
    return true
  })
  if (!consumed) return fail(res, 400, 'The verification token is invalid or expired.', 'INVALID_TOKEN')
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
      where: { userId: user.id, kind: 'EMAIL_VERIFY' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    })
    if (mostRecent && mostRecent.createdAt > new Date(Date.now() - 10 * 60 * 1000)) return

    const token = randomBytes(32).toString('hex')
    await tx.authToken.updateMany({ where: { userId: user.id, kind: 'EMAIL_VERIFY', usedAt: null }, data: { usedAt: new Date() } })
    await tx.authToken.create({ data: { userId: user.id, tokenHash: tokenHash(token), kind: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
    await tx.emailJob.create({ data: {
      to: account.email, subject: 'Verify your UTS Housing email', template: 'email-verification',
      payload: { name: account.name, url: authUrl('/verify-email', token) },
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

export default router
