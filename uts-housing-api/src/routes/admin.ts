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
import { removeStoredVerificationDocuments, verificationProofDirectory, verificationProofMime } from './verifications.js'
import { landlordProofDirectory, landlordProofMime, removeStoredLandlordDocuments } from './landlord-verifications.js'

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
const verificationPersonSelect = { ...personSelect, emailVerifiedAt: true } as const
const landlordPersonSelect = { ...verificationPersonSelect, status: true, roles: true, profile: { select: { phone: true } } } as const

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
  proofKey: string | null; studentIdKey: string | null; offerLetterKey: string | null;
  user: { id: string; name: string; email: string; emailVerifiedAt: Date | null }
}, detail = false) {
  return {
    id: row.id, userId: row.userId,
    student: { id: row.user.id, name: row.user.name, email: row.user.email, emailVerified: Boolean(row.user.emailVerifiedAt) },
    university: row.university,
    verificationMethod: row.method, note: row.note, status: row.status, moderationReason: row.reason,
    reviewedAt: row.reviewedAt, reviewedById: row.reviewedById, createdAt: row.createdAt,
    ...(detail && row.proofKey ? { proofUrl: `/api/v1/admin/verifications/${row.id}/proof` } : {}),
    ...(detail && row.studentIdKey ? { studentIdUrl: `/api/v1/admin/verifications/${row.id}/student-id` } : {}),
    ...(detail && row.offerLetterKey ? { offerLetterUrl: `/api/v1/admin/verifications/${row.id}/offer-letter` } : {}),
  }
}

async function storedVerificationDocument(storageKey: string | null, ownerId: string, allowedMimeTypes: readonly string[]) {
  if (!storageKey || !/^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(storageKey)) return null
  const upload = await prisma.mediaUpload.findUnique({ where: { storageKey } })
  if (!upload || upload.ownerId !== ownerId || upload.purpose !== 'VERIFICATION' || upload.status !== 'READY' || !allowedMimeTypes.includes(upload.mimeType) || upload.size < 1 || upload.size > 5_000_000) return null
  const stored = await stat(resolve(verificationProofDirectory(), storageKey)).catch(() => null)
  if (!stored?.isFile() || stored.size !== upload.size) return null
  const bytes = await readFile(resolve(verificationProofDirectory(), storageKey)).catch(() => null)
  return bytes && verificationProofMime(bytes, upload.mimeType) === upload.mimeType ? { upload, bytes } : null
}

async function storedLandlordDocument(storageKey: string | null, ownerId: string, purpose: 'LANDLORD_IDENTITY' | 'PROPERTY_AUTHORIZATION', allowedMimeTypes: readonly string[]) {
  if (!storageKey || !/^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(storageKey)) return null
  const upload = await prisma.mediaUpload.findUnique({ where: { storageKey } })
  if (!upload || upload.ownerId !== ownerId || upload.purpose !== purpose || upload.status !== 'READY' || !allowedMimeTypes.includes(upload.mimeType) || upload.size < 1 || upload.size > 5_000_000) return null
  const path = resolve(landlordProofDirectory(), storageKey)
  const stored = await stat(path).catch(() => null)
  if (!stored?.isFile() || stored.size !== upload.size) return null
  const bytes = await readFile(path).catch(() => null)
  return bytes && landlordProofMime(bytes, upload.mimeType) === upload.mimeType ? { upload, bytes } : null
}

function landlordVerificationOf(row: {
  id: string; userId: string; kind: string; identityKey: string | null; companyKey: string | null; representationKey: string | null;
  status: string; reason: string | null; reviewedAt: Date | null; reviewedById: string | null; createdAt: Date;
  user: { id: string; name: string; email: string; emailVerifiedAt: Date | null; profile: { phone: string | null } | null }
}, detail = false) {
  return {
    id: row.id, userId: row.userId, kind: row.kind, status: row.status, moderationReason: row.reason,
    reviewedAt: row.reviewedAt, reviewedById: row.reviewedById, createdAt: row.createdAt,
    landlord: { id: row.user.id, name: row.user.name, email: row.user.email, emailVerified: Boolean(row.user.emailVerifiedAt), phone: row.user.profile?.phone || null },
    ...(detail && row.identityKey ? { identityUrl: `/api/v1/admin/landlord-verifications/${row.id}/identity` } : {}),
    ...(detail && row.companyKey ? { companyUrl: `/api/v1/admin/landlord-verifications/${row.id}/company` } : {}),
    ...(detail && row.representationKey ? { representativeUrl: `/api/v1/admin/landlord-verifications/${row.id}/representative` } : {}),
  }
}

function propertyAuthorizationOf(row: {
  id: string; listingId: string; requesterId: string; kind: string; proofKey: string | null; supportingKey: string | null;
  addressSnapshot: string; status: string; reason: string | null; reviewedAt: Date | null; reviewedById: string | null; createdAt: Date;
  requester: { id: string; name: string; email: string };
  listing: { id: string; title: string; address: string | null; status: string }
}, detail = false) {
  return {
    id: row.id, listingId: row.listingId, requesterId: row.requesterId, kind: row.kind, addressSnapshot: row.addressSnapshot,
    status: row.status, moderationReason: row.reason, reviewedAt: row.reviewedAt, reviewedById: row.reviewedById, createdAt: row.createdAt,
    landlord: { id: row.requester.id, name: row.requester.name, email: row.requester.email },
    listing: row.listing,
    ...(detail && row.proofKey ? { proofUrl: `/api/v1/admin/property-authorizations/${row.id}/proof` } : {}),
    ...(detail && row.supportingKey ? { supportingUrl: `/api/v1/admin/property-authorizations/${row.id}/supporting` } : {}),
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
  const [pendingVerifications, pendingLandlordVerifications, pendingPropertyAuthorizations, landlordAccounts, pendingListings, pendingReviews, openReports, pendingDeletionRequests] = await Promise.all([
    prisma.studentVerification.count({ where: { status: 'PENDING' } }),
    prisma.landlordVerification.count({ where: { status: 'PENDING' } }),
    prisma.propertyAuthorization.count({ where: { status: 'PENDING' } }),
    prisma.user.count({ where: { roles: { has: 'LANDLORD' }, status: 'ACTIVE' } }),
    prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.review.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: 'OPEN' } }),
    prisma.deletionRequest.count({ where: { status: 'PENDING' } }),
  ])
  ok(res, { pendingVerifications, pendingLandlordVerifications, pendingPropertyAuthorizations, landlordAccounts, pendingListings, pendingReviews, openReports, pendingDeletionRequests })
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

router.get('/verifications/:id/:document', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const document = z.enum(['student-id', 'offer-letter']).safeParse(req.params.document)
  if (!id.success || !document.success) return void fail(res, 404, 'This verification document is unavailable.', 'NOT_FOUND')
  const verification = await prisma.studentVerification.findUnique({ where: { id: id.data }, select: { userId: true, method: true, studentIdKey: true, offerLetterKey: true } })
  if (!verification || verification.method !== 'DOCUMENTS') return void fail(res, 404, 'This verification document is unavailable.', 'NOT_FOUND')
  const studentId = document.data === 'student-id'
  const storageKey = studentId ? verification.studentIdKey : verification.offerLetterKey
  const documentFile = await storedVerificationDocument(storageKey, verification.userId, studentId ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png'])
  if (!documentFile) return void fail(res, 404, 'This verification document is unavailable.', 'NOT_FOUND')
  const { upload, bytes } = documentFile
  const extension = upload.mimeType === 'application/pdf' ? '.pdf' : upload.mimeType === 'image/jpeg' ? '.jpg' : '.png'
  res.setHeader('Content-Type', upload.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${studentId ? 'student-id' : 'offer-letter'}${extension}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(bytes)
}))

router.get('/landlord-verifications', asyncRoute(async (req, res) => {
  const page = pageOf(req)
  const status = statusOf(req)
  if (status && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) return void fail(res, 400, 'Choose a valid identity status.', 'INVALID_STATUS')
  const where = status ? { status: status as VerificationStatus } : {}
  const [rows, total] = await Promise.all([
    prisma.landlordVerification.findMany({ where, include: { user: { select: landlordPersonSelect } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
    prisma.landlordVerification.count({ where }),
  ])
  ok(res, { items: rows.map(row => landlordVerificationOf(row)), total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.get('/landlord-verifications/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return void fail(res, 404, 'This identity request does not exist.', 'NOT_FOUND')
  const row = await prisma.landlordVerification.findUnique({ where: { id: id.data }, include: { user: { select: landlordPersonSelect } } })
  return void (row ? ok(res, landlordVerificationOf(row, true)) : fail(res, 404, 'This identity request does not exist.', 'NOT_FOUND'))
}))

router.get('/landlord-verifications/:id/:document', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const document = z.enum(['identity', 'company', 'representative']).safeParse(req.params.document)
  if (!id.success || !document.success) return void fail(res, 404, 'This identity document is unavailable.', 'NOT_FOUND')
  const row = await prisma.landlordVerification.findUnique({ where: { id: id.data }, select: { userId: true, identityKey: true, companyKey: true, representationKey: true } })
  if (!row) return void fail(res, 404, 'This identity document is unavailable.', 'NOT_FOUND')
  const key = document.data === 'identity' ? row.identityKey : document.data === 'company' ? row.companyKey : row.representationKey
  const stored = await storedLandlordDocument(key, row.userId, 'LANDLORD_IDENTITY', ['image/jpeg', 'image/png', 'application/pdf'])
  if (!stored) return void fail(res, 404, 'This identity document is unavailable.', 'NOT_FOUND')
  await prisma.auditLog.create({ data: { actorId: currentUser(req)!.id, action: 'LANDLORD_DOCUMENT_VIEWED', targetType: 'LANDLORD_VERIFICATION', targetId: id.data, after: { document: document.data } } })
  const extension = stored.upload.mimeType === 'application/pdf' ? '.pdf' : stored.upload.mimeType === 'image/jpeg' ? '.jpg' : '.png'
  res.setHeader('Content-Type', stored.upload.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="landlord-${document.data}${extension}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(stored.bytes)
}))

router.patch('/landlord-verifications/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const decision = z.object({ status: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().max(1000).default('') }).safeParse(req.body)
  if (!id.success || !decision.success || (decision.data.status === 'REJECTED' && decision.data.reason.length < 3)) return void fail(res, 400, 'Choose approve or reject and explain a rejection.', 'INVALID_DECISION')
  const { status, reason } = decision.data
  const previous = await prisma.landlordVerification.findUnique({ where: { id: id.data }, include: { user: { select: landlordPersonSelect } } })
  if (!previous) return void fail(res, 404, 'This identity request does not exist.', 'NOT_FOUND')
  if (previous.status !== 'PENDING') return void fail(res, 409, 'This identity request has already been reviewed.', 'ALREADY_REVIEWED')
  if (previous.userId === currentUser(req)!.id) return void fail(res, 403, 'You cannot approve your own identity.', 'FORBIDDEN')
  if (status === 'APPROVED') {
    if (previous.user.status !== 'ACTIVE' || !previous.user.roles.includes('LANDLORD') || !previous.user.emailVerifiedAt || !previous.user.profile?.phone) return void fail(res, 400, 'The landlord needs a verified email and phone before identity approval.', 'ACCOUNT_INCOMPLETE')
    const [identity, company, representative] = await Promise.all([
      storedLandlordDocument(previous.identityKey, previous.userId, 'LANDLORD_IDENTITY', ['image/jpeg', 'image/png']),
      previous.kind === 'COMPANY' ? storedLandlordDocument(previous.companyKey, previous.userId, 'LANDLORD_IDENTITY', ['application/pdf', 'image/jpeg', 'image/png']) : Promise.resolve(null),
      previous.kind === 'COMPANY' ? storedLandlordDocument(previous.representationKey, previous.userId, 'LANDLORD_IDENTITY', ['application/pdf', 'image/jpeg', 'image/png']) : Promise.resolve(null),
    ])
    if (!identity || (previous.kind === 'COMPANY' && (!company || !representative))) return void fail(res, 400, 'Review valid identity and company documents before approval.', 'PROOF_REQUIRED')
  }
  const actorId = currentUser(req)!.id
  const rejectedKeys = status === 'REJECTED' ? [previous.identityKey, previous.companyKey, previous.representationKey].filter((key): key is string => Boolean(key)) : []
  const changed = await atomicDecision(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.userId}))::text`
    if (status === 'APPROVED') {
      const user = await transaction.user.findUniqueOrThrow({ where: { id: previous.userId }, include: { profile: true } })
      if (user.status !== 'ACTIVE' || !user.roles.includes('LANDLORD') || !user.emailVerifiedAt || !user.profile?.phone) throw new ModerationConflict()
    }
    const updated = await transaction.landlordVerification.updateMany({ where: { id: id.data, status: 'PENDING' }, data: {
      status, reason: reason || null, reviewedById: actorId, reviewedAt: new Date(),
      ...(status === 'REJECTED' ? { identityKey: null, companyKey: null, representationKey: null } : {}),
    } })
    if (!updated.count) throw new ModerationConflict()
    const row = await transaction.landlordVerification.findUniqueOrThrow({ where: { id: id.data } })
    if (status === 'REJECTED' && rejectedKeys.length) await transaction.mediaUpload.deleteMany({ where: { ownerId: row.userId, storageKey: { in: rejectedKeys } } })
    await audit(transaction, actorId, `LANDLORD_IDENTITY_${status}`, 'LANDLORD_VERIFICATION', row.id, { status: previous.status }, { status, reason })
    await notify(transaction, row.userId, previous.user.email, 'LANDLORD_IDENTITY', `Landlord identity ${status.toLowerCase()}`, status === 'APPROVED' ? 'Your landlord identity review is approved.' : `Your landlord identity review was rejected: ${reason}`, row.id)
    return row
  })
  if (!changed) return void fail(res, 409, 'This identity request changed while being reviewed. Refresh the queue.', 'ALREADY_REVIEWED')
  if (status === 'REJECTED') await removeStoredLandlordDocuments(rejectedKeys)
  ok(res, landlordVerificationOf({ ...changed, user: previous.user }, true))
}))

router.get('/property-authorizations', asyncRoute(async (req, res) => {
  const page = pageOf(req)
  const status = statusOf(req)
  if (status && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) return void fail(res, 400, 'Choose a valid property authorization status.', 'INVALID_STATUS')
  const where = status ? { status: status as VerificationStatus } : {}
  const [rows, total] = await Promise.all([
    prisma.propertyAuthorization.findMany({ where, include: { requester: { select: personSelect }, listing: { select: { id: true, title: true, address: true, status: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
    prisma.propertyAuthorization.count({ where }),
  ])
  ok(res, { items: rows.map(row => propertyAuthorizationOf(row)), total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.get('/property-authorizations/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return void fail(res, 404, 'This property authorization does not exist.', 'NOT_FOUND')
  const row = await prisma.propertyAuthorization.findUnique({ where: { id: id.data }, include: { requester: { select: personSelect }, listing: { select: { id: true, title: true, address: true, status: true } } } })
  return void (row ? ok(res, propertyAuthorizationOf(row, true)) : fail(res, 404, 'This property authorization does not exist.', 'NOT_FOUND'))
}))

router.get('/property-authorizations/:id/:document', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const document = z.enum(['proof', 'supporting']).safeParse(req.params.document)
  if (!id.success || !document.success) return void fail(res, 404, 'This property document is unavailable.', 'NOT_FOUND')
  const row = await prisma.propertyAuthorization.findUnique({ where: { id: id.data }, select: { requesterId: true, proofKey: true, supportingKey: true } })
  if (!row) return void fail(res, 404, 'This property document is unavailable.', 'NOT_FOUND')
  const stored = await storedLandlordDocument(document.data === 'proof' ? row.proofKey : row.supportingKey, row.requesterId, 'PROPERTY_AUTHORIZATION', ['application/pdf', 'image/jpeg', 'image/png'])
  if (!stored) return void fail(res, 404, 'This property document is unavailable.', 'NOT_FOUND')
  await prisma.auditLog.create({ data: { actorId: currentUser(req)!.id, action: 'PROPERTY_DOCUMENT_VIEWED', targetType: 'PROPERTY_AUTHORIZATION', targetId: id.data, after: { document: document.data } } })
  const extension = stored.upload.mimeType === 'application/pdf' ? '.pdf' : stored.upload.mimeType === 'image/jpeg' ? '.jpg' : '.png'
  res.setHeader('Content-Type', stored.upload.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="property-${document.data}${extension}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(stored.bytes)
}))

router.patch('/property-authorizations/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const decision = z.object({ status: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().max(1000).default('') }).safeParse(req.body)
  if (!id.success || !decision.success || (decision.data.status === 'REJECTED' && decision.data.reason.length < 3)) return void fail(res, 400, 'Choose approve or reject and explain a rejection.', 'INVALID_DECISION')
  const { status, reason } = decision.data
  const previous = await prisma.propertyAuthorization.findUnique({ where: { id: id.data }, include: { requester: { select: personSelect }, listing: { select: { id: true, title: true, address: true, status: true, ownerId: true } } } })
  if (!previous) return void fail(res, 404, 'This property authorization does not exist.', 'NOT_FOUND')
  if (previous.status !== 'PENDING') return void fail(res, 409, 'This property authorization has already been reviewed.', 'ALREADY_REVIEWED')
  if (previous.requesterId === currentUser(req)!.id) return void fail(res, 403, 'You cannot approve your own property authorization.', 'FORBIDDEN')
  if (status === 'APPROVED') {
    if (previous.listing.ownerId !== previous.requesterId || !previous.listing.address || previous.listing.address !== previous.addressSnapshot || previous.listing.status === 'ARCHIVED') return void fail(res, 400, 'The property address or listing changed. Ask for a new authorization request.', 'LISTING_CHANGED')
    const account = await prisma.user.findUnique({ where: { id: previous.requesterId }, select: { status: true, roles: true, emailVerifiedAt: true, studentVerified: true } })
    const identity = await prisma.landlordVerification.findFirst({ where: { userId: previous.requesterId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true } })
    if (!account || account.status !== 'ACTIVE' || !account.emailVerifiedAt || !(account.roles.includes('LANDLORD') ? identity?.status === 'APPROVED' : account.roles.includes('STUDENT') && account.studentVerified)) return void fail(res, 400, 'Verify the property owner account before reviewing its authorization.', 'IDENTITY_REQUIRED')
    const [proof, supporting] = await Promise.all([
      storedLandlordDocument(previous.proofKey, previous.requesterId, 'PROPERTY_AUTHORIZATION', ['application/pdf', 'image/jpeg', 'image/png']),
      previous.kind !== 'OWNER' ? storedLandlordDocument(previous.supportingKey, previous.requesterId, 'PROPERTY_AUTHORIZATION', ['application/pdf', 'image/jpeg', 'image/png']) : Promise.resolve(null),
    ])
    if (!proof || (previous.kind !== 'OWNER' && !supporting)) return void fail(res, 400, 'Review the required property authorization documents before approval.', 'PROOF_REQUIRED')
  }
  const actorId = currentUser(req)!.id
  const rejectedKeys = status === 'REJECTED' ? [previous.proofKey, previous.supportingKey].filter((key): key is string => Boolean(key)) : []
  const changed = await atomicDecision(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.requesterId}))::text`
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.listingId}))::text`
    if (status === 'APPROVED') {
      const listing = await transaction.listing.findUniqueOrThrow({ where: { id: previous.listingId } })
      const owner = await transaction.user.findUniqueOrThrow({ where: { id: previous.requesterId } })
      const identity = await transaction.landlordVerification.findFirst({ where: { userId: previous.requesterId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true } })
      if (listing.ownerId !== previous.requesterId || listing.address !== previous.addressSnapshot || listing.status === 'ARCHIVED' || owner.status !== 'ACTIVE' || !owner.emailVerifiedAt || !(owner.roles.includes('LANDLORD') ? identity?.status === 'APPROVED' : owner.roles.includes('STUDENT') && owner.studentVerified)) throw new ModerationConflict()
    }
    const updated = await transaction.propertyAuthorization.updateMany({ where: { id: id.data, status: 'PENDING' }, data: { status, reason: reason || null, reviewedById: actorId, reviewedAt: new Date(), ...(status === 'REJECTED' ? { proofKey: null, supportingKey: null } : {}) } })
    if (!updated.count) throw new ModerationConflict()
    const row = await transaction.propertyAuthorization.findUniqueOrThrow({ where: { id: id.data } })
    if (status === 'REJECTED' && rejectedKeys.length) await transaction.mediaUpload.deleteMany({ where: { ownerId: row.requesterId, storageKey: { in: rejectedKeys } } })
    await audit(transaction, actorId, `PROPERTY_AUTHORIZATION_${status}`, 'PROPERTY_AUTHORIZATION', row.id, { status: previous.status }, { status, reason, listingId: row.listingId })
    await notify(transaction, row.requesterId, previous.requester.email, 'PROPERTY_AUTHORIZATION', `Property authorization ${status.toLowerCase()}`, status === 'APPROVED' ? `Property authorization for "${previous.listing.title}" is approved.` : `Property authorization for "${previous.listing.title}" was rejected: ${reason}`, row.id)
    return row
  })
  if (!changed) return void fail(res, 409, 'This authorization changed while being reviewed. Refresh the queue.', 'ALREADY_REVIEWED')
  if (status === 'REJECTED') await removeStoredLandlordDocuments(rejectedKeys)
  ok(res, propertyAuthorizationOf({ ...changed, requester: previous.requester, listing: previous.listing }, true))
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
  let verificationUploads: Array<{ storageKey: string; purpose: string }> = []
  const result = await atomicDecision(async transaction => {
    if (body.data.status === 'APPROVED' && previous.user.roles.includes('ADMIN')) {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(31415926)`
      const activeAdmins = await transaction.user.count({ where: { status: 'ACTIVE', roles: { has: 'ADMIN' } } })
      if (activeAdmins <= 1) throw new LastAdminConflict()
    }
    if (body.data.status === 'APPROVED') {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.userId}))::text`
      verificationUploads = await transaction.mediaUpload.findMany({ where: { ownerId: previous.userId, purpose: { in: ['VERIFICATION', 'LANDLORD_IDENTITY', 'PROPERTY_AUTHORIZATION'] } }, select: { storageKey: true, purpose: true } })
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
      await transaction.studentVerification.deleteMany({ where: { userId: previous.userId } })
      await transaction.landlordVerification.deleteMany({ where: { userId: previous.userId } })
      await transaction.propertyAuthorization.deleteMany({ where: { requesterId: previous.userId } })
      await transaction.mediaUpload.deleteMany({ where: { ownerId: previous.userId, purpose: { in: ['VERIFICATION', 'LANDLORD_IDENTITY', 'PROPERTY_AUTHORIZATION'] } } })
      await transaction.user.update({ where: { id: previous.userId }, data: { status: 'DELETED', name: 'Deleted account', email: `deleted-${previous.userId}@invalid.local`, passwordHash: randomBytes(48).toString('hex'), emailVerifiedAt: null, studentVerified: false, verificationStatus: 'UNVERIFIED' } })
    } else {
      await notify(transaction, previous.userId, previous.user.email, 'DELETION_REQUEST', 'Account deletion request rejected', `Your account deletion request was rejected: ${body.data.reason}`, changed.id)
    }
    await audit(transaction, actorId, `DELETION_REQUEST_${body.data.status}`, 'DELETION_REQUEST', changed.id, { status: previous.status }, { status: changed.status, reason: body.data.reason })
    return changed
  }).catch(error => error instanceof LastAdminConflict ? 'LAST_ADMIN' as const : Promise.reject(error))
  if (result === 'LAST_ADMIN') return void fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
  if (!result) return void fail(res, 409, 'This deletion request has already been reviewed.', 'ALREADY_REVIEWED')
  if (body.data.status === 'APPROVED') {
    await removeStoredVerificationDocuments(verificationUploads.filter(upload => upload.purpose === 'VERIFICATION').map(upload => upload.storageKey))
    await removeStoredLandlordDocuments(verificationUploads.filter(upload => upload.purpose !== 'VERIFICATION').map(upload => upload.storageKey))
  }
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
    const [rows, count] = await Promise.all([prisma.studentVerification.findMany({ where, include: { user: { select: verificationPersonSelect } }, orderBy: { createdAt: 'desc' }, skip, take }), prisma.studentVerification.count({ where })])
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
    const row = await prisma.studentVerification.findUnique({ where: { id: id.data }, include: { user: { select: verificationPersonSelect } } })
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
    const previous = await prisma.studentVerification.findUnique({ where: { id: id.data }, include: { user: { select: verificationPersonSelect } } })
    if (!previous) return void fail(res, 404, 'This verification does not exist.', 'NOT_FOUND')
    if (previous.status !== 'PENDING') return void fail(res, 409, 'This verification has already been reviewed.', 'ALREADY_REVIEWED')
    if (status === 'APPROVED') {
      if (previous.method !== 'DOCUMENTS') return void fail(res, 400, 'Ask the student to resubmit both verification documents.', 'DOCUMENTS_REQUIRED')
      if (!previous.user.emailVerifiedAt) return void fail(res, 400, 'The student must verify their school email before approval.', 'EMAIL_UNVERIFIED')
      const emailDomain = previous.user.email.toLowerCase().split('@')[1]
      const campuses = await prisma.campus.findMany({ where: { active: true }, select: { domains: true } })
      if (!campuses.some(campus => campus.domains.some(domain => domain.trim().toLowerCase() === emailDomain))) return void fail(res, 400, 'The student school email domain is not approved.', 'DOMAIN_NOT_APPROVED')
      const [studentId, offerLetter] = await Promise.all([
        storedVerificationDocument(previous.studentIdKey, previous.userId, ['image/jpeg', 'image/png']),
        storedVerificationDocument(previous.offerLetterKey, previous.userId, ['application/pdf', 'image/jpeg', 'image/png']),
      ])
      if (!studentId || !offerLetter) return void fail(res, 400, 'Review both valid student documents before approval.', 'PROOF_REQUIRED')
    }
    const rejectedKeys = status === 'REJECTED' ? [previous.proofKey, previous.studentIdKey, previous.offerLetterKey] : []
    const changed = await atomicDecision(async transaction => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.userId}))::text`
      const updated = await transaction.studentVerification.updateMany({ where: { id: id.data, status: 'PENDING' }, data: {
        status: status as VerificationStatus, reason: reason || null, reviewedById: actorId, reviewedAt: new Date(),
        ...(status === 'REJECTED' ? { proofKey: null, studentIdKey: null, offerLetterKey: null } : {}),
      } })
      if (!updated.count) throw new ModerationConflict()
      const row = await transaction.studentVerification.findUniqueOrThrow({ where: { id: id.data } })
      if (status === 'REJECTED') await transaction.mediaUpload.deleteMany({ where: { ownerId: row.userId, storageKey: { in: rejectedKeys.filter((key): key is string => Boolean(key)) } } })
      const approved = status === 'APPROVED' || await transaction.studentVerification.count({ where: { userId: row.userId, status: 'APPROVED' } }) > 0
      await transaction.user.update({ where: { id: row.userId }, data: { studentVerified: approved, verificationStatus: approved ? 'APPROVED' : status as VerificationStatus } })
      await audit(transaction, actorId, `VERIFICATION_${status}`, 'STUDENT_VERIFICATION', row.id, { status: previous.status }, { status, reason })
      await notify(transaction, row.userId, previous.user.email, 'STUDENT_VERIFICATION', `Student verification ${status.toLowerCase()}`, status === 'APPROVED' ? 'Your student verification has been approved.' : `Your student verification was rejected: ${reason}`, row.id)
      return row
    })
    if (!changed) return void fail(res, 409, 'This verification has already been reviewed.', 'ALREADY_REVIEWED')
    if (status === 'REJECTED') await removeStoredVerificationDocuments(rejectedKeys)
    return void ok(res, verificationOf({ ...changed, user: previous.user }, true))
  }

  if (kind === 'listings') {
    if (!['PUBLISHED', 'REJECTED', 'PAUSED'].includes(status)) return void fail(res, 400, 'Choose an available listing decision.', 'INVALID_STATUS')
    const previous = await prisma.listing.findUnique({ where: { id: id.data }, include: { owner: { select: personSelect }, campus: { select: { name: true } }, photos: true } })
    if (!previous) return void fail(res, 404, 'This listing does not exist.', 'NOT_FOUND')
    if (previous.ownerId === actorId) return void fail(res, 403, 'You cannot moderate your own listing.', 'FORBIDDEN')
    const permitted = (previous.status === 'PENDING_REVIEW' && ['PUBLISHED', 'REJECTED'].includes(status)) || (previous.status === 'PUBLISHED' && status === 'PAUSED') || (previous.status === 'PAUSED' && status === 'PUBLISHED')
    if (!permitted) return void fail(res, 409, 'Submit the listing for review before changing it to this status.', 'INVALID_TRANSITION')
    if (status === 'PUBLISHED' && !previous.photos.length) return void fail(res, 400, 'A property needs at least one photo before publication.', 'PHOTO_REQUIRED')
    if (status === 'PUBLISHED' && (!previous.address?.trim() || previous.address.trim().length < 10 || previous.address.trim().length > 250)) return void fail(res, 400, 'Enter the full property address before publishing.', 'ADDRESS_REQUIRED')
    if (status === 'PUBLISHED') {
      const [owner, authorization] = await Promise.all([
        prisma.user.findUnique({ where: { id: previous.ownerId }, select: { status: true, roles: true, emailVerifiedAt: true, studentVerified: true } }),
        prisma.propertyAuthorization.findFirst({ where: { listingId: previous.id, requesterId: previous.ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, addressSnapshot: true } }),
      ])
      const identity = owner?.roles.includes('LANDLORD') ? await prisma.landlordVerification.findFirst({ where: { userId: previous.ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true } }) : null
      if (!owner || owner.status !== 'ACTIVE' || !owner.emailVerifiedAt || !(owner.roles.includes('LANDLORD') ? identity?.status === 'APPROVED' : owner.roles.includes('STUDENT') && owner.studentVerified)) return void fail(res, 400, 'The listing owner must complete account verification before publication.', 'IDENTITY_REQUIRED')
      if (authorization?.status !== 'APPROVED' || authorization.addressSnapshot !== previous.address) return void fail(res, 400, 'Approve proof of rental authority for this exact address before publication.', 'AUTHORIZATION_REQUIRED')
    }
    const changed = await atomicDecision(async transaction => {
      if (status === 'PUBLISHED') {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.ownerId}))::text`
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.id}))::text`
        const [listing, owner, authorization] = await Promise.all([
          transaction.listing.findUniqueOrThrow({ where: { id: previous.id } }),
          transaction.user.findUniqueOrThrow({ where: { id: previous.ownerId } }),
          transaction.propertyAuthorization.findFirst({ where: { listingId: previous.id, requesterId: previous.ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
        ])
        const identity = owner.roles.includes('LANDLORD') ? await transaction.landlordVerification.findFirst({ where: { userId: owner.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true } }) : null
        if (listing.status !== previous.status || listing.address !== previous.address || owner.status !== 'ACTIVE' || !owner.emailVerifiedAt || !(owner.roles.includes('LANDLORD') ? identity?.status === 'APPROVED' : owner.roles.includes('STUDENT') && owner.studentVerified) || authorization?.status !== 'APPROVED' || authorization.addressSnapshot !== listing.address) throw new ModerationConflict()
      }
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
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.id}))::text`
    const updated = await transaction.user.updateMany({ where: { id: id.data, status: previous.status }, data: { status: status as AccountStatus } })
    if (!updated.count) throw new ModerationConflict()
    const row = await transaction.user.findUniqueOrThrow({ where: { id: id.data } })
    if (status === 'SUSPENDED') {
      await transaction.session.updateMany({ where: { userId: row.id, revokedAt: null }, data: { revokedAt: new Date() } })
      await transaction.authToken.deleteMany({ where: { userId: row.id } })
      await transaction.listing.updateMany({ where: { ownerId: row.id, status: 'PUBLISHED' }, data: { status: 'PAUSED', moderationReason: 'Owner account suspended; review is required before republishing.' } })
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
