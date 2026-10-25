import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { AccountStatus, ListingStatus, ReportStatus, ReviewStatus, VerificationStatus, type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireRole } from '../core/auth.js'
import { fail, ok } from '../core/http.js'
import { uploadMetadata } from '../storage/listings.js'
import { verificationProofDirectory } from './verifications.js'

const router = Router()
router.use(requireRole('ADMIN'))

type ModerationKind = 'verifications' | 'listings' | 'reviews' | 'reports' | 'accounts'
const moderationKinds: ModerationKind[] = ['verifications', 'listings', 'reviews', 'reports', 'accounts']
const campusSchema = z.object({
  name: z.string().trim().min(1).max(120),
  university: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/).refine(domain => domain.split('.').every(label => !label.startsWith('-') && !label.endsWith('-')))).max(30),
  active: z.boolean(),
})
const decisionSchema = z.object({ status: z.string(), reason: z.string().trim().max(1000).default('') })
const queueStatuses: Record<ModerationKind, readonly string[]> = {
  verifications: ['UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED'],
  listings: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'PAUSED', 'RENTED', 'ARCHIVED'],
  reviews: ['PENDING', 'APPROVED', 'REJECTED'],
  reports: ['OPEN', 'RESOLVED', 'DISMISSED'],
  accounts: ['ACTIVE', 'SUSPENDED', 'DELETED'],
}
const accountSelect = { id: true, name: true, email: true, roles: true, emailVerifiedAt: true, studentVerified: true, verificationStatus: true, status: true, createdAt: true, updatedAt: true } as const
const personSelect = { id: true, name: true, email: true } as const

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next) }
}

function pageOf(req: Request) {
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1)
  return Math.min(page, 100_000)
}

function statusOf(req: Request): string {
  return typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : ''
}

function accountOf(row: {
  id: string; name: string; email: string; roles: unknown; emailVerifiedAt: Date | null;
  studentVerified: boolean; verificationStatus: unknown; status: unknown; createdAt: Date; updatedAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles,
    emailVerified: Boolean(row.emailVerifiedAt),
    studentVerified: row.studentVerified,
    verificationStatus: row.verificationStatus,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function verificationOf(row: {
  id: string; userId: string; method: unknown; university: string; note: string | null; status: unknown;
  reason: string | null; reviewedAt: Date | null; reviewedById: string | null; createdAt: Date;
  proofKey: string | null; user: { id: string; name: string; email: string }
}, detail = false) {
  return {
    id: row.id, userId: row.userId, student: row.user, university: row.university,
    verificationMethod: row.method, note: row.note, status: row.status, moderationReason: row.reason,
    reviewedAt: row.reviewedAt, reviewedById: row.reviewedById, createdAt: row.createdAt,
    ...(detail && row.proofKey ? { proofUrl: `/api/v1/admin/verifications/${row.id}/proof` } : {}),
  }
}

function listingOf(row: {
  id: string; photos: Array<{ id: string; storageKey: string }>;
  owner: { id: string; name: string; email: string }; campus: { name: string };
  [key: string]: unknown
}) {
  const { latitude: _latitude, longitude: _longitude, ...listing } = row
  return {
    ...listing,
    campusName: row.campus.name,
    photos: row.photos.map(photo => ({ id: photo.id, url: `/api/v1/media/${encodeURIComponent(photo.storageKey)}`, alt: 'Property photo' })),
  }
}

function reviewOf(row: {
  id: string; experienceProofKey: string | null; author: { id: string; name: string; email: string };
  listing: { id: string; title: string }; [key: string]: unknown
}, detail = false) {
  return { ...row, ...(detail && row.experienceProofKey ? { proofUrl: `/api/v1/private-media/${encodeURIComponent(row.experienceProofKey)}` } : {}) }
}

async function audit(transaction: Prisma.TransactionClient, actorId: string, action: string, targetType: string, targetId: string, before: Prisma.InputJsonValue, after: Prisma.InputJsonValue) {
  await transaction.auditLog.create({ data: { actorId, action, targetType, targetId, before, after } })
}

async function notify(transaction: Prisma.TransactionClient, userId: string, email: string, type: string, title: string, message: string, targetId: string) {
  await transaction.notification.create({ data: { userId, type, payload: { title, message, targetId } } })
  await transaction.emailJob.create({ data: { to: email, subject: title, template: 'notification', payload: { body: message } } })
}

class ModerationConflict extends Error {}
class LastAdminConflict extends Error {}

async function atomicDecision<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T | null> {
  try { return await prisma.$transaction(work) }
  catch (error) {
    if (error instanceof ModerationConflict) return null
    throw error
  }
}

router.get('/overview', asyncRoute(async (_req, res) => {
  const [pendingVerifications, landlordAccounts, pendingListings, pendingReviews, openReports, pendingDeletionRequests] = await Promise.all([
    prisma.studentVerification.count({ where: { status: 'PENDING' } }),
    prisma.user.count({ where: { roles: { has: 'LANDLORD' }, status: 'ACTIVE' } }),
    prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.review.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: 'OPEN' } }),
    prisma.deletionRequest.count({ where: { status: 'PENDING' } }),
  ])
  ok(res, { pendingVerifications, landlordAccounts, pendingListings, pendingReviews, openReports, pendingDeletionRequests })
}))

router.get('/campuses', asyncRoute(async (_req, res) => {
  ok(res, { items: await prisma.campus.findMany({ orderBy: { name: 'asc' } }) })
}))

async function validateCampusDomains(domains: string[], excludeId?: string) {
  if (domains.length !== new Set(domains).size) return 'List each verification domain only once.'
  const campuses = await prisma.campus.findMany({ where: { active: true, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { domains: true } })
  if (domains.some(domain => campuses.some(campus => campus.domains.some(existing => existing.toLowerCase() === domain)))) return 'A verification domain is already assigned to another active campus.'
  return null
}

router.post('/campuses', asyncRoute(async (req, res) => {
  const parsed = campusSchema.safeParse(req.body)
  if (!parsed.success) return void fail(res, 400, 'Enter valid campus details, coordinates and email domains.', 'INVALID_CAMPUS')
  const domains = [...new Set(parsed.data.domains)]
  const conflict = parsed.data.active ? await validateCampusDomains(domains) : null
  if (conflict) return void fail(res, 409, conflict, 'DOMAIN_CONFLICT')
  const actorId = currentUser(req)!.id
  const campus = await prisma.$transaction(async transaction => {
    const created = await transaction.campus.create({ data: { ...parsed.data, domains, updatedById: actorId } })
    await audit(transaction, actorId, 'CAMPUS_CREATED', 'CAMPUS', created.id, {}, { name: created.name, university: created.university, domains: created.domains, active: created.active })
    return created
  })
  ok(res, campus, 201)
}))

router.patch('/campuses', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.body?.id)
  const parsed = campusSchema.safeParse(req.body)
  if (!id.success || !parsed.success) return void fail(res, 400, 'Enter valid campus details, coordinates and email domains.', 'INVALID_CAMPUS')
  const previous = await prisma.campus.findUnique({ where: { id: id.data } })
  if (!previous) return void fail(res, 404, 'This campus does not exist.', 'NOT_FOUND')
  const domains = [...new Set(parsed.data.domains)]
  const conflict = parsed.data.active ? await validateCampusDomains(domains, id.data) : null
  if (conflict) return void fail(res, 409, conflict, 'DOMAIN_CONFLICT')
  const actorId = currentUser(req)!.id
  const campus = await prisma.$transaction(async transaction => {
    const updated = await transaction.campus.update({ where: { id: id.data }, data: { ...parsed.data, domains, updatedById: actorId } })
    await audit(transaction, actorId, 'CAMPUS_UPDATED', 'CAMPUS', updated.id, { name: previous.name, university: previous.university, domains: previous.domains, active: previous.active }, { name: updated.name, university: updated.university, domains: updated.domains, active: updated.active })
    return updated
  })
  ok(res, campus)
}))

router.get('/verifications/:id/proof', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return void fail(res, 400, 'The verification ID is invalid.', 'INVALID_ID')
  const verification = await prisma.studentVerification.findUnique({ where: { id: id.data }, select: { proofKey: true, userId: true } })
  if (!verification?.proofKey || !/^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(verification.proofKey)) return void fail(res, 404, 'This verification proof is unavailable.', 'NOT_FOUND')
  const proof = await prisma.mediaUpload.findUnique({ where: { storageKey: verification.proofKey } })
  if (!proof || proof.ownerId !== verification.userId || proof.purpose !== 'VERIFICATION' || proof.status !== 'READY') return void fail(res, 404, 'This verification proof is unavailable.', 'NOT_FOUND')
  let bytes: Buffer
  try { bytes = await readFile(resolve(verificationProofDirectory(), verification.proofKey)) }
  catch { return void fail(res, 404, 'This verification proof is unavailable.', 'NOT_FOUND') }
  res.setHeader('Content-Type', proof.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="student-proof${proof.mimeType === 'application/pdf' ? '.pdf' : proof.mimeType === 'image/jpeg' ? '.jpg' : '.png'}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(bytes)
}))

router.get('/deletion-requests', asyncRoute(async (req, res) => {
  const page = pageOf(req)
  const requestedStatus = statusOf(req)
  if (requestedStatus && !['PENDING', 'APPROVED', 'REJECTED'].includes(requestedStatus)) return void fail(res, 400, 'Choose a valid deletion request status.', 'INVALID_STATUS')
  const where = requestedStatus ? { status: requestedStatus } : {}
  const [items, total] = await Promise.all([
    prisma.deletionRequest.findMany({ where, include: { user: { select: accountSelect } }, orderBy: { requestedAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
    prisma.deletionRequest.count({ where }),
  ])
  ok(res, { items: items.map(item => ({ ...item, user: accountOf(item.user) })), total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.patch('/deletion-requests/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const body = z.object({ status: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().min(3).max(1000) }).safeParse(req.body)
  if (!id.success || !body.success) return void fail(res, 400, 'Choose a decision and enter a reason of at least 3 characters.', 'INVALID_DECISION')
  const previous = await prisma.deletionRequest.findUnique({ where: { id: id.data }, include: { user: { select: accountSelect } } })
  if (!previous) return void fail(res, 404, 'This deletion request does not exist.', 'NOT_FOUND')
  if (previous.status !== 'PENDING') return void fail(res, 409, 'This deletion request has already been reviewed.', 'ALREADY_REVIEWED')
  const actorId = currentUser(req)!.id
  if (previous.userId === actorId) return void fail(res, 403, 'You cannot approve your own account deletion.', 'FORBIDDEN')
  if (body.data.status === 'APPROVED' && previous.user.roles.includes('ADMIN')) {
    const activeAdmins = await prisma.user.count({ where: { status: 'ACTIVE', roles: { has: 'ADMIN' } } })
    if (activeAdmins <= 1) return void fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
  }
  const result = await atomicDecision(async transaction => {
    if (body.data.status === 'APPROVED' && previous.user.roles.includes('ADMIN')) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(31415926)`
      const activeAdmins = await transaction.user.count({ where: { status: 'ACTIVE', roles: { has: 'ADMIN' } } })
      if (activeAdmins <= 1) throw new LastAdminConflict()
    }
    const updated = await transaction.deletionRequest.updateMany({ where: { id: id.data, status: 'PENDING' }, data: { status: body.data.status } })
    if (!updated.count) throw new ModerationConflict()
    const changed = await transaction.deletionRequest.findUniqueOrThrow({ where: { id: id.data } })
    if (body.data.status === 'APPROVED') {
      await transaction.session.updateMany({ where: { userId: previous.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      await transaction.authToken.deleteMany({ where: { userId: previous.userId } })
      await transaction.listing.updateMany({ where: { ownerId: previous.userId }, data: { status: 'ARCHIVED', showExactLocation: false, latitude: null, longitude: null, address: null } })
      await transaction.roommateProfile.deleteMany({ where: { userId: previous.userId } })
      await transaction.profile.deleteMany({ where: { userId: previous.userId } })
      await transaction.user.update({ where: { id: previous.userId }, data: { status: 'DELETED', name: 'Deleted account', email: `deleted-${previous.userId}@invalid.local`, passwordHash: randomBytes(48).toString('hex'), emailVerifiedAt: null, studentVerified: false } })
    } else {
      await notify(transaction, previous.userId, previous.user.email, 'DELETION_REQUEST', 'Account deletion request rejected', `Your account deletion request was rejected: ${body.data.reason}`, changed.id)
    }
    await audit(transaction, actorId, `DELETION_REQUEST_${body.data.status}`, 'DELETION_REQUEST', changed.id, { status: previous.status }, { status: changed.status, reason: body.data.reason })
    return changed
  }).catch(error => error instanceof LastAdminConflict ? 'LAST_ADMIN' as const : Promise.reject(error))
  if (result === 'LAST_ADMIN') return void fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
  if (!result) return void fail(res, 409, 'This deletion request has already been reviewed.', 'ALREADY_REVIEWED')
  ok(res, { id: result.id, status: result.status, requestedAt: result.requestedAt })
}))

router.get('/audit-logs', asyncRoute(async (req, res) => {
  const page = pageOf(req)
  const targetType = typeof req.query.targetType === 'string' ? req.query.targetType.trim().toUpperCase() : ''
  const targetId = typeof req.query.targetId === 'string' ? req.query.targetId.trim() : ''
  if (targetType.length > 64 || (targetId && !z.string().uuid().safeParse(targetId).success)) return void fail(res, 400, 'Choose a valid audit filter.', 'INVALID_FILTER')
  const where = { ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) }
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: personSelect } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
    prisma.auditLog.count({ where }),
  ])
  ok(res, { items, total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.get('/:kind', asyncRoute(async (req, res) => {
  const kind = req.params.kind as ModerationKind
  if (!moderationKinds.includes(kind)) return void fail(res, 404, 'This admin queue does not exist.', 'NOT_FOUND')
  const page = pageOf(req)
  const requestedStatus = statusOf(req)
  if (requestedStatus && !queueStatuses[kind].includes(requestedStatus)) return void fail(res, 400, 'Choose a valid queue status.', 'INVALID_STATUS')
  const skip = (page - 1) * 20
  const take = 20
  let items: unknown[] = []
  let total = 0
  if (kind === 'verifications') {
    const where = requestedStatus ? { status: requestedStatus as VerificationStatus } : {}
    const [rows, count] = await Promise.all([prisma.studentVerification.findMany({ where, include: { user: { select: personSelect } }, orderBy: { createdAt: 'desc' }, skip, take }), prisma.studentVerification.count({ where })])
    items = rows.map(row => verificationOf(row)); total = count
  } else if (kind === 'listings') {
    const where = requestedStatus ? { status: requestedStatus as ListingStatus } : {}
    const [rows, count] = await Promise.all([prisma.listing.findMany({ where, include: { owner: { select: personSelect }, campus: { select: { name: true } }, photos: true }, orderBy: { createdAt: 'desc' }, skip, take }), prisma.listing.count({ where })])
    items = rows.map(row => listingOf(row)); total = count
  } else if (kind === 'reviews') {
    const where = requestedStatus ? { status: requestedStatus as ReviewStatus } : {}
    const [rows, count] = await Promise.all([prisma.review.findMany({ where, include: { author: { select: personSelect }, listing: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, skip, take }), prisma.review.count({ where })])
    items = rows.map(row => reviewOf(row)); total = count
  } else if (kind === 'reports') {
    const where = requestedStatus ? { status: requestedStatus as ReportStatus } : {}
    const [rows, count] = await Promise.all([prisma.report.findMany({ where, include: { reporter: { select: personSelect } }, orderBy: { createdAt: 'desc' }, skip, take }), prisma.report.count({ where })])
    items = rows; total = count
  } else {
    const where = requestedStatus ? { status: requestedStatus as AccountStatus } : {}
    const [rows, count] = await Promise.all([prisma.user.findMany({ where, select: accountSelect, orderBy: { createdAt: 'desc' }, skip, take }), prisma.user.count({ where })])
    items = rows.map(accountOf); total = count
  }
  ok(res, { items, total, page, pages: Math.max(1, Math.ceil(total / take)) })
}))

router.get('/:kind/:id', asyncRoute(async (req, res) => {
  const kind = req.params.kind as ModerationKind
  const id = z.string().uuid().safeParse(req.params.id)
  if (!moderationKinds.includes(kind) || !id.success) return void fail(res, 404, 'This moderation record does not exist.', 'NOT_FOUND')
  if (kind === 'verifications') {
    const row = await prisma.studentVerification.findUnique({ where: { id: id.data }, include: { user: { select: personSelect } } })
    return void (row ? ok(res, verificationOf(row, true)) : fail(res, 404, 'This verification does not exist.', 'NOT_FOUND'))
  }
  if (kind === 'listings') {
    const row = await prisma.listing.findUnique({ where: { id: id.data }, include: { owner: { select: personSelect }, campus: { select: { name: true } }, photos: true } })
    return void (row ? ok(res, listingOf(row)) : fail(res, 404, 'This listing does not exist.', 'NOT_FOUND'))
  }
  if (kind === 'reviews') {
    const row = await prisma.review.findUnique({ where: { id: id.data }, include: { author: { select: personSelect }, listing: { select: { id: true, title: true } } } })
    return void (row ? ok(res, reviewOf(row, true)) : fail(res, 404, 'This review does not exist.', 'NOT_FOUND'))
  }
  if (kind === 'reports') {
    const row = await prisma.report.findUnique({ where: { id: id.data }, include: { reporter: { select: personSelect } } })
    return void (row ? ok(res, row) : fail(res, 404, 'This report does not exist.', 'NOT_FOUND'))
  }
  const row = await prisma.user.findUnique({ where: { id: id.data }, select: accountSelect })
  return void (row ? ok(res, accountOf(row)) : fail(res, 404, 'This account does not exist.', 'NOT_FOUND'))
}))

router.patch('/:kind/:id', asyncRoute(async (req, res) => {
  const kind = req.params.kind as ModerationKind
  const id = z.string().uuid().safeParse(req.params.id)
  const decision = decisionSchema.safeParse(req.body)
  if (!moderationKinds.includes(kind) || !id.success) return void fail(res, 404, 'This moderation record does not exist.', 'NOT_FOUND')
  if (!decision.success) return void fail(res, 400, 'Choose a valid decision and reason.', 'INVALID_DECISION')
  const { status, reason } = decision.data
  const actorId = currentUser(req)!.id
  if (reason.length < 3 && (status === 'REJECTED' || status === 'PAUSED' || status === 'SUSPENDED' || kind === 'reports')) return void fail(res, 400, 'Enter a reason of at least 3 characters.', 'REASON_REQUIRED')

  if (kind === 'verifications') {
    if (status !== 'APPROVED' && status !== 'REJECTED') return void fail(res, 400, 'Choose approve or reject for student verification.', 'INVALID_STATUS')
    const previous = await prisma.studentVerification.findUnique({ where: { id: id.data }, include: { user: { select: personSelect } } })
    if (!previous) return void fail(res, 404, 'This verification does not exist.', 'NOT_FOUND')
    if (previous.status !== 'PENDING') return void fail(res, 409, 'This verification has already been reviewed.', 'ALREADY_REVIEWED')
    if (status === 'APPROVED' && previous.method === 'MANUAL') {
      const proof = previous.proofKey && await prisma.mediaUpload.findUnique({ where: { storageKey: previous.proofKey } })
      const stored = proof ? await stat(resolve(verificationProofDirectory(), proof.storageKey)).catch(() => null) : null
      if (!proof || proof.ownerId !== previous.userId || proof.purpose !== 'VERIFICATION' || proof.status !== 'READY' || !stored?.isFile() || stored.size !== proof.size) return void fail(res, 400, 'Review a valid proof document before approving this student.', 'PROOF_REQUIRED')
    }
    const changed = await atomicDecision(async transaction => {
      const updated = await transaction.studentVerification.updateMany({ where: { id: id.data, status: 'PENDING' }, data: { status: status as VerificationStatus, reason: reason || null, reviewedById: actorId, reviewedAt: new Date() } })
      if (!updated.count) throw new ModerationConflict()
      const row = await transaction.studentVerification.findUniqueOrThrow({ where: { id: id.data } })
      await transaction.user.update({ where: { id: row.userId }, data: { studentVerified: status === 'APPROVED', verificationStatus: status as VerificationStatus } })
      await audit(transaction, actorId, `VERIFICATION_${status}`, 'STUDENT_VERIFICATION', row.id, { status: previous.status }, { status, reason })
      await notify(transaction, row.userId, previous.user.email, 'STUDENT_VERIFICATION', `Student verification ${status.toLowerCase()}`, status === 'APPROVED' ? 'Your student verification has been approved.' : `Your student verification was rejected: ${reason}`, row.id)
      return row
    })
    if (!changed) return void fail(res, 409, 'This verification has already been reviewed.', 'ALREADY_REVIEWED')
    return void ok(res, verificationOf({ ...changed, user: previous.user }, true))
  }

  if (kind === 'listings') {
    if (!['PUBLISHED', 'REJECTED', 'PAUSED'].includes(status)) return void fail(res, 400, 'Choose an available listing decision.', 'INVALID_STATUS')
    const previous = await prisma.listing.findUnique({ where: { id: id.data }, include: { owner: { select: personSelect }, campus: { select: { name: true } }, photos: true } })
    if (!previous) return void fail(res, 404, 'This listing does not exist.', 'NOT_FOUND')
    const permitted = (previous.status === 'PENDING_REVIEW' && ['PUBLISHED', 'REJECTED'].includes(status)) || (previous.status === 'PUBLISHED' && status === 'PAUSED') || (previous.status === 'PAUSED' && status === 'PUBLISHED')
    if (!permitted) return void fail(res, 409, 'Submit the listing for review before changing it to this status.', 'INVALID_TRANSITION')
    if (status === 'PUBLISHED' && !previous.photos.length) return void fail(res, 400, 'A property needs at least one photo before publication.', 'PHOTO_REQUIRED')
    if (status === 'PUBLISHED' && (!previous.address?.trim() || previous.address.trim().length < 10 || previous.address.trim().length > 250)) return void fail(res, 400, 'Enter the full property address before publishing.', 'ADDRESS_REQUIRED')
    const changed = await atomicDecision(async transaction => {
      const updated = await transaction.listing.updateMany({ where: { id: id.data, status: previous.status }, data: { status: status as ListingStatus, moderationReason: reason || null, reviewedAt: new Date() } })
      if (!updated.count) throw new ModerationConflict()
      const row = await transaction.listing.findUniqueOrThrow({ where: { id: id.data } })
      await audit(transaction, actorId, `LISTING_${status}`, 'LISTING', row.id, { status: previous.status }, { status, reason })
      await notify(transaction, row.ownerId, previous.owner.email, 'LISTING_MODERATION', `Listing ${status.toLowerCase()}`, status === 'PUBLISHED' ? `Your listing "${row.title}" is now published.` : `Your listing "${row.title}" was ${status.toLowerCase()}: ${reason}`, row.id)
      return row
    })
    if (!changed) return void fail(res, 409, 'This listing changed while it was being reviewed. Refresh the queue.', 'ALREADY_REVIEWED')
    return void ok(res, { id: changed.id, status: changed.status, moderationReason: changed.moderationReason })
  }

  if (kind === 'reviews') {
    if (status !== 'APPROVED' && status !== 'REJECTED') return void fail(res, 400, 'Choose approve or reject for the review.', 'INVALID_STATUS')
    const previous = await prisma.review.findUnique({ where: { id: id.data }, include: { author: { select: personSelect }, listing: { select: { id: true, title: true } } } })
    if (!previous) return void fail(res, 404, 'This review does not exist.', 'NOT_FOUND')
    if (previous.status !== 'PENDING') return void fail(res, 409, 'This review has already been moderated.', 'ALREADY_REVIEWED')
    if (status === 'APPROVED') {
      const proof = previous.experienceProofKey && await prisma.mediaUpload.findUnique({ where: { storageKey: previous.experienceProofKey } })
      const stored = proof && await uploadMetadata(proof.storageKey)
      if (!proof || proof.ownerId !== previous.authorId || proof.purpose !== 'REVIEW_EVIDENCE' || proof.status !== 'UPLOADED' || !stored || stored.ownerId !== previous.authorId || stored.purpose !== 'REVIEW_EVIDENCE' || stored.mimeType !== proof.mimeType || stored.size !== proof.size) return void fail(res, 400, 'Review a valid rental-experience proof before approving this review.', 'PROOF_REQUIRED')
    }
    const changed = await atomicDecision(async transaction => {
      const updated = await transaction.review.updateMany({ where: { id: id.data, status: 'PENDING' }, data: { status: status as ReviewStatus, experienceProofStatus: status === 'APPROVED' ? 'APPROVED' : 'REJECTED' } })
      if (!updated.count) throw new ModerationConflict()
      const row = await transaction.review.findUniqueOrThrow({ where: { id: id.data } })
      await audit(transaction, actorId, `REVIEW_${status}`, 'REVIEW', row.id, { status: previous.status, experienceProofStatus: previous.experienceProofStatus }, { status, reason, experienceProofStatus: row.experienceProofStatus })
      await notify(transaction, row.authorId, previous.author.email, 'REVIEW_MODERATION', `Review ${status.toLowerCase()}`, status === 'APPROVED' ? 'Your property review is now published.' : `Your property review was rejected: ${reason}`, row.id)
      return row
    })
    if (!changed) return void fail(res, 409, 'This review has already been moderated.', 'ALREADY_REVIEWED')
    return void ok(res, reviewOf({ ...changed, author: previous.author, listing: previous.listing }, true))
  }

  if (kind === 'reports') {
    if (status !== 'RESOLVED' && status !== 'DISMISSED') return void fail(res, 400, 'Choose resolve or dismiss for the report.', 'INVALID_STATUS')
    const previous = await prisma.report.findUnique({ where: { id: id.data }, include: { reporter: { select: personSelect } } })
    if (!previous) return void fail(res, 404, 'This report does not exist.', 'NOT_FOUND')
    if (previous.status !== 'OPEN') return void fail(res, 409, 'This report has already been reviewed.', 'ALREADY_REVIEWED')
    const changed = await atomicDecision(async transaction => {
      const updated = await transaction.report.updateMany({ where: { id: id.data, status: 'OPEN' }, data: { status: status as ReportStatus, moderationReason: reason, moderatedAt: new Date(), moderatedById: actorId } })
      if (!updated.count) throw new ModerationConflict()
      const row = await transaction.report.findUniqueOrThrow({ where: { id: id.data } })
      await audit(transaction, actorId, `REPORT_${status}`, 'REPORT', row.id, { status: previous.status }, { status, reason })
      await notify(transaction, row.reporterId, previous.reporter.email, 'REPORT_MODERATION', `Report ${status.toLowerCase()}`, status === 'RESOLVED' ? 'Your report has been reviewed and resolved.' : `Your report was dismissed: ${reason}`, row.id)
      return row
    })
    if (!changed) return void fail(res, 409, 'This report has already been reviewed.', 'ALREADY_REVIEWED')
    return void ok(res, changed)
  }

  if (status !== 'ACTIVE' && status !== 'SUSPENDED') return void fail(res, 400, 'Choose active or suspended for this account.', 'INVALID_STATUS')
  const previous = await prisma.user.findUnique({ where: { id: id.data }, select: accountSelect })
  if (!previous) return void fail(res, 404, 'This account does not exist.', 'NOT_FOUND')
  if (previous.status === 'DELETED') return void fail(res, 409, 'Deleted accounts cannot be restored here.', 'INVALID_TRANSITION')
  if (previous.status === status) return void fail(res, 409, 'This account already has that status.', 'UNCHANGED')
  if (status === 'SUSPENDED' && previous.id === actorId) return void fail(res, 403, 'You cannot suspend your own administrator account.', 'FORBIDDEN')
  if (status === 'SUSPENDED' && previous.roles.includes('ADMIN')) {
    const activeAdmins = await prisma.user.count({ where: { status: 'ACTIVE', roles: { has: 'ADMIN' } } })
    if (activeAdmins <= 1) return void fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
  }
  const changed = await atomicDecision(async transaction => {
    if (status === 'SUSPENDED' && previous.roles.includes('ADMIN')) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(31415926)`
      const activeAdmins = await transaction.user.count({ where: { status: 'ACTIVE', roles: { has: 'ADMIN' } } })
      if (activeAdmins <= 1) throw new LastAdminConflict()
    }
    const updated = await transaction.user.updateMany({ where: { id: id.data, status: previous.status }, data: { status: status as AccountStatus } })
    if (!updated.count) throw new ModerationConflict()
    const row = await transaction.user.findUniqueOrThrow({ where: { id: id.data } })
    if (status === 'SUSPENDED') {
      await transaction.session.updateMany({ where: { userId: row.id, revokedAt: null }, data: { revokedAt: new Date() } })
      await transaction.authToken.deleteMany({ where: { userId: row.id } })
    }
    await audit(transaction, actorId, `ACCOUNT_${status}`, 'USER', row.id, { status: previous.status }, { status, reason })
    await notify(transaction, row.id, row.email, 'ACCOUNT_MODERATION', `Account ${status.toLowerCase()}`, status === 'ACTIVE' ? 'Your account has been restored.' : `Your account was suspended: ${reason}`, row.id)
    return row
  }).catch(error => error instanceof LastAdminConflict ? 'LAST_ADMIN' as const : Promise.reject(error))
  if (changed === 'LAST_ADMIN') return void fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
  if (!changed) return void fail(res, 409, 'This account status changed while it was being reviewed. Refresh the queue.', 'ALREADY_REVIEWED')
  ok(res, accountOf(changed))
}))

export default router
