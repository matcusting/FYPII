import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireAuth, requireEmailVerified } from '../core/auth.js'
import { fail, ok } from '../core/http.js'
import { queueEmail } from '../core/mail.js'

const router = Router()
const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next) }

const inquirySchema = z.object({ message: z.string().trim().min(10).max(2000) })
const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) })
const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(20).max(2000),
  experienceDescription: z.string().trim().min(10).max(500),
  experienceProofKey: z.string().min(1).max(256),
})
const responseSchema = z.object({ body: z.string().trim().min(3).max(1000) })
const reportSchema = z.object({
  targetType: z.enum(['LISTING', 'USER', 'REVIEW']),
  targetId: z.string().min(1).max(100),
  category: z.enum(['FRAUD', 'INACCURATE', 'HARASSMENT', 'PERSONAL_DATA', 'FABRICATED', 'OTHER']).default('OTHER'),
  reason: z.string().trim().min(10).max(1000),
})

function pageOf(req: Request) {
  const page = Math.min(10000, Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1))
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

function participant(userId: string, record: { senderId: string; recipientId: string }) {
  return record.senderId === userId || record.recipientId === userId
}

async function queueOptionalEmail(recipientId: string, preference: 'emailInquiryUpdates' | 'emailConnectionRequests', subject: string, body: string, actionUrl: string) {
  try {
    const [recipient, settings] = await Promise.all([
      prisma.user.findUnique({ where: { id: recipientId }, select: { email: true } }),
      prisma.notificationPreference.findUnique({ where: { userId: recipientId } }),
    ])
    if (recipient && settings?.[preference] !== false) await queueEmail(recipient.email, subject, 'notification', { body, actionUrl })
  } catch {
    // In-app notification already exists; delivery problems must not undo the core action.
  }
}

function formatReview(review: {
  id: string; listingId: string; authorId: string; rating: number; body: string;
  status: string; ownerResponse: string | null; createdAt: Date; updatedAt: Date
}, people: Map<string, string>, listings: Map<string, string>) {
  return {
    id: review.id, listingId: review.listingId, rating: review.rating, body: review.body,
    status: review.status, moderationStatus: review.status, ownerResponse: review.ownerResponse,
    author: { name: people.get(review.authorId) || 'Student' },
    listing: { id: review.listingId, title: listings.get(review.listingId) || 'Property' },
    createdAt: review.createdAt, updatedAt: review.updatedAt,
  }
}

async function reviewNames<T extends { authorId: string; listingId: string }>(reviews: T[]) {
  const [authors, listings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(reviews.map(review => review.authorId))] } }, select: { id: true, name: true } }),
    prisma.listing.findMany({ where: { id: { in: [...new Set(reviews.map(review => review.listingId))] } }, select: { id: true, title: true } }),
  ])
  return {
    people: new Map(authors.map(author => [author.id, author.name])),
    listings: new Map(listings.map(listing => [listing.id, listing.title])),
  }
}

// Initial inquiries are persisted as the first message in a private, two-party thread.
router.post('/listings/:listingId/inquiries', requireAuth, requireEmailVerified, asyncRoute(async (req, res) => {
  const user = currentUser(req)
  if (!user) return fail(res, 401, 'Sign in to contact a property owner.', 'UNAUTHORIZED')
  if (!user.roles.includes('STUDENT')) return fail(res, 403, 'Only student accounts can send property inquiries.', 'FORBIDDEN')
  const parsed = inquirySchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Write an inquiry between 10 and 2,000 characters.', 'VALIDATION_ERROR')
  const listing = await prisma.listing.findUnique({ where: { id: String(req.params.listingId) }, select: { id: true, title: true, ownerId: true, status: true } })
  if (!listing || listing.status !== 'PUBLISHED') return fail(res, 404, 'This property is not available for inquiries.', 'NOT_FOUND')
  if (listing.ownerId === user.id) return fail(res, 400, 'You cannot inquire about your own property.', 'SELF_INQUIRY')
  const recent = await prisma.inquiry.count({ where: { senderId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
  if (recent >= 10) return fail(res, 429, 'Please wait before sending more property inquiries.', 'RATE_LIMITED')
  const inquiry = await prisma.$transaction(async tx => {
    const created = await tx.inquiry.create({ data: { listingId: listing.id, senderId: user.id, recipientId: listing.ownerId, message: parsed.data.message } })
    await tx.inquiryMessage.create({ data: { inquiryId: created.id, senderId: user.id, body: parsed.data.message } })
    await tx.notification.create({ data: { userId: listing.ownerId, type: 'INQUIRY_RECEIVED', payload: { inquiryId: created.id, listingId: listing.id } } })
    return created
  })
  await queueOptionalEmail(listing.ownerId, 'emailInquiryUpdates', 'New property inquiry', `A student asked about ${listing.title}. Sign in to read and reply.`, '/requests')
  return ok(res, inquiry, 201)
}))

router.get('/inquiries', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const { page, limit, skip } = pageOf(req)
  const where = { OR: [{ senderId: user.id }, { recipientId: user.id }] }
  const [records, total] = await Promise.all([
    prisma.inquiry.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: limit }),
    prisma.inquiry.count({ where }),
  ])
  const listingIds = [...new Set(records.map(record => record.listingId))]
  const personIds = [...new Set(records.flatMap(record => [record.senderId, record.recipientId]))]
  const [listings, people] = await Promise.all([
    prisma.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true } }),
    prisma.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } }),
  ])
  const titles = new Map(listings.map(listing => [listing.id, listing.title]))
  const names = new Map(people.map(person => [person.id, person.name]))
  const items = records.map(record => ({
    ...record,
    listing: { id: record.listingId, title: titles.get(record.listingId) || 'Property' },
    sender: { id: record.senderId, name: names.get(record.senderId) || 'Student' },
    recipient: { id: record.recipientId, name: names.get(record.recipientId) || 'Landlord' },
  }))
  return ok(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.get('/inquiries/:inquiryId/messages', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const inquiry = await prisma.inquiry.findUnique({ where: { id: String(req.params.inquiryId) } })
  if (!inquiry || !participant(user.id, inquiry)) return fail(res, 404, 'Conversation not found.', 'NOT_FOUND')
  const { page, limit, skip } = pageOf(req)
  const [items, total] = await Promise.all([
    prisma.inquiryMessage.findMany({ where: { inquiryId: inquiry.id }, select: { id: true, senderId: true, body: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: limit }),
    prisma.inquiryMessage.count({ where: { inquiryId: inquiry.id } }),
  ])
  return ok(res, { items: items.reverse(), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.post('/inquiries/:inquiryId/messages', requireAuth, requireEmailVerified, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const parsed = messageSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Write a message between 1 and 2,000 characters.', 'VALIDATION_ERROR')
  const inquiry = await prisma.inquiry.findUnique({ where: { id: String(req.params.inquiryId) } })
  if (!inquiry || !participant(user.id, inquiry)) return fail(res, 404, 'Conversation not found.', 'NOT_FOUND')
  if (inquiry.status !== 'OPEN') return fail(res, 409, 'This conversation is closed.', 'CONVERSATION_CLOSED')
  const sentLastHour = await prisma.inquiryMessage.count({ where: { senderId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
  if (sentLastHour >= 30) return fail(res, 429, 'Please wait before sending more messages.', 'RATE_LIMITED')
  const recipientId = inquiry.senderId === user.id ? inquiry.recipientId : inquiry.senderId
  const message = await prisma.$transaction(async tx => {
    const created = await tx.inquiryMessage.create({ data: { inquiryId: inquiry.id, senderId: user.id, body: parsed.data.body } })
    await tx.inquiry.update({ where: { id: inquiry.id }, data: { updatedAt: new Date() } })
    await tx.notification.create({ data: { userId: recipientId, type: 'INQUIRY_REPLY', payload: { inquiryId: inquiry.id, messageId: created.id } } })
    return created
  })
  await queueOptionalEmail(recipientId, 'emailInquiryUpdates', 'New property inquiry reply', 'You have a new reply in your property conversation.', '/requests')
  return ok(res, { id: message.id, senderId: message.senderId, body: message.body, createdAt: message.createdAt }, 201)
}))

// Roommate messages become available only after a connection request is accepted.
router.get('/roommates/requests/:requestId/messages', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const connection = await prisma.connectionRequest.findUnique({ where: { id: String(req.params.requestId) } })
  if (!connection || !participant(user.id, connection)) return fail(res, 404, 'Conversation not found.', 'NOT_FOUND')
  if (connection.status !== 'ACCEPTED') return fail(res, 403, 'Both students must agree before messaging.', 'CONSENT_REQUIRED')
  const otherId = connection.senderId === user.id ? connection.recipientId : connection.senderId
  const blocked = await prisma.userBlock.findFirst({ where: { OR: [
    { blockerId: user.id, blockedId: otherId }, { blockerId: otherId, blockedId: user.id },
  ] } })
  if (blocked) return fail(res, 403, 'Messaging is unavailable because a student has blocked this connection.', 'BLOCKED')
  const { page, limit, skip } = pageOf(req)
  const [items, total] = await Promise.all([
    prisma.connectionMessage.findMany({ where: { requestId: connection.id }, select: { id: true, senderId: true, body: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: limit }),
    prisma.connectionMessage.count({ where: { requestId: connection.id } }),
  ])
  return ok(res, { items: items.reverse(), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.post('/roommates/requests/:requestId/messages', requireAuth, requireEmailVerified, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const parsed = messageSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Write a message between 1 and 2,000 characters.', 'VALIDATION_ERROR')
  const connection = await prisma.connectionRequest.findUnique({ where: { id: String(req.params.requestId) } })
  if (!connection || !participant(user.id, connection)) return fail(res, 404, 'Conversation not found.', 'NOT_FOUND')
  if (connection.status !== 'ACCEPTED') return fail(res, 403, 'Both students must agree before messaging.', 'CONSENT_REQUIRED')
  const recipientId = connection.senderId === user.id ? connection.recipientId : connection.senderId
  const blocked = await prisma.userBlock.findFirst({ where: { OR: [
    { blockerId: user.id, blockedId: recipientId }, { blockerId: recipientId, blockedId: user.id },
  ] } })
  if (blocked) return fail(res, 403, 'Messaging is unavailable because a student has blocked this connection.', 'BLOCKED')
  const sentLastHour = await prisma.connectionMessage.count({ where: { senderId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
  if (sentLastHour >= 30) return fail(res, 429, 'Please wait before sending more messages.', 'RATE_LIMITED')
  const message = await prisma.$transaction(async tx => {
    const created = await tx.connectionMessage.create({ data: { requestId: connection.id, senderId: user.id, body: parsed.data.body } })
    await tx.notification.create({ data: { userId: recipientId, type: 'ROOMMATE_MESSAGE', payload: { requestId: connection.id, messageId: created.id } } })
    return created
  })
  await queueOptionalEmail(recipientId, 'emailConnectionRequests', 'New roommate message', 'You have a new message from a roommate connection.', '/requests')
  return ok(res, { id: message.id, senderId: message.senderId, body: message.body, createdAt: message.createdAt }, 201)
}))

// Public review lists never expose private rental-proof keys or descriptions.
router.get('/listings/:listingId/reviews', asyncRoute(async (req, res) => {
  const listingId = String(req.params.listingId)
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, ownerId: true, status: true } })
  const viewer = currentUser(req)
  if (!listing || (listing.status !== 'PUBLISHED' && listing.ownerId !== viewer?.id && !viewer?.roles.includes('ADMIN'))) return fail(res, 404, 'Property not found.', 'NOT_FOUND')
  const { page, limit, skip } = pageOf(req)
  const where = { listingId, status: 'APPROVED' as const, active: true }
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.review.count({ where }),
  ])
  const names = await reviewNames(reviews)
  return ok(res, { items: reviews.map(review => formatReview(review, names.people, names.listings)), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.get('/reviews/mine', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const { page, limit, skip } = pageOf(req)
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where: { authorId: user.id }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.review.count({ where: { authorId: user.id } }),
  ])
  const names = await reviewNames(reviews)
  return ok(res, { items: reviews.map(review => ({
    ...formatReview(review, names.people, names.listings),
    experienceProofStatus: review.experienceProofStatus,
    experienceDescription: review.experienceDescription,
    revision: review.revision,
  })), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.post('/listings/:listingId/reviews', requireAuth, requireEmailVerified, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  if (!user.roles.includes('STUDENT') || !user.studentVerified) return fail(res, 403, 'Only verified students can submit rental reviews.', 'VERIFICATION_REQUIRED')
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a rating, a written review, rental experience details and proof of that experience.', 'VALIDATION_ERROR')
  const listingId = String(req.params.listingId)
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, ownerId: true, status: true } })
  if (!listing || listing.status !== 'PUBLISHED') return fail(res, 404, 'Property not found.', 'NOT_FOUND')
  if (listing.ownerId === user.id) return fail(res, 403, 'You cannot review your own property.', 'FORBIDDEN')
  const proof = await prisma.mediaUpload.findFirst({ where: {
    storageKey: parsed.data.experienceProofKey, ownerId: user.id, purpose: 'REVIEW_EVIDENCE', status: 'UPLOADED',
  } })
  if (!proof) return fail(res, 400, 'Upload a valid private document showing your rental experience.', 'EVIDENCE_REQUIRED')
  const proofAlreadyUsed = await prisma.review.findFirst({ where: { experienceProofKey: parsed.data.experienceProofKey } })
  if (proofAlreadyUsed) return fail(res, 409, 'This proof document was already used for a review.', 'EVIDENCE_ALREADY_USED')
  const existing = await prisma.review.findUnique({ where: { authorId_listingId_experienceKey: { authorId: user.id, listingId, experienceKey: 'primary' } } })
  if (existing) return fail(res, 409, 'You already submitted a review for this rental experience. Edit that review instead.', 'REVIEW_EXISTS')
  const review = await prisma.$transaction(async tx => {
    const created = await tx.review.create({ data: {
      listingId, landlordId: listing.ownerId, authorId: user.id,
      rating: parsed.data.rating, body: parsed.data.body,
      experienceDescription: parsed.data.experienceDescription, experienceProofKey: parsed.data.experienceProofKey,
      experienceProofStatus: 'PENDING', status: 'PENDING', experienceKey: 'primary',
    } })
    await tx.notification.create({ data: { userId: listing.ownerId, type: 'REVIEW_SUBMITTED', payload: { listingId, reviewId: created.id } } })
    return created
  })
  return ok(res, { id: review.id, status: review.status, createdAt: review.createdAt }, 201)
}))

router.patch('/listings/:listingId/reviews/:reviewId', requireAuth, requireEmailVerified, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Enter a rating, written review, rental experience details and proof.', 'VALIDATION_ERROR')
  const review = await prisma.review.findUnique({ where: { id: String(req.params.reviewId) } })
  if (!review || review.listingId !== String(req.params.listingId) || review.authorId !== user.id) return fail(res, 404, 'Review not found.', 'NOT_FOUND')
  if (!review.active) return fail(res, 409, 'This review is no longer active.', 'REVIEW_INACTIVE')
  const proof = await prisma.mediaUpload.findFirst({ where: { storageKey: parsed.data.experienceProofKey, ownerId: user.id, purpose: 'REVIEW_EVIDENCE', status: 'UPLOADED' } })
  if (!proof) return fail(res, 400, 'Upload a valid private document showing your rental experience.', 'EVIDENCE_REQUIRED')
  const proofAlreadyUsed = await prisma.review.findFirst({ where: { experienceProofKey: parsed.data.experienceProofKey, id: { not: review.id } } })
  if (proofAlreadyUsed) return fail(res, 409, 'This proof document was already used for a different review.', 'EVIDENCE_ALREADY_USED')
  const updated = await prisma.$transaction(async tx => {
    await tx.reviewRevision.create({ data: { reviewId: review.id, editorId: user.id, rating: review.rating, body: review.body } })
    await tx.auditLog.create({ data: {
      actorId: user.id, action: 'REVIEW_EDIT', targetType: 'REVIEW', targetId: review.id,
      before: { rating: review.rating, body: review.body, experienceDescription: review.experienceDescription, experienceProofKey: review.experienceProofKey, status: review.status },
      after: { rating: parsed.data.rating, body: parsed.data.body, experienceDescription: parsed.data.experienceDescription, experienceProofKey: parsed.data.experienceProofKey, status: 'PENDING' },
    } })
    return tx.review.update({ where: { id: review.id }, data: {
      rating: parsed.data.rating, body: parsed.data.body, experienceDescription: parsed.data.experienceDescription,
      experienceProofKey: parsed.data.experienceProofKey, experienceProofStatus: 'PENDING', status: 'PENDING',
      ownerResponse: null, ownerRespondedAt: null, revision: { increment: 1 },
    } })
  })
  return ok(res, { id: updated.id, status: updated.status, updatedAt: updated.updatedAt })
}))

router.post('/listings/:listingId/reviews/:reviewId/response', requireAuth, requireEmailVerified, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const parsed = responseSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Write a response between 3 and 1,000 characters.', 'VALIDATION_ERROR')
  const [listing, review] = await Promise.all([
    prisma.listing.findUnique({ where: { id: String(req.params.listingId) }, select: { ownerId: true } }),
    prisma.review.findUnique({ where: { id: String(req.params.reviewId) } }),
  ])
  if (!listing || !review || review.listingId !== String(req.params.listingId)) return fail(res, 404, 'Review not found.', 'NOT_FOUND')
  if (listing.ownerId !== user.id) return fail(res, 403, 'Only the property owner can respond to this review.', 'FORBIDDEN')
  if (review.status !== 'APPROVED') return fail(res, 409, 'Only approved reviews can receive a public owner response.', 'REVIEW_NOT_APPROVED')
  const result = await prisma.review.updateMany({
    where: { id: review.id, listingId: String(req.params.listingId), status: 'APPROVED', ownerResponse: null },
    data: { ownerResponse: parsed.data.body, ownerRespondedAt: new Date() },
  })
  if (!result.count) return fail(res, 409, 'The owner has already responded to this review.', 'RESPONSE_EXISTS')
  const updated = await prisma.review.findUniqueOrThrow({ where: { id: review.id } })
  return ok(res, { id: updated.id, ownerResponse: updated.ownerResponse, ownerRespondedAt: updated.ownerRespondedAt })
}))

router.post('/reports', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const parsed = reportSchema.safeParse(req.body)
  if (!parsed.success) return fail(res, 400, 'Choose a target and describe the issue in 10 to 1,000 characters.', 'VALIDATION_ERROR')
  const { targetType, targetId, category, reason } = parsed.data
  const exists = targetType === 'LISTING' ? !!(await prisma.listing.findFirst({ where: { id: targetId, OR: [{ status: 'PUBLISHED' }, { ownerId: user.id }] }, select: { id: true } }))
    : targetType === 'USER' ? !!(await prisma.user.findFirst({ where: { id: targetId, status: 'ACTIVE' }, select: { id: true } }))
      : !!(await prisma.review.findFirst({ where: { id: targetId, OR: [{ status: 'APPROVED', active: true }, { authorId: user.id }, { listing: { ownerId: user.id } }] }, select: { id: true } }))
  if (!exists) return fail(res, 404, 'The content you want to report could not be found.', 'NOT_FOUND')
  const recent = await prisma.report.count({ where: { reporterId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } })
  if (recent >= 10) return fail(res, 429, 'Please wait before submitting more reports.', 'RATE_LIMITED')
  const duplicate = await prisma.report.findFirst({ where: { reporterId: user.id, targetType, targetId, status: 'OPEN' } })
  if (duplicate) return fail(res, 409, 'You have already reported this item. It is awaiting review.', 'REPORT_EXISTS')
  const report = await prisma.report.create({ data: { reporterId: user.id, targetType, targetId, category, reason } })
  return ok(res, { id: report.id, status: report.status, createdAt: report.createdAt }, 201)
}))

router.get('/reports/mine', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const { page, limit, skip } = pageOf(req)
  const where = { reporterId: user.id }
  const [items, total] = await Promise.all([
    prisma.report.findMany({ where, select: { id: true, targetType: true, targetId: true, category: true, reason: true, status: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.report.count({ where }),
  ])
  return ok(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.get('/notifications', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const { page, limit, skip } = pageOf(req)
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, select: { id: true, type: true, payload: true, readAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.notification.count({ where: { userId: user.id } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ])
  return ok(res, { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit, unreadCount })
}))

router.patch('/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const result = await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })
  return ok(res, { updated: result.count })
}))

router.patch('/notifications/:notificationId/read', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const id = String(req.params.notificationId)
  const result = await prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } })
  if (!result.count) {
    const existing = await prisma.notification.findFirst({ where: { id, userId: user.id } })
    if (!existing) return fail(res, 404, 'Notification not found.', 'NOT_FOUND')
  }
  const notification = await prisma.notification.findUnique({ where: { id }, select: { id: true, type: true, payload: true, readAt: true, createdAt: true } })
  return ok(res, notification)
}))

export default router
