import { randomInt, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { currentUser, requireAuth, requireEmailVerified, tokenHash } from '../core/auth.js'
import { prisma } from '../core/db.js'
import { asyncRoute, fail, ok } from '../core/http.js'
import { deliverSms, normalizeSmsPhone, smsMode } from '../core/sms.js'

const router = Router()
const tenMinutes = 10 * 60_000
const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => { fail(res, 429, 'Too many attempts. Try again later.', 'RATE_LIMITED') },
})
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict()

router.get('/phone-verification', requireAuth, asyncRoute(async (req, res) => {
  const userId = currentUser(req)!.id
  const [profile, challenge] = await Promise.all([
    prisma.profile.findUnique({ where: { userId }, select: { phone: true, phoneVerifiedAt: true } }),
    prisma.phoneVerificationChallenge.findUnique({ where: { userId } }),
  ])
  const mode = smsMode()
  const phone = profile?.phone ? normalizeSmsPhone(profile.phone) : null
  res.setHeader('Cache-Control', 'no-store')
  return ok(res, { phone: profile?.phone || null, verified: Boolean(profile?.phone && profile.phoneVerifiedAt),
    verifiedAt: profile?.phoneVerifiedAt || null, testCompleted: mode === 'localOutbox' && Boolean(phone && challenge?.phone === phone && challenge.verifiedAt && challenge.deliveryMode === mode),
    available: mode !== 'disabled', localOutbox: mode === 'localOutbox' })
}))

router.post('/phone-verification/request', requireAuth, requireEmailVerified, limiter(5), asyncRoute(async (req, res) => {
  const mode = smsMode()
  if (mode === 'disabled') return fail(res, 503, 'SMS delivery is not configured.', 'SMS_UNAVAILABLE')
  const userId = currentUser(req)!.id
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const prepared = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`
    const profile = await tx.profile.findUnique({ where: { userId }, select: { phone: true, phoneVerifiedAt: true } })
    const phone = profile?.phone ? normalizeSmsPhone(profile.phone) : null
    if (!phone) return { result: 'phone-required' as const }
    if (profile?.phoneVerifiedAt) return { result: 'already-verified' as const }
    const previous = await tx.phoneVerificationChallenge.findUnique({ where: { userId } })
    if (previous && previous.deliveryMode === mode && previous.createdAt > new Date(Date.now() - tenMinutes)) return { result: 'cooldown' as const }
    const codeHash = tokenHash(`phone:${userId}:${phone}:${code}`)
    await tx.phoneVerificationChallenge.upsert({ where: { userId }, create: { userId, phone, deliveryMode: mode, codeHash, expiresAt: new Date(Date.now() + tenMinutes) },
      update: { phone, deliveryMode: mode, codeHash, failedAttempts: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + tenMinutes), verifiedAt: null } })
    return { result: 'ready' as const, phone, codeHash }
  })
  if (prepared.result === 'phone-required') return fail(res, 400, 'Save a valid phone number first.', 'PHONE_REQUIRED')
  if (prepared.result === 'already-verified') return ok(res, { verified: true })
  if (prepared.result === 'cooldown') return fail(res, 429, 'Wait 10 minutes before requesting another code.', 'SMS_COOLDOWN')
  try { await deliverSms(prepared.phone, code) }
  catch {
    await prisma.phoneVerificationChallenge.deleteMany({ where: { userId, codeHash: prepared.codeHash } })
    return fail(res, 503, 'The SMS could not be sent. Try again later.', 'SMS_DELIVERY_FAILED')
  }
  return ok(res, { accepted: true, expiresInSeconds: 600 })
}))

router.post('/phone-verification/confirm', requireAuth, requireEmailVerified, limiter(20), asyncRoute(async (req, res) => {
  const mode = smsMode()
  if (mode === 'disabled') return fail(res, 503, 'SMS delivery is not configured.', 'SMS_UNAVAILABLE')
  const parsed = codeSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter the six-digit verification code.', 'VALIDATION_ERROR')
  const userId = currentUser(req)!.id
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`
    const [profile, challenge] = await Promise.all([
      tx.profile.findUnique({ where: { userId }, select: { phone: true } }),
      tx.phoneVerificationChallenge.findUnique({ where: { userId } }),
    ])
    const currentPhone = profile?.phone ? normalizeSmsPhone(profile.phone) : null
    if (!currentPhone || !challenge || challenge.phone !== currentPhone || challenge.deliveryMode !== mode || challenge.verifiedAt || challenge.expiresAt <= new Date() || challenge.failedAttempts >= 5) return false
    const expected = Buffer.from(challenge.codeHash, 'hex')
    const actual = Buffer.from(tokenHash(`phone:${userId}:${currentPhone}:${parsed.data.code}`), 'hex')
    if (!timingSafeEqual(expected, actual)) {
      await tx.phoneVerificationChallenge.update({ where: { userId }, data: { failedAttempts: { increment: 1 } } })
      return false
    }
    const verifiedAt = new Date()
    if (mode === 'twilio') await tx.profile.update({ where: { userId }, data: { phoneVerifiedAt: verifiedAt } })
    await tx.phoneVerificationChallenge.update({ where: { userId }, data: { verifiedAt } })
    return true
  })
  if (!result) return fail(res, 400, 'The code is invalid, expired, or has been tried too many times.', 'INVALID_SMS_CODE')
  return ok(res, { verified: mode === 'twilio', testCompleted: mode === 'localOutbox' })
}))

export default router
