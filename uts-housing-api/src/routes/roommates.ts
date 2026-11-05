import { Router, type Request, type RequestHandler, type Response } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireRole } from '../core/auth.js'
import { fail, ok } from '../core/http.js'
import { queueEmail } from '../core/mail.js'
import { dimensions, evaluateMatch, type MatchingProfile } from '../core/matching.js'
import { currentMalaysiaDate, studentVerificationIsCurrent } from '../core/student-verification.js'

const router = Router()
const studentOnly = requireRole('STUDENT')
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next) }
}

async function lockConnectionPair(tx: Prisma.TransactionClient, firstId: string, secondId: string): Promise<void> {
  const key = [firstId, secondId].sort().join(':')
  await tx.$queryRaw`SELECT 1 AS lock_acquired FROM pg_advisory_xact_lock(hashtext(${key})::bigint)`
}

const answersSchema = z.object({
  smoking: z.enum(['NEVER', 'OCCASIONAL', 'REGULAR', 'NO_PREFERENCE']).nullable().optional(),
  studySchedule: z.enum(['MORNING', 'DAY', 'EVENING', 'FLEXIBLE']).nullable().optional(),
  sleepSchedule: z.enum(['EARLY', 'LATE', 'FLEXIBLE']).nullable().optional(),
  cleanliness: z.enum(['RELAXED', 'MODERATE', 'HIGH']).nullable().optional(),
  noise: z.enum(['QUIET', 'MODERATE', 'LIVELY']).nullable().optional(),
  guests: z.enum(['RARE', 'SOMETIMES', 'OFTEN']).nullable().optional(),
  pets: z.enum(['NO_PETS', 'PETS_OK', 'HAS_PETS']).nullable().optional(),
}).strict()
const weightValue = z.number().int().min(1).max(5).optional()
const weightsSchema = z.object({
  smoking: weightValue, studySchedule: weightValue, sleepSchedule: weightValue,
  cleanliness: weightValue, noise: weightValue, guests: weightValue, pets: weightValue,
}).strict()
const visibilitySchema = z.object({
  university: z.boolean().optional(), bio: z.boolean().optional(), preferredLocation: z.boolean().optional(),
  budget: z.boolean().optional(), moveInDate: z.boolean().optional(), lifestyle: z.boolean().optional(),
}).strict()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Enter a valid date as YYYY-MM-DD.')
const profileSchema = z.object({
  displayName: z.string().trim().max(80).optional(),
  university: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  preferredLocation: z.string().trim().max(120).nullable().optional(),
  budgetMin: z.number().nonnegative().max(1_000_000).nullable().optional(),
  budgetMax: z.number().nonnegative().max(1_000_000).nullable().optional(),
  moveInDate: isoDate.nullable().optional(),
  discoverable: z.boolean().optional(),
  lifestyle: answersSchema.optional(),
  roommatePreferences: answersSchema.optional(),
  importanceWeights: weightsSchema.optional(),
  visibility: visibilitySchema.optional(),
  smokeFreeOnly: z.boolean().optional(),
  petFreeOnly: z.boolean().optional(),
}).strict()

const blankAnswers = Object.fromEntries(dimensions.map(key => [key, null])) as Record<typeof dimensions[number], null>
const blankWeights = Object.fromEntries(dimensions.map(key => [key, 1])) as Record<typeof dimensions[number], number>
const blankVisibility = { university: false, bio: false, preferredLocation: false, budget: false, moveInDate: false, lifestyle: false }

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function budgetNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function asDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function profileResponse(profile: {
  displayName: string; university: string | null; bio: string | null; preferredLocation: string | null;
  budgetMin: unknown; budgetMax: unknown; moveInDate: Date | null; discoverable: boolean;
  lifestyle: unknown; roommatePreferences: unknown; importanceWeights: unknown; visibility: unknown;
  smokeFreeOnly: boolean; petFreeOnly: boolean;
}) {
  return {
    displayName: profile.displayName, university: profile.university || '', bio: profile.bio || '',
    preferredLocation: profile.preferredLocation || '', budgetMin: budgetNumber(profile.budgetMin) ?? null,
    budgetMax: budgetNumber(profile.budgetMax) ?? null, moveInDate: asDate(profile.moveInDate),
    discoverable: profile.discoverable, lifestyle: profile.lifestyle, roommatePreferences: profile.roommatePreferences,
    importanceWeights: profile.importanceWeights, visibility: { ...jsonObject(profile.visibility), university: false },
    smokeFreeOnly: profile.smokeFreeOnly, petFreeOnly: profile.petFreeOnly,
  }
}

function publicProfile(profile: {
  userId: string; displayName: string; bio: string | null;
  preferredLocation: string | null; budgetMin: unknown; budgetMax: unknown; moveInDate: Date | null;
  visibility: unknown;
}) {
  const visible = jsonObject(profile.visibility)
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    ...(visible.bio === true ? { bio: profile.bio || '' } : {}),
    ...(visible.preferredLocation === true ? { preferredLocation: profile.preferredLocation || '' } : {}),
    ...(visible.budget === true ? { budgetMin: budgetNumber(profile.budgetMin), budgetMax: budgetNumber(profile.budgetMax) } : {}),
    ...(visible.moveInDate === true ? { moveInDate: asDate(profile.moveInDate) } : {}),
  }
}

function verified(user: ReturnType<typeof currentUser>, res: Response): boolean {
  if (!user?.emailVerifiedAt) {
    fail(res, 403, 'Verify your email address before using roommate discovery.', 'EMAIL_NOT_VERIFIED')
    return false
  }
  if (studentVerificationIsCurrent(user)) return true
  fail(res, 403, 'Student verification is required before using roommate discovery.', 'VERIFICATION_REQUIRED')
  return false
}

function dbMatchProfile(profile: {
  lifestyle: unknown; roommatePreferences: unknown; importanceWeights: unknown; visibility: unknown;
  budgetMin: unknown; budgetMax: unknown; moveInDate: Date | null; preferredLocation: string | null;
  smokeFreeOnly: boolean; petFreeOnly: boolean;
}): MatchingProfile {
  return {
    lifestyle: profile.lifestyle, roommatePreferences: profile.roommatePreferences,
    importanceWeights: profile.importanceWeights, visibility: profile.visibility,
    budgetMin: budgetNumber(profile.budgetMin), budgetMax: budgetNumber(profile.budgetMax),
    moveInDate: profile.moveInDate, preferredLocation: profile.preferredLocation,
    smokeFreeOnly: profile.smokeFreeOnly, petFreeOnly: profile.petFreeOnly,
  }
}

async function queueConnectionEmail(recipientId: string, subject: string, body: string): Promise<void> {
  try {
    const [recipient, settings] = await Promise.all([
      prisma.user.findUnique({ where: { id: recipientId }, select: { email: true } }),
      prisma.notificationPreference.findUnique({ where: { userId: recipientId } }),
    ])
    if (recipient && settings?.emailConnectionRequests !== false) {
      await queueEmail(recipient.email, subject, 'notification', { body, actionUrl: '/requests' })
    }
  } catch {
    // The in-app notification has been saved; email delivery can be retried independently.
  }
}

async function matchesFor(userId: string) {
  const own = await prisma.roommateProfile.findUnique({ where: { userId } })
  if (!own?.discoverable) return null
  const [candidates, blocks, existingRequests] = await Promise.all([
    prisma.roommateProfile.findMany({ where: { discoverable: true, userId: { not: userId }, user: { roles: { has: 'STUDENT' }, studentVerified: true, studentVerifiedUntil: { gte: currentMalaysiaDate() }, emailVerifiedAt: { not: null }, status: 'ACTIVE' } } }),
    prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
    prisma.connectionRequest.findMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }] } }),
  ])
  const excluded = new Set(blocks.map(block => block.blockerId === userId ? block.blockedId : block.blockerId))
  return candidates.flatMap(candidate => {
    if (excluded.has(candidate.userId)) return []
    const result = evaluateMatch(dbMatchProfile(own), dbMatchProfile(candidate))
    if (!result.eligible) return []
    const request = existingRequests.find(item => (item.senderId === userId && item.recipientId === candidate.userId) || (item.recipientId === userId && item.senderId === candidate.userId))
    return [{
      id: candidate.userId, publicProfile: publicProfile(candidate), compatibilityScore: result.score,
      topFactors: result.factors, explanation: result.explanation, requestStatus: request?.status || '',
    }]
  }).sort((a, b) => (b.compatibilityScore ?? -1) - (a.compatibilityScore ?? -1) || a.id.localeCompare(b.id))
}

router.get('/roommates/profile', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const profile = await prisma.roommateProfile.findUnique({ where: { userId: user.id } })
  ok(res, profile ? profileResponse(profile) : {
    displayName: user.name, university: '', bio: '', preferredLocation: '', budgetMin: null, budgetMax: null,
    moveInDate: null, discoverable: false, lifestyle: blankAnswers, roommatePreferences: blankAnswers,
    importanceWeights: blankWeights, visibility: blankVisibility, smokeFreeOnly: false, petFreeOnly: false,
  })
}))

router.patch('/roommates/profile', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const parsed = profileSchema.safeParse(req.body)
  if (!parsed.success) { fail(res, 400, 'Check your roommate profile fields and try again.', 'VALIDATION_ERROR'); return }
  const incoming = parsed.data
  const current = await prisma.roommateProfile.findUnique({ where: { userId: user.id } })
  const currentLifestyle = jsonObject(current?.lifestyle || blankAnswers)
  const currentPreferences = jsonObject(current?.roommatePreferences || blankAnswers)
  const currentWeights = jsonObject(current?.importanceWeights || blankWeights)
  const currentVisibility = jsonObject(current?.visibility || blankVisibility)
  const displayName = incoming.displayName ?? current?.displayName ?? user.name
  const budgetMin = incoming.budgetMin !== undefined ? incoming.budgetMin : budgetNumber(current?.budgetMin)
  const budgetMax = incoming.budgetMax !== undefined ? incoming.budgetMax : budgetNumber(current?.budgetMax)
  if (budgetMin !== null && budgetMax !== null && budgetMin !== undefined && budgetMax !== undefined && budgetMin > budgetMax) { fail(res, 400, 'Minimum budget cannot exceed maximum budget.', 'VALIDATION_ERROR'); return }
  if (incoming.discoverable === true && !verified(user, res)) return
  if ((incoming.discoverable ?? current?.discoverable ?? false) && !displayName.trim()) { fail(res, 400, 'Enter a display name before enabling discovery.', 'VALIDATION_ERROR'); return }
  const data = {
    displayName,
    university: incoming.university !== undefined ? incoming.university : current?.university ?? null,
    bio: incoming.bio !== undefined ? incoming.bio : current?.bio ?? null,
    preferredLocation: incoming.preferredLocation !== undefined ? incoming.preferredLocation : current?.preferredLocation ?? null,
    budgetMin: budgetMin ?? null,
    budgetMax: budgetMax ?? null,
    moveInDate: incoming.moveInDate !== undefined ? (incoming.moveInDate ? new Date(`${incoming.moveInDate}T00:00:00.000Z`) : null) : current?.moveInDate ?? null,
    discoverable: incoming.discoverable ?? current?.discoverable ?? false,
    lifestyle: { ...currentLifestyle, ...incoming.lifestyle } as Prisma.InputJsonValue,
    roommatePreferences: { ...currentPreferences, ...incoming.roommatePreferences } as Prisma.InputJsonValue,
    importanceWeights: { ...currentWeights, ...incoming.importanceWeights } as Prisma.InputJsonValue,
    visibility: { ...currentVisibility, ...incoming.visibility, university: false } as Prisma.InputJsonValue,
    smokeFreeOnly: incoming.smokeFreeOnly ?? current?.smokeFreeOnly ?? false,
    petFreeOnly: incoming.petFreeOnly ?? current?.petFreeOnly ?? false,
  }
  const profile = await prisma.roommateProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data })
  ok(res, profileResponse(profile))
}))

router.delete('/roommates/profile', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  await prisma.roommateProfile.deleteMany({ where: { userId: user.id } })
  ok(res, { deleted: true })
}))

router.get('/roommates/matches', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  if (!verified(user, res)) return
  const pagination = paginationSchema.safeParse(req.query)
  if (!pagination.success) { fail(res, 400, 'Choose a valid page and page size.', 'VALIDATION_ERROR'); return }
  const { page, limit } = pagination.data
  const matches = await matchesFor(user.id)
  if (!matches) { fail(res, 403, 'Enable roommate discovery in your profile before viewing matches.', 'DISCOVERY_DISABLED'); return }
  ok(res, { items: matches.slice((page - 1) * limit, page * limit), total: matches.length, page, pages: Math.max(1, Math.ceil(matches.length / limit)), limit })
}))

router.get('/roommates/requests', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const pagination = paginationSchema.safeParse(req.query)
  if (!pagination.success) { fail(res, 400, 'Choose a valid page and page size.', 'VALIDATION_ERROR'); return }
  const { page, limit } = pagination.data
  const where = { OR: [{ senderId: user.id }, { recipientId: user.id }] }
  const [total, requests] = await Promise.all([
    prisma.connectionRequest.count({ where }),
    prisma.connectionRequest.findMany({
      where,
      include: {
        sender: { select: { id: true, roommateProfile: { select: { displayName: true } } } },
        recipient: { select: { id: true, roommateProfile: { select: { displayName: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
    }),
  ])
  ok(res, {
    items: requests.map(({ sender, recipient, ...request }) => ({
      ...request,
      sender: { id: sender.id, name: sender.roommateProfile?.displayName || 'Student' },
      recipient: { id: recipient.id, name: recipient.roommateProfile?.displayName || 'Student' },
    })),
    total, page, pages: Math.max(1, Math.ceil(total / limit)), limit,
  })
}))

router.post('/roommates/requests', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  if (!verified(user, res)) return
  const parsed = z.object({ recipientId: z.string().uuid() }).safeParse(req.body)
  if (!parsed.success) { fail(res, 400, 'Select a valid roommate profile.', 'VALIDATION_ERROR'); return }
  const recipientId = parsed.data.recipientId
  if (recipientId === user.id) { fail(res, 400, 'You cannot send a request to yourself.', 'VALIDATION_ERROR'); return }
  let result
  try {
    result = await prisma.$transaction(async tx => {
      await lockConnectionPair(tx, user.id, recipientId)
      const [sender, recipient, blocked, existing, recent] = await Promise.all([
        tx.user.findUnique({ where: { id: user.id }, select: { studentVerified: true, studentVerifiedUntil: true, emailVerifiedAt: true, status: true, roommateProfile: true } }),
        tx.user.findUnique({ where: { id: recipientId }, select: { roles: true, studentVerified: true, studentVerifiedUntil: true, emailVerifiedAt: true, status: true, roommateProfile: true } }),
        tx.userBlock.findFirst({ where: { OR: [{ blockerId: user.id, blockedId: recipientId }, { blockerId: recipientId, blockedId: user.id }] } }),
        tx.connectionRequest.findFirst({ where: { OR: [{ senderId: user.id, recipientId }, { senderId: recipientId, recipientId: user.id }] } }),
        tx.connectionRequest.count({ where: { senderId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } }),
      ])
      if (!studentVerificationIsCurrent(sender) || !sender?.emailVerifiedAt || sender.status !== 'ACTIVE' || !sender.roommateProfile?.discoverable) return { kind: 'discovery_disabled' as const }
      if (!recipient?.roles.includes('STUDENT') || !studentVerificationIsCurrent(recipient) || !recipient.emailVerifiedAt || recipient.status !== 'ACTIVE' || !recipient.roommateProfile?.discoverable || blocked) return { kind: 'unavailable' as const }
      if (existing) return { kind: 'duplicate' as const }
      if (!evaluateMatch(dbMatchProfile(sender.roommateProfile), dbMatchProfile(recipient.roommateProfile)).eligible) return { kind: 'unavailable' as const }
      if (recent >= 10) return { kind: 'rate_limited' as const }
      const created = await tx.connectionRequest.create({ data: { senderId: user.id, recipientId, status: 'PENDING' } })
      await tx.notification.create({ data: {
        userId: recipientId, type: 'ROOMMATE_CONNECTION_REQUEST',
        payload: { requestId: created.id, senderId: user.id, senderName: sender.roommateProfile.displayName },
      } })
      return { kind: 'created' as const, request: created }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      fail(res, 409, 'A connection request already exists between you and this student.', 'ALREADY_EXISTS'); return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      fail(res, 409, 'The roommate request changed at the same time. Refresh and try again.', 'CONFLICT'); return
    }
    throw error
  }
  if (result.kind === 'discovery_disabled') { fail(res, 403, 'Enable roommate discovery before sending connection requests.', 'DISCOVERY_DISABLED'); return }
  if (result.kind === 'unavailable') { fail(res, 404, 'This roommate is unavailable.', 'NOT_FOUND'); return }
  if (result.kind === 'duplicate') { fail(res, 409, 'A connection request already exists between you and this student.', 'ALREADY_EXISTS'); return }
  if (result.kind === 'rate_limited') { fail(res, 429, 'Please wait before sending more connection requests.', 'RATE_LIMITED'); return }
  await queueConnectionEmail(recipientId, 'New roommate connection request', 'A student would like to connect with you. Sign in to accept or decline.')
  ok(res, result.request, 201)
}))

router.patch('/roommates/requests/:id', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const parsed = z.object({ status: z.enum(['ACCEPTED', 'DECLINED']) }).safeParse(req.body)
  if (!parsed.success) { fail(res, 400, 'Choose Accept or Decline.', 'VALIDATION_ERROR'); return }
  if (parsed.data.status === 'ACCEPTED' && !verified(user, res)) return
  const request = await prisma.connectionRequest.findUnique({ where: { id: req.params.id } })
  if (!request || request.recipientId !== user.id) { fail(res, 404, 'This incoming request could not be found.', 'NOT_FOUND'); return }
  if (parsed.data.status === 'ACCEPTED') {
    const sender = await prisma.user.findUnique({ where: { id: request.senderId }, select: { roles: true, studentVerified: true, studentVerifiedUntil: true, emailVerifiedAt: true, status: true } })
    if (!sender?.roles.includes('STUDENT') || !studentVerificationIsCurrent(sender) || !sender.emailVerifiedAt || sender.status !== 'ACTIVE') { fail(res, 404, 'This roommate is unavailable.', 'NOT_FOUND'); return }
  }
  const blocked = await prisma.userBlock.findFirst({ where: { OR: [
    { blockerId: user.id, blockedId: request.senderId },
    { blockerId: request.senderId, blockedId: user.id },
  ] } })
  if (blocked) { fail(res, 403, 'This connection is blocked.', 'BLOCKED'); return }
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.connectionRequest.updateMany({ where: { id: request.id, recipientId: user.id, status: 'PENDING' }, data: { status: parsed.data.status } })
    if (!result.count) return null
    const value = await tx.connectionRequest.findUniqueOrThrow({ where: { id: request.id } })
    await tx.notification.create({ data: {
      userId: value.senderId, type: 'ROOMMATE_CONNECTION_RESPONSE',
      payload: { requestId: value.id, recipientId: user.id, status: value.status },
    } })
    return value
  })
  if (!updated) { fail(res, 409, 'This request has already been answered.', 'ALREADY_ANSWERED'); return }
  await queueConnectionEmail(updated.senderId, 'Roommate request update', `Your roommate connection request was ${updated.status.toLowerCase()}.`)
  ok(res, updated)
}))

router.post('/roommates/blocks', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const parsed = z.object({ blockedUserId: z.string().uuid() }).safeParse(req.body)
  if (!parsed.success || parsed.data.blockedUserId === user.id) { fail(res, 400, 'Select a valid student to block.', 'VALIDATION_ERROR'); return }
  const target = await prisma.user.findUnique({ where: { id: parsed.data.blockedUserId } })
  if (!target) { fail(res, 404, 'This student could not be found.', 'NOT_FOUND'); return }
  await prisma.$transaction(async tx => {
    await lockConnectionPair(tx, user.id, target.id)
    await tx.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: target.id } },
      create: { blockerId: user.id, blockedId: target.id }, update: {},
    })
    await tx.connectionRequest.updateMany({
      where: { status: 'PENDING', OR: [
        { senderId: user.id, recipientId: target.id },
        { senderId: target.id, recipientId: user.id },
      ] },
      data: { status: 'DECLINED' },
    })
  })
  ok(res, { blocked: true }, 201)
}))

router.get('/roommates/blocks', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const pagination = paginationSchema.safeParse(req.query)
  if (!pagination.success) { fail(res, 400, 'Choose a valid page and page size.', 'VALIDATION_ERROR'); return }
  const { page, limit } = pagination.data
  const [total, blocks] = await Promise.all([
    prisma.userBlock.count({ where: { blockerId: user.id } }),
    prisma.userBlock.findMany({
      where: { blockerId: user.id },
      include: { blocked: { select: { id: true, roommateProfile: { select: { displayName: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { blockedId: 'desc' }], skip: (page - 1) * limit, take: limit,
    }),
  ])
  ok(res, { items: blocks.map(block => ({
    userId: block.blocked.id,
    displayName: block.blocked.roommateProfile?.displayName || 'Student',
    blockedAt: block.createdAt,
  })), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.delete('/roommates/blocks/:id', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  const parsed = z.string().uuid().safeParse(req.params.id)
  if (!parsed.success) { fail(res, 400, 'Select a valid blocked student.', 'VALIDATION_ERROR'); return }
  await prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: parsed.data } })
  ok(res, { unblocked: true })
}))

router.get('/roommates/:id', studentOnly, route(async (req, res) => {
  const user = currentUser(req)!
  if (!verified(user, res)) return
  const matches = await matchesFor(user.id)
  if (!matches) { fail(res, 403, 'Enable roommate discovery in your profile before viewing matches.', 'DISCOVERY_DISABLED'); return }
  const match = matches.find(item => item.id === req.params.id)
  if (!match) { fail(res, 404, 'This roommate profile is unavailable.', 'NOT_FOUND'); return }
  ok(res, match)
}))

export default router
