import { Router } from 'express'
import { z } from 'zod'
import { currentUser, requireAuth } from '../core/auth.js'
import { prisma } from '../core/db.js'
import { asyncRoute, fail, ok } from '../core/http.js'

const router = Router()
const optionalText = (length: number) => z.string().trim().max(length).nullable().optional()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}, 'Enter a valid date.').nullable().optional()
const amount = z.number().finite().nonnegative().max(1_000_000).nullable().optional()
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  university: optionalText(160), bio: optionalText(1000), preferredLocation: optionalText(160),
  budgetMin: amount, budgetMax: amount, preferredMoveInDate: isoDate,
}).strict()
const preferenceSchema = z.object({
  emailInquiryUpdates: z.boolean().optional(), emailConnectionRequests: z.boolean().optional(), emailProductUpdates: z.boolean().optional(),
}).strict()

function formatProfile(user: { name: string; verificationStatus: string }, profile: {
  displayName: string; university: string | null; bio: string | null; preferredLocation: string | null;
  budgetMin: { toString(): string } | null; budgetMax: { toString(): string } | null;
  preferredMoveInDate: Date | null
} | null) {
  return {
    displayName: profile?.displayName || user.name, name: user.name, university: profile?.university || null,
    bio: profile?.bio || null, preferredLocation: profile?.preferredLocation || null,
    budgetMin: profile?.budgetMin?.toString() || null, budgetMax: profile?.budgetMax?.toString() || null,
    preferredMoveInDate: profile?.preferredMoveInDate?.toISOString().slice(0, 10) || null,
    verificationStatus: user.verificationStatus,
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
  const current = await prisma.profile.findUnique({ where: { userId: user.id } })
  const fields = parsed.data
  const min = fields.budgetMin === undefined ? current?.budgetMin == null ? null : Number(current.budgetMin) : fields.budgetMin
  const max = fields.budgetMax === undefined ? current?.budgetMax == null ? null : Number(current.budgetMax) : fields.budgetMax
  if (min !== null && max !== null && min > max && (fields.budgetMin !== undefined || fields.budgetMax !== undefined)) {
    return fail(res, 400, 'The maximum budget cannot be lower than the minimum budget.', 'VALIDATION_ERROR')
  }
  const update = {
    ...(fields.displayName !== undefined ? { displayName: fields.displayName } : {}),
    ...(fields.university !== undefined ? { university: fields.university } : {}),
    ...(fields.bio !== undefined ? { bio: fields.bio } : {}),
    ...(fields.preferredLocation !== undefined ? { preferredLocation: fields.preferredLocation } : {}),
    ...(fields.budgetMin !== undefined ? { budgetMin: fields.budgetMin } : {}),
    ...(fields.budgetMax !== undefined ? { budgetMax: fields.budgetMax } : {}),
    ...(fields.preferredMoveInDate !== undefined ? { preferredMoveInDate: fields.preferredMoveInDate ? new Date(`${fields.preferredMoveInDate}T00:00:00.000Z`) : null } : {}),
  }
  const profile = await prisma.$transaction(async tx => {
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
