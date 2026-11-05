import { Router } from 'express'
import { z } from 'zod'
import { currentUser, requireAuth } from '../core/auth.js'
import { prisma } from '../core/db.js'
import { asyncRoute, fail, ok } from '../core/http.js'
import { normalizeSmsPhone } from '../core/sms.js'
import { effectiveStudentVerificationStatus } from '../core/student-verification.js'

const router = Router()
const optionalText = (length: number) => z.string().trim().max(length).nullable().optional()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}, 'Enter a valid date.').nullable().optional()
const amount = z.number().finite().nonnegative().max(1_000_000).nullable().optional()
const phoneNumber = z.string().trim().min(7).max(25)
  .regex(/^\+?[0-9][0-9 ()-]*$/, 'Enter a valid phone number.')
  .refine(value => { const digits = value.replace(/\D/g, '').length; return digits >= 7 && digits <= 15 && Boolean(normalizeSmsPhone(value)) }, 'Enter a Malaysian number beginning with 0 or an international number with +country code.')
  .nullable().optional()
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  phone: phoneNumber,
  university: optionalText(160), bio: optionalText(1000), preferredLocation: optionalText(160),
  budgetMin: amount, budgetMax: amount, preferredMoveInDate: isoDate,
}).strict()
const preferenceSchema = z.object({
  emailInquiryUpdates: z.boolean().optional(), emailConnectionRequests: z.boolean().optional(), emailProductUpdates: z.boolean().optional(),
}).strict()

function formatProfile(user: { name: string; email: string; verificationStatus: string; studentVerified: boolean; studentVerifiedUntil: Date | null }, profile: {
  displayName: string; phone: string | null; phoneVerifiedAt: Date | null; university: string | null; bio: string | null; preferredLocation: string | null;
  budgetMin: { toString(): string } | null; budgetMax: { toString(): string } | null;
  preferredMoveInDate: Date | null
} | null) {
  return {
    displayName: profile?.displayName || user.name, name: user.name, email: user.email,
    phone: profile?.phone || null, phoneVerifiedAt: profile?.phoneVerifiedAt || null, university: profile?.university || null,
    bio: profile?.bio || null, preferredLocation: profile?.preferredLocation || null,
    budgetMin: profile?.budgetMin?.toString() || null, budgetMax: profile?.budgetMax?.toString() || null,
    preferredMoveInDate: profile?.preferredMoveInDate?.toISOString().slice(0, 10) || null,
    verificationStatus: effectiveStudentVerificationStatus(user),
    studentVerifiedUntil: user.studentVerifiedUntil?.toISOString().slice(0, 10) || null,
  }
}

router.get('/profile', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } })
  return ok(res, formatProfile(user, profile))
}))

router.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) return fail(res, 400, 'Enter valid profile details.', 'VALIDATION_ERROR')
  const user = currentUser(req)!
  if (parsed.data.phone !== undefined && !user.roles.some(role => role === 'STUDENT' || role === 'LANDLORD')) return fail(res, 403, 'Only students and landlords can update a contact phone number.', 'FORBIDDEN')
  if (user.roles.includes('LANDLORD')) {
    if (parsed.data.phone === null) return fail(res, 400, 'Landlord accounts need a contact phone number.', 'PHONE_REQUIRED')
    if (Object.keys(parsed.data).some(key => !['displayName', 'phone'].includes(key))) return fail(res, 400, 'Landlord profiles contain only name and phone number.', 'VALIDATION_ERROR')
  }
  const current = await prisma.profile.findUnique({ where: { userId: user.id } })
  const fields = parsed.data
  const phoneChanged = fields.phone !== undefined && normalizeSmsPhone(fields.phone || '') !== normalizeSmsPhone(current?.phone || '')
  const min = fields.budgetMin === undefined ? current?.budgetMin == null ? null : Number(current.budgetMin) : fields.budgetMin
  const max = fields.budgetMax === undefined ? current?.budgetMax == null ? null : Number(current.budgetMax) : fields.budgetMax
  if (min !== null && max !== null && min > max && (fields.budgetMin !== undefined || fields.budgetMax !== undefined)) {
    return fail(res, 400, 'The maximum budget cannot be lower than the minimum budget.', 'VALIDATION_ERROR')
  }
  const update = {
    ...(fields.displayName !== undefined ? { displayName: fields.displayName } : {}),
    ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
    ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
    ...(fields.university !== undefined ? { university: fields.university } : {}),
    ...(fields.bio !== undefined ? { bio: fields.bio } : {}),
    ...(fields.preferredLocation !== undefined ? { preferredLocation: fields.preferredLocation } : {}),
    ...(fields.budgetMin !== undefined ? { budgetMin: fields.budgetMin } : {}),
    ...(fields.budgetMax !== undefined ? { budgetMax: fields.budgetMax } : {}),
    ...(fields.preferredMoveInDate !== undefined ? { preferredMoveInDate: fields.preferredMoveInDate ? new Date(`${fields.preferredMoveInDate}T00:00:00.000Z`) : null } : {}),
  }
  const profile = await prisma.$transaction(async tx => {
    if (phoneChanged) await tx.phoneVerificationChallenge.deleteMany({ where: { userId: user.id } })
    if (user.roles.includes('LANDLORD') && fields.displayName && fields.displayName !== user.name) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text`
      const invalidatedAt = new Date()
      await tx.landlordVerification.updateMany({ where: { userId: user.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REJECTED', reason: 'Legal name changed; submit a new identity application.', reviewedAt: invalidatedAt } })
      await tx.propertyAuthorization.updateMany({ where: { requesterId: user.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REJECTED', reason: 'Landlord legal name changed; submit new property proof.', reviewedAt: invalidatedAt } })
      await tx.listing.updateMany({ where: { ownerId: user.id, status: { in: ['PUBLISHED', 'PENDING_REVIEW'] } }, data: { status: 'PAUSED', reviewedAt: null, moderationReason: 'Landlord identity must be reviewed again.' } })
    }
    if (fields.displayName) await tx.user.update({ where: { id: user.id }, data: { name: fields.displayName } })
    return tx.profile.upsert({ where: { userId: user.id }, create: { userId: user.id, displayName: fields.displayName || user.name, ...update }, update })
  })
  return ok(res, formatProfile({ ...user, name: fields.displayName || user.name }, profile))
}))

router.get('/notifications/preferences', requireAuth, asyncRoute(async (req, res) => {
  const preference = await prisma.notificationPreference.upsert({ where: { userId: currentUser(req)!.id }, create: { userId: currentUser(req)!.id }, update: {} })
  return ok(res, {
    emailInquiryUpdates: preference.emailInquiryUpdates, emailConnectionRequests: preference.emailConnectionRequests,
    emailProductUpdates: preference.emailProductUpdates,
  })
}))

router.patch('/notifications/preferences', requireAuth, asyncRoute(async (req, res) => {
  const parsed = preferenceSchema.safeParse(req.body)
  if (!parsed.success || Object.keys(parsed.data).length === 0) return fail(res, 400, 'Choose at least one valid notification setting.', 'VALIDATION_ERROR')
  const preference = await prisma.notificationPreference.upsert({ where: { userId: currentUser(req)!.id }, create: { userId: currentUser(req)!.id, ...parsed.data }, update: parsed.data })
  return ok(res, {
    emailInquiryUpdates: preference.emailInquiryUpdates, emailConnectionRequests: preference.emailConnectionRequests,
    emailProductUpdates: preference.emailProductUpdates,
  })
}))

router.post('/account/deletion-requests', requireAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({ confirmation: z.literal('DELETE_ACCOUNT') }).safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Confirm that you want to request account deletion.', 'VALIDATION_ERROR')
  const userId = currentUser(req)!.id
  const existing = await prisma.deletionRequest.findFirst({ where: { userId, status: 'PENDING' }, orderBy: { requestedAt: 'desc' } })
  if (existing) return ok(res, { status: existing.status, requestedAt: existing.requestedAt })
  const request = await prisma.deletionRequest.create({ data: { userId } })
  return ok(res, { status: request.status, requestedAt: request.requestedAt }, 201)
}))

export default router
