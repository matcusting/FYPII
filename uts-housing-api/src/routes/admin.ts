import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { AccountStatus, ListingStatus, ReportStatus, ReviewStatus, VerificationStatus, type Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireRole } from '../core/auth.js'
import { approvalExpiresAt, approvalIsCurrent, effectiveApprovalStatus } from '../core/approval.js'
import { addUtcCalendarYears, parseUtcDateOnly } from '../core/retention-dates.js'
import { effectiveStudentVerificationStatus, studentVerificationIsCurrent } from '../core/student-verification.js'
import { fail, ok } from '../core/http.js'
import { uploadMetadata } from '../storage/listings.js'
import { verificationProofDirectory, verificationProofMime } from './verifications.js'
import { landlordProofDirectory, landlordProofMime } from './landlord-verifications.js'
import { processPendingFileDeletions } from '../workers/file-deletion.js'

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
const decisionSchema = z.object({
  status: z.string(), reason: z.string().trim().max(1000).default(''), studentIdMatchesEmail: z.boolean().optional(),
  enrollmentCheckStatus: z.enum(['NOT_CHECKED', 'ACTIVE', 'INACTIVE', 'INCONCLUSIVE']).optional(),
  enrollmentCheckReference: z.string().trim().min(4).max(120).regex(/^[^\r\n]+$/).optional(),
  studyEndsAt: z.string().optional(),
})
const reviewerSourceReference = z.string().trim().min(4).max(160).regex(/^[^\r\n]+$/).optional()
function currentMalaysiaDate(): Date {
  return new Date(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00.000Z')
}
function validStudyEnd(input: string | undefined): Date | null {
  const date = parseUtcDateOnly(input || '')
  return date && date >= currentMalaysiaDate() ? date : null
}
const queueStatuses: Record<ModerationKind, readonly string[]> = {
  verifications: ['UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED'],
  listings: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'PAUSED', 'RENTED', 'ARCHIVED'],
  reviews: ['PENDING', 'APPROVED', 'REJECTED'],
  reports: ['OPEN', 'RESOLVED', 'DISMISSED'],
  accounts: ['ACTIVE', 'SUSPENDED', 'DELETED'],
}
const accountSelect = { id: true, name: true, email: true, roles: true, emailVerifiedAt: true, studentVerified: true, studentVerifiedUntil: true, verificationStatus: true, status: true, createdAt: true, updatedAt: true } as const
const personSelect = { id: true, name: true, email: true } as const
const verificationPersonSelect = { ...personSelect, emailVerifiedAt: true } as const
const landlordPersonSelect = { ...verificationPersonSelect, status: true, roles: true, profile: { select: { phone: true } } } as const
const lawyerSelect = { id: true, name: true, status: true, roles: true } as const

function activeAssignedLawyer(row: {
  lawyerId: string | null; lawyerDecision: string | null; lawyerReviewedAt: Date | null; lawyerSourceReference: string | null;
  lawyer: { id: string; status: AccountStatus; roles: string[] } | null;
}, checks: boolean) {
  return Boolean(row.lawyerId && row.lawyer?.id === row.lawyerId && row.lawyer.status === 'ACTIVE'
    && row.lawyer.roles.length === 1 && row.lawyer.roles[0] === 'LAWYER'
    && row.lawyerDecision === 'APPROVE' && row.lawyerReviewedAt && row.lawyerSourceReference && checks)
}

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
  studentVerified: boolean; studentVerifiedUntil: Date | null; verificationStatus: string; status: unknown; createdAt: Date; updatedAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles,
    emailVerified: Boolean(row.emailVerifiedAt),
    studentVerified: studentVerificationIsCurrent(row),
    studentVerifiedUntil: row.studentVerifiedUntil?.toISOString().slice(0, 10) || null,
    verificationStatus: effectiveStudentVerificationStatus(row),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function verificationOf(row: {
  id: string; userId: string; method: unknown; university: string; note: string | null; status: unknown;
  enrollmentCheckStatus: string; enrollmentCheckReference: string | null; enrollmentCheckedAt: Date | null;
  studyEndsAt: Date | null; evidenceRetainUntil: Date | null;
  evidenceHoldAt: Date | null; evidenceHoldReason: string | null;
  reason: string | null; reviewedAt: Date | null; reviewedById: string | null; createdAt: Date;
  proofKey: string | null; studentIdKey: string | null; offerLetterKey: string | null;
  user: { id: string; name: string; email: string; emailVerifiedAt: Date | null }
}, detail = false) {
  return {
    id: row.id, userId: row.userId,
    student: { id: row.user.id, name: row.user.name, email: row.user.email, emailVerified: Boolean(row.user.emailVerifiedAt) },
    university: row.university,
    verificationMethod: row.method, note: row.note, status: row.status, moderationReason: row.reason,
    enrollmentCheckStatus: row.enrollmentCheckStatus, enrollmentCheckReference: row.enrollmentCheckReference,
    enrollmentCheckedAt: row.enrollmentCheckedAt,
    ...(detail ? { studyEndsAt: row.studyEndsAt?.toISOString().slice(0, 10) || null,
      evidenceRetainUntil: row.evidenceRetainUntil?.toISOString().slice(0, 10) || null,
      evidenceHoldAt: row.evidenceHoldAt, evidenceHoldReason: row.evidenceHoldReason } : {}),
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
  reviewerSourceReference: string | null; identityMatched: boolean; companyRegistryChecked: boolean;
  lawyerId: string | null; lawyerAssignedAt: Date | null; lawyerDecision: string | null; lawyerReason: string | null; lawyerSourceReference: string | null;
  lawyerIdentityMatched: boolean; lawyerCompanyRegistryChecked: boolean; lawyerReviewedAt: Date | null; lawyer?: { name: string } | null;
  status: string; reason: string | null; reviewedAt: Date | null; reviewedById: string | null; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null;
  evidenceHoldAt: Date | null; evidenceHoldReason: string | null;
  user: { id: string; name: string; email: string; emailVerifiedAt: Date | null; profile: { phone: string | null } | null }
}, detail = false) {
  return {
    id: row.id, userId: row.userId, kind: row.kind, status: effectiveApprovalStatus(row), moderationReason: row.reason,
    reviewedAt: row.reviewedAt, reviewedById: row.reviewedById, createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt,
    landlord: { id: row.user.id, name: row.user.name, email: row.user.email, emailVerified: Boolean(row.user.emailVerifiedAt), phone: row.user.profile?.phone || null },
    ...(detail ? { evidenceHoldAt: row.evidenceHoldAt, evidenceHoldReason: row.evidenceHoldReason,
      reviewerSourceReference: row.reviewerSourceReference, identityMatched: row.identityMatched, companyRegistryChecked: row.companyRegistryChecked,
      lawyerReviewRequired: row.status === 'PENDING', lawyerReview: row.lawyerId ? { lawyerId: row.lawyerId, lawyerName: row.lawyer?.name || null,
        assignedAt: row.lawyerAssignedAt, decision: row.lawyerDecision, reason: row.lawyerReason, sourceReference: row.lawyerSourceReference,
        identityMatched: row.lawyerIdentityMatched, companyRegistryChecked: row.lawyerCompanyRegistryChecked, reviewedAt: row.lawyerReviewedAt } : null } : {}),
    ...(detail && row.identityKey ? { identityUrl: `/api/v1/admin/landlord-verifications/${row.id}/identity` } : {}),
    ...(detail && row.companyKey ? { companyUrl: `/api/v1/admin/landlord-verifications/${row.id}/company` } : {}),
    ...(detail && row.representationKey ? { representativeUrl: `/api/v1/admin/landlord-verifications/${row.id}/representative` } : {}),
  }
}

function propertyAuthorizationOf(row: {
  id: string; listingId: string; requesterId: string; kind: string; proofKey: string | null; supportingKey: string | null;
  reviewerSourceReference: string | null; authorityChecked: boolean; addressMatched: boolean;
  lawyerId: string | null; lawyerAssignedAt: Date | null; lawyerDecision: string | null; lawyerReason: string | null; lawyerSourceReference: string | null;
  lawyerAuthorityChecked: boolean; lawyerAddressMatched: boolean; lawyerReviewedAt: Date | null; lawyer?: { name: string } | null;
  addressSnapshot: string; status: string; reason: string | null; reviewedAt: Date | null; reviewedById: string | null; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null;
  evidenceHoldAt: Date | null; evidenceHoldReason: string | null;
  requester: { id: string; name: string; email: string };
  listing: { id: string; title: string; address: string | null; status: string }
}, detail = false) {
  return {
    id: row.id, listingId: row.listingId, requesterId: row.requesterId, kind: row.kind, addressSnapshot: row.addressSnapshot,
    status: effectiveApprovalStatus(row), moderationReason: row.reason, reviewedAt: row.reviewedAt, reviewedById: row.reviewedById, createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt,
    landlord: { id: row.requester.id, name: row.requester.name, email: row.requester.email },
    listing: row.listing,
    ...(detail ? { evidenceHoldAt: row.evidenceHoldAt, evidenceHoldReason: row.evidenceHoldReason,
      reviewerSourceReference: row.reviewerSourceReference, authorityChecked: row.authorityChecked, addressMatched: row.addressMatched,
      lawyerReviewRequired: row.status === 'PENDING', lawyerReview: row.lawyerId ? { lawyerId: row.lawyerId, lawyerName: row.lawyer?.name || null,
        assignedAt: row.lawyerAssignedAt, decision: row.lawyerDecision, reason: row.lawyerReason, sourceReference: row.lawyerSourceReference,
        authorityChecked: row.lawyerAuthorityChecked, addressMatched: row.lawyerAddressMatched, reviewedAt: row.lawyerReviewedAt } : null } : {}),
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
class EvidenceHoldConflict extends Error {}

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

// A law-office account is provisioned out of band. It is deliberately never
// created through public registration or granted the general ADMIN role.
router.get('/lawyer-reviewers', asyncRoute(async (_req, res) => {
  const rows = await prisma.user.findMany({ where: { status: 'ACTIVE', roles: { has: 'LAWYER' } },
    select: { id: true, name: true, email: true, roles: true }, orderBy: { name: 'asc' }, take: 200 })
  ok(res, { items: rows.filter(row => row.roles.length === 1).map(({ roles: _roles, ...row }) => row) })
}))

router.post('/lawyer-assignments', asyncRoute(async (req, res) => {
  const parsed = z.object({ kind: z.enum(['identity', 'property']), id: z.string().uuid(), lawyerId: z.string().uuid().nullable() }).safeParse(req.body)
  if (!parsed.success) return void fail(res, 400, 'Choose a valid case and lawyer account.', 'INVALID_ASSIGNMENT')
  const { kind, id, lawyerId } = parsed.data
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`
    const lawyer = lawyerId ? await tx.user.findUnique({ where: { id: lawyerId }, select: { id: true, status: true, roles: true } }) : null
    if (lawyerId && (!lawyer || lawyer.status !== 'ACTIVE' || lawyer.roles.length !== 1 || lawyer.roles[0] !== 'LAWYER')) return { error: 'INVALID_LAWYER' } as const
    if (kind === 'identity') {
      const old = await tx.landlordVerification.findUnique({ where: { id }, select: { status: true, userId: true, lawyerId: true } })
      if (!old) return { error: 'NOT_FOUND' } as const
      if (old.status !== 'PENDING') return { error: 'CASE_CLOSED' } as const
      if (old.userId === lawyerId) return { error: 'SELF_REVIEW' } as const
      if (old.lawyerId === lawyerId) return { kind, id, lawyerId } as const
      await tx.landlordVerification.update({ where: { id }, data: { lawyerId, lawyerAssignedAt: lawyerId ? new Date() : null,
        lawyerDecision: null, lawyerReason: null, lawyerSourceReference: null, lawyerIdentityMatched: false,
        lawyerCompanyRegistryChecked: false, lawyerReviewedAt: null } })
      await audit(tx, currentUser(req)!.id, 'LAWYER_IDENTITY_ASSIGNED', 'LANDLORD_VERIFICATION', id, { lawyerId: old.lawyerId }, { lawyerId })
    } else {
      const old = await tx.propertyAuthorization.findUnique({ where: { id }, select: { status: true, requesterId: true, lawyerId: true } })
      if (!old) return { error: 'NOT_FOUND' } as const
      if (old.status !== 'PENDING') return { error: 'CASE_CLOSED' } as const
      if (old.requesterId === lawyerId) return { error: 'SELF_REVIEW' } as const
      if (old.lawyerId === lawyerId) return { kind, id, lawyerId } as const
      await tx.propertyAuthorization.update({ where: { id }, data: { lawyerId, lawyerAssignedAt: lawyerId ? new Date() : null,
        lawyerDecision: null, lawyerReason: null, lawyerSourceReference: null, lawyerAuthorityChecked: false,
        lawyerAddressMatched: false, lawyerReviewedAt: null } })
      await audit(tx, currentUser(req)!.id, 'LAWYER_PROPERTY_ASSIGNED', 'PROPERTY_AUTHORIZATION', id, { lawyerId: old.lawyerId }, { lawyerId })
    }
    return { kind, id, lawyerId } as const
  })
  if ('error' in result) return void fail(res, result.error === 'NOT_FOUND' ? 404 : result.error === 'CASE_CLOSED' ? 409 : 400,
    'The case or lawyer assignment is unavailable.', result.error)
  ok(res, result)
}))

// A preservation hold is specific to one verification application. Hold
// changes share the applicant lock used by account deletion, then lock the
// case row used by the retention worker, so neither path can bypass a new
// hold during concurrent maintenance.
router.patch('/evidence-holds/:kind/:id', asyncRoute(async (req, res) => {
  const kind = z.enum(['student', 'identity', 'property']).safeParse(req.params.kind)
  const id = z.string().uuid().safeParse(req.params.id)
  const body = z.object({ hold: z.boolean(), reason: z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]+$/), confirmRelease: z.boolean().optional() }).safeParse(req.body)
  if (!kind.success || !id.success || !body.success || (!body.data.hold && body.data.confirmRelease !== true)) {
    return void fail(res, 400, 'Choose a valid case and write a private reason; releasing a hold also needs explicit confirmation.', 'INVALID_EVIDENCE_HOLD')
  }
  const actorId = currentUser(req)!.id
  const result = await prisma.$transaction(async tx => {
    const owner = kind.data === 'student' ? await tx.studentVerification.findUnique({ where: { id: id.data }, select: { userId: true } })
      : kind.data === 'identity' ? await tx.landlordVerification.findUnique({ where: { id: id.data }, select: { userId: true } })
        : await tx.propertyAuthorization.findUnique({ where: { id: id.data }, select: { requesterId: true } })
    if (!owner) return { error: 'NOT_FOUND' } as const
    const ownerId = 'userId' in owner ? owner.userId : owner.requesterId
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))::text`
    if (kind.data === 'student') await tx.$queryRaw`SELECT id FROM "StudentVerification" WHERE id = ${id.data} FOR UPDATE`
    else if (kind.data === 'identity') await tx.$queryRaw`SELECT id FROM "LandlordVerification" WHERE id = ${id.data} FOR UPDATE`
    else await tx.$queryRaw`SELECT id FROM "PropertyAuthorization" WHERE id = ${id.data} FOR UPDATE`
    const fresh = kind.data === 'student' ? await tx.studentVerification.findUnique({ where: { id: id.data }, select: { evidenceHoldAt: true, userId: true } })
      : kind.data === 'identity' ? await tx.landlordVerification.findUnique({ where: { id: id.data }, select: { evidenceHoldAt: true, userId: true } })
        : await tx.propertyAuthorization.findUnique({ where: { id: id.data }, select: { evidenceHoldAt: true, requesterId: true } })
    if (!fresh || ('userId' in fresh ? fresh.userId : fresh.requesterId) !== ownerId) return { error: 'NOT_FOUND' } as const
    if (Boolean(fresh.evidenceHoldAt) === body.data.hold) return { error: 'UNCHANGED' } as const
    const heldAt = body.data.hold ? new Date() : null
    const reason = body.data.hold ? body.data.reason : null
    if (kind.data === 'student') await tx.studentVerification.update({ where: { id: id.data }, data: { evidenceHoldAt: heldAt, evidenceHoldReason: reason } })
    else if (kind.data === 'identity') await tx.landlordVerification.update({ where: { id: id.data }, data: { evidenceHoldAt: heldAt, evidenceHoldReason: reason } })
    else await tx.propertyAuthorization.update({ where: { id: id.data }, data: { evidenceHoldAt: heldAt, evidenceHoldReason: reason } })
    const targetType = kind.data === 'student' ? 'STUDENT_VERIFICATION' : kind.data === 'identity' ? 'LANDLORD_VERIFICATION' : 'PROPERTY_AUTHORIZATION'
    await audit(tx, actorId, body.data.hold ? 'EVIDENCE_HOLD_PLACED' : 'EVIDENCE_HOLD_RELEASED', targetType, id.data,
      { held: !body.data.hold }, { held: body.data.hold, reason: body.data.reason })
    return { kind: kind.data, id: id.data, evidenceHoldAt: heldAt, evidenceHoldReason: reason } as const
  })
  if ('error' in result) return void fail(res, result.error === 'NOT_FOUND' ? 404 : 409,
    result.error === 'NOT_FOUND' ? 'This verification case does not exist.' : 'This preservation hold has already been changed.', result.error)
  ok(res, result)
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
  await prisma.auditLog.create({ data: { actorId: currentUser(req)!.id, action: 'STUDENT_DOCUMENT_VIEWED', targetType: 'STUDENT_VERIFICATION', targetId: id.data, after: { document: document.data } } })
  const extension = upload.mimeType === 'application/pdf' ? '.pdf' : upload.mimeType === 'image/jpeg' ? '.jpg' : '.png'
  res.setHeader('Content-Type', upload.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${studentId ? 'student-id' : 'offer-letter'}${extension}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(bytes)
}))

// Correct an approved offer-letter end date while the original private proof
// still exists. This is an audited human review, never OCR or profile text.
router.patch('/verifications/:id/study-end', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const body = z.object({ studyEndsAt: z.string(), confirmOfferLetterDate: z.literal(true), reason: z.string().trim().min(10).max(500) }).safeParse(req.body)
  const studyEndsAt = body.success ? parseUtcDateOnly(body.data.studyEndsAt) : null
  if (!id.success || !body.success || !studyEndsAt) return void fail(res, 400, 'Confirm a valid YYYY-MM-DD date from the offer letter and explain the correction.', 'INVALID_STUDY_END_DATE')
  const existing = await prisma.studentVerification.findUnique({ where: { id: id.data } })
  if (!existing) return void fail(res, 404, 'This student verification does not exist.', 'NOT_FOUND')
  if (existing.status !== 'APPROVED' || !existing.offerLetterKey) return void fail(res, 409, 'An approved case with its original offer letter is required.', 'PROOF_UNAVAILABLE')
  if (existing.userId === currentUser(req)!.id) return void fail(res, 403, 'You cannot correct your own student verification.', 'FORBIDDEN')
  const proof = await storedVerificationDocument(existing.offerLetterKey, existing.userId, ['application/pdf', 'image/jpeg', 'image/png'])
  if (!proof) return void fail(res, 409, 'The original offer letter is unavailable; request a new verification submission.', 'PROOF_UNAVAILABLE')
  const evidenceRetainUntil = addUtcCalendarYears(studyEndsAt, 1)
  const changed = await atomicDecision(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.userId}))::text`
    await transaction.$queryRaw`SELECT id FROM "StudentVerification" WHERE id = ${id.data} FOR UPDATE`
    const fresh = await transaction.studentVerification.findUniqueOrThrow({ where: { id: id.data } })
    if (fresh.status !== 'APPROVED' || fresh.offerLetterKey !== existing.offerLetterKey) throw new ModerationConflict()
    const row = await transaction.studentVerification.update({ where: { id: id.data }, data: { studyEndsAt, evidenceRetainUntil } })
    const latest = await transaction.studentVerification.findFirst({ where: { userId: existing.userId, status: 'APPROVED' }, orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], select: { studyEndsAt: true } })
    await transaction.user.update({ where: { id: existing.userId }, data: { studentVerified: Boolean(latest?.studyEndsAt), studentVerifiedUntil: latest?.studyEndsAt || null } })
    await audit(transaction, currentUser(req)!.id, 'STUDENT_STUDY_END_CORRECTED', 'STUDENT_VERIFICATION', id.data,
      { studyEndsAt: fresh.studyEndsAt?.toISOString().slice(0, 10) || null, evidenceRetainUntil: fresh.evidenceRetainUntil?.toISOString().slice(0, 10) || null },
      { studyEndsAt: body.data.studyEndsAt, evidenceRetainUntil: evidenceRetainUntil.toISOString().slice(0, 10), reason: body.data.reason })
    return row
  })
  if (!changed) return void fail(res, 409, 'This student verification changed; refresh and try again.', 'ALREADY_REVIEWED')
  ok(res, { id: changed.id, studyEndsAt: changed.studyEndsAt?.toISOString().slice(0, 10), evidenceRetainUntil: changed.evidenceRetainUntil?.toISOString().slice(0, 10) })
}))

router.get('/landlord-verifications', asyncRoute(async (req, res) => {
  const page = pageOf(req)
  const status = statusOf(req)
  if (status && !['PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'].includes(status)) return void fail(res, 400, 'Choose a valid identity status.', 'INVALID_STATUS')
  const where = status === 'EXPIRED'
    ? { status: 'APPROVED' as const, expiresAt: { lte: new Date() } }
    : status === 'APPROVED'
      ? { status: 'APPROVED' as const, expiresAt: { gt: new Date() } }
      : status ? { status: status as VerificationStatus } : {}
  const [rows, total] = await Promise.all([
    prisma.landlordVerification.findMany({ where, include: { user: { select: landlordPersonSelect }, lawyer: { select: lawyerSelect } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
    prisma.landlordVerification.count({ where }),
  ])
  ok(res, { items: rows.map(row => landlordVerificationOf(row)), total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.get('/landlord-verifications/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return void fail(res, 404, 'This identity request does not exist.', 'NOT_FOUND')
  const row = await prisma.landlordVerification.findUnique({ where: { id: id.data }, include: { user: { select: landlordPersonSelect }, lawyer: { select: lawyerSelect } } })
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
  const decision = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'REVOKED']), reason: z.string().trim().max(1000).default(''), validUntil: z.string().optional(),
    reviewerSourceReference, identityMatched: z.boolean().optional(), companyRegistryChecked: z.boolean().optional(), acknowledgeLegalReview: z.boolean().optional(),
  }).safeParse(req.body)
  if (!id.success || !decision.success || (decision.data.status !== 'APPROVED' && decision.data.reason.length < 3)) return void fail(res, 400, 'Choose approve, reject or revoke and explain a rejection or revocation.', 'INVALID_DECISION')
  const { status, validUntil } = decision.data
  // Approval findings belong in the private reviewer reference, never in the
  // applicant-visible reason field. Rejections and revocations still explain
  // the decision to the applicant.
  const reason = status === 'APPROVED' ? '' : decision.data.reason
  const expiresAt = status === 'APPROVED' ? approvalExpiresAt('identity', new Date(), validUntil) : null
  if (status === 'APPROVED' && !expiresAt) return void fail(res, 400, 'Choose a valid expiry date within the configured maximum approval period.', 'INVALID_EXPIRY')
  const previous = await prisma.landlordVerification.findUnique({ where: { id: id.data }, include: { user: { select: landlordPersonSelect }, lawyer: { select: lawyerSelect } } })
  if (!previous) return void fail(res, 404, 'This identity request does not exist.', 'NOT_FOUND')
  if (previous.status !== (status === 'REVOKED' ? 'APPROVED' : 'PENDING')) return void fail(res, 409, 'This identity request cannot be changed to that status.', 'ALREADY_REVIEWED')
  if (previous.userId === currentUser(req)!.id) return void fail(res, 403, 'You cannot approve your own identity.', 'FORBIDDEN')
  if (status === 'APPROVED') {
    if (decision.data.acknowledgeLegalReview !== true) return void fail(res, 400, 'Confirm that you reviewed the lawyer recommendation before the final decision.', 'LEGAL_REVIEW_ACK_REQUIRED')
    if (!activeAssignedLawyer(previous, previous.lawyerIdentityMatched && (previous.kind !== 'COMPANY' || previous.lawyerCompanyRegistryChecked))) return void fail(res, 400, 'An active assigned lawyer must first recommend approval with the required independent checks.', 'LAWYER_REVIEW_REQUIRED')
    if (previous.lawyerId === currentUser(req)!.id) return void fail(res, 403, 'The lawyer who reviewed this case cannot make the final decision.', 'SELF_REVIEW')
    if (previous.user.status !== 'ACTIVE' || !previous.user.roles.includes('LANDLORD') || !previous.user.emailVerifiedAt || !previous.user.profile?.phone) return void fail(res, 400, 'The landlord needs a verified email and phone before identity approval.', 'ACCOUNT_INCOMPLETE')
    const [identity, company, representative] = await Promise.all([
      storedLandlordDocument(previous.identityKey, previous.userId, 'LANDLORD_IDENTITY', ['image/jpeg', 'image/png']),
      previous.kind === 'COMPANY' ? storedLandlordDocument(previous.companyKey, previous.userId, 'LANDLORD_IDENTITY', ['application/pdf', 'image/jpeg', 'image/png']) : Promise.resolve(null),
      previous.kind === 'COMPANY' ? storedLandlordDocument(previous.representationKey, previous.userId, 'LANDLORD_IDENTITY', ['application/pdf', 'image/jpeg', 'image/png']) : Promise.resolve(null),
    ])
    if (!identity || (previous.kind === 'COMPANY' && (!company || !representative))) return void fail(res, 400, 'Review valid identity and company documents before approval.', 'PROOF_REQUIRED')
  }
  const actorId = currentUser(req)!.id
  const changed = await atomicDecision(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id.data}))::text`
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.userId}))::text`
    if (status === 'APPROVED') {
      const user = await transaction.user.findUniqueOrThrow({ where: { id: previous.userId }, include: { profile: true } })
      const currentCase = await transaction.landlordVerification.findUniqueOrThrow({ where: { id: id.data }, include: { lawyer: { select: lawyerSelect } } })
      if (user.status !== 'ACTIVE' || !user.roles.includes('LANDLORD') || !user.emailVerifiedAt || !user.profile?.phone
        || !activeAssignedLawyer(currentCase, currentCase.lawyerIdentityMatched && (currentCase.kind !== 'COMPANY' || currentCase.lawyerCompanyRegistryChecked))
        || currentCase.lawyerId === actorId) throw new ModerationConflict()
    }
    const updated = await transaction.landlordVerification.updateMany({ where: { id: id.data, status: status === 'REVOKED' ? 'APPROVED' : 'PENDING',
      ...(status === 'APPROVED' ? { lawyerId: previous.lawyerId, lawyerDecision: 'APPROVE', lawyerIdentityMatched: true } : {}) }, data: {
      status, reason: reason || null, reviewedById: actorId, reviewedAt: new Date(), expiresAt, revokedAt: status === 'REVOKED' ? new Date() : null,
      ...(status === 'APPROVED' ? { reviewerSourceReference: decision.data.reviewerSourceReference || previous.lawyerSourceReference, identityMatched: true, companyRegistryChecked: previous.kind === 'COMPANY' } : {}),
    } })
    if (!updated.count) throw new ModerationConflict()
    const row = await transaction.landlordVerification.findUniqueOrThrow({ where: { id: id.data } })
    if (status === 'REVOKED') {
      await transaction.propertyAuthorization.updateMany({ where: { requesterId: row.userId, status: 'APPROVED' }, data: { status: 'REVOKED', reason: 'Landlord identity approval was revoked.', revokedAt: new Date() } })
      await transaction.listing.updateMany({ where: { ownerId: row.userId, status: { in: ['PUBLISHED', 'PENDING_REVIEW'] } }, data: { status: 'PAUSED', reviewedAt: null, moderationReason: 'Landlord identity approval was revoked.' } })
    }
    await audit(transaction, actorId, `LANDLORD_IDENTITY_${status}`, 'LANDLORD_VERIFICATION', row.id, { status: previous.status }, { status, reason, ...(status === 'APPROVED' ? { lawyerId: previous.lawyerId, lawyerRecommendation: 'APPROVE', sourceRecorded: true } : {}) })
    await notify(transaction, row.userId, previous.user.email, 'LANDLORD_IDENTITY', `Landlord identity ${status.toLowerCase()}`, status === 'APPROVED' ? `Your landlord identity review is approved until ${expiresAt!.toISOString().slice(0, 10)}.` : `Your landlord identity review was ${status.toLowerCase()}: ${reason}`, row.id)
    return row
  })
  if (!changed) return void fail(res, 409, 'This identity request changed while being reviewed. Refresh the queue.', 'ALREADY_REVIEWED')
  ok(res, landlordVerificationOf({ ...changed, user: previous.user, lawyer: previous.lawyer }, true))
}))

router.get('/property-authorizations', asyncRoute(async (req, res) => {
  const page = pageOf(req)
  const status = statusOf(req)
  if (status && !['PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'].includes(status)) return void fail(res, 400, 'Choose a valid property authorization status.', 'INVALID_STATUS')
  const where = status === 'EXPIRED'
    ? { status: 'APPROVED' as const, expiresAt: { lte: new Date() } }
    : status === 'APPROVED'
      ? { status: 'APPROVED' as const, expiresAt: { gt: new Date() } }
      : status ? { status: status as VerificationStatus } : {}
  const [rows, total] = await Promise.all([
    prisma.propertyAuthorization.findMany({ where, include: { requester: { select: personSelect }, listing: { select: { id: true, title: true, address: true, status: true } }, lawyer: { select: lawyerSelect } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20 }),
    prisma.propertyAuthorization.count({ where }),
  ])
  ok(res, { items: rows.map(row => propertyAuthorizationOf(row)), total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.get('/property-authorizations/:id', asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return void fail(res, 404, 'This property authorization does not exist.', 'NOT_FOUND')
  const row = await prisma.propertyAuthorization.findUnique({ where: { id: id.data }, include: { requester: { select: personSelect }, listing: { select: { id: true, title: true, address: true, status: true } }, lawyer: { select: lawyerSelect } } })
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
  const decision = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'REVOKED']), reason: z.string().trim().max(1000).default(''), validUntil: z.string().optional(),
    reviewerSourceReference, authorityChecked: z.boolean().optional(), addressMatched: z.boolean().optional(), acknowledgeLegalReview: z.boolean().optional(),
  }).safeParse(req.body)
  if (!id.success || !decision.success || (decision.data.status !== 'APPROVED' && decision.data.reason.length < 3)) return void fail(res, 400, 'Choose approve, reject or revoke and explain a rejection or revocation.', 'INVALID_DECISION')
  const { status, validUntil } = decision.data
  const reason = status === 'APPROVED' ? '' : decision.data.reason
  const expiresAt = status === 'APPROVED' ? approvalExpiresAt('property', new Date(), validUntil) : null
  if (status === 'APPROVED' && !expiresAt) return void fail(res, 400, 'Choose a valid expiry date within the configured maximum approval period.', 'INVALID_EXPIRY')
  const previous = await prisma.propertyAuthorization.findUnique({ where: { id: id.data }, include: { requester: { select: personSelect }, listing: { select: { id: true, title: true, address: true, status: true, ownerId: true } }, lawyer: { select: lawyerSelect } } })
  if (!previous) return void fail(res, 404, 'This property authorization does not exist.', 'NOT_FOUND')
  if (previous.status !== (status === 'REVOKED' ? 'APPROVED' : 'PENDING')) return void fail(res, 409, 'This property authorization cannot be changed to that status.', 'ALREADY_REVIEWED')
  if (previous.requesterId === currentUser(req)!.id) return void fail(res, 403, 'You cannot approve your own property authorization.', 'FORBIDDEN')
  if (status === 'APPROVED') {
    if (decision.data.acknowledgeLegalReview !== true) return void fail(res, 400, 'Confirm that you reviewed the lawyer recommendation before the final decision.', 'LEGAL_REVIEW_ACK_REQUIRED')
    if (!activeAssignedLawyer(previous, previous.lawyerAuthorityChecked && previous.lawyerAddressMatched)) return void fail(res, 400, 'An active assigned lawyer must first recommend approval with the required independent checks.', 'LAWYER_REVIEW_REQUIRED')
    if (previous.lawyerId === currentUser(req)!.id) return void fail(res, 403, 'The lawyer who reviewed this case cannot make the final decision.', 'SELF_REVIEW')
    if (previous.listing.ownerId !== previous.requesterId || !previous.listing.address || previous.listing.address !== previous.addressSnapshot || previous.listing.status === 'ARCHIVED') return void fail(res, 400, 'The property address or listing changed. Ask for a new authorization request.', 'LISTING_CHANGED')
    const account = await prisma.user.findUnique({ where: { id: previous.requesterId }, select: { status: true, roles: true, emailVerifiedAt: true, studentVerified: true, studentVerifiedUntil: true } })
    const identity = await prisma.landlordVerification.findFirst({ where: { userId: previous.requesterId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, expiresAt: true } })
    if (!account || account.status !== 'ACTIVE' || !account.emailVerifiedAt || !(account.roles.includes('LANDLORD') ? approvalIsCurrent(identity) : account.roles.includes('STUDENT') && studentVerificationIsCurrent(account))) return void fail(res, 400, 'Verify the property owner account before reviewing its authorization.', 'IDENTITY_REQUIRED')
    const [proof, supporting] = await Promise.all([
      storedLandlordDocument(previous.proofKey, previous.requesterId, 'PROPERTY_AUTHORIZATION', ['application/pdf', 'image/jpeg', 'image/png']),
      previous.kind !== 'OWNER' ? storedLandlordDocument(previous.supportingKey, previous.requesterId, 'PROPERTY_AUTHORIZATION', ['application/pdf', 'image/jpeg', 'image/png']) : Promise.resolve(null),
    ])
    if (!proof || (previous.kind !== 'OWNER' && !supporting)) return void fail(res, 400, 'Review the required property authorization documents before approval.', 'PROOF_REQUIRED')
  }
  const actorId = currentUser(req)!.id
  const changed = await atomicDecision(async transaction => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id.data}))::text`
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.requesterId}))::text`
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.listingId}))::text`
    if (status === 'APPROVED') {
      const currentCase = await transaction.propertyAuthorization.findUniqueOrThrow({ where: { id: id.data }, include: { lawyer: { select: lawyerSelect } } })
      const listing = await transaction.listing.findUniqueOrThrow({ where: { id: previous.listingId } })
      const owner = await transaction.user.findUniqueOrThrow({ where: { id: previous.requesterId } })
      const identity = await transaction.landlordVerification.findFirst({ where: { userId: previous.requesterId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, expiresAt: true } })
      if (listing.ownerId !== previous.requesterId || listing.address !== previous.addressSnapshot || listing.status === 'ARCHIVED' || owner.status !== 'ACTIVE' || !owner.emailVerifiedAt || !(owner.roles.includes('LANDLORD') ? approvalIsCurrent(identity) : owner.roles.includes('STUDENT') && studentVerificationIsCurrent(owner))
        || !activeAssignedLawyer(currentCase, currentCase.lawyerAuthorityChecked && currentCase.lawyerAddressMatched) || currentCase.lawyerId === actorId) throw new ModerationConflict()
    }
    const updated = await transaction.propertyAuthorization.updateMany({ where: { id: id.data, status: status === 'REVOKED' ? 'APPROVED' : 'PENDING',
      ...(status === 'APPROVED' ? { lawyerId: previous.lawyerId, lawyerDecision: 'APPROVE', lawyerAuthorityChecked: true, lawyerAddressMatched: true } : {}) }, data: { status, reason: reason || null, reviewedById: actorId, reviewedAt: new Date(), expiresAt, revokedAt: status === 'REVOKED' ? new Date() : null, ...(status === 'APPROVED' ? { reviewerSourceReference: decision.data.reviewerSourceReference || previous.lawyerSourceReference, authorityChecked: true, addressMatched: true } : {}) } })
    if (!updated.count) throw new ModerationConflict()
    const row = await transaction.propertyAuthorization.findUniqueOrThrow({ where: { id: id.data } })
    if (status === 'REVOKED') await transaction.listing.updateMany({ where: { id: row.listingId, status: { in: ['PUBLISHED', 'PENDING_REVIEW'] } }, data: { status: 'PAUSED', reviewedAt: null, moderationReason: 'Property authorization was revoked.' } })
    await audit(transaction, actorId, `PROPERTY_AUTHORIZATION_${status}`, 'PROPERTY_AUTHORIZATION', row.id, { status: previous.status }, { status, reason, listingId: row.listingId, ...(status === 'APPROVED' ? { lawyerId: previous.lawyerId, lawyerRecommendation: 'APPROVE', sourceRecorded: true } : {}) })
    await notify(transaction, row.requesterId, previous.requester.email, 'PROPERTY_AUTHORIZATION', `Property authorization ${status.toLowerCase()}`, status === 'APPROVED' ? `Property authorization for "${previous.listing.title}" is approved until ${expiresAt!.toISOString().slice(0, 10)}.` : `Property authorization for "${previous.listing.title}" was ${status.toLowerCase()}: ${reason}`, row.id)
    return row
  })
  if (!changed) return void fail(res, 409, 'This authorization changed while being reviewed. Refresh the queue.', 'ALREADY_REVIEWED')
  ok(res, propertyAuthorizationOf({ ...changed, requester: previous.requester, listing: previous.listing, lawyer: previous.lawyer }, true))
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
    if (body.data.status === 'APPROVED') {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.userId}))::text`
      const held = await Promise.all([
        transaction.studentVerification.count({ where: { userId: previous.userId, evidenceHoldAt: { not: null } } }),
        transaction.landlordVerification.count({ where: { userId: previous.userId, evidenceHoldAt: { not: null } } }),
        transaction.propertyAuthorization.count({ where: { requesterId: previous.userId, evidenceHoldAt: { not: null } } }),
      ])
      if (held.some(count => count > 0)) throw new EvidenceHoldConflict()
    }
    const updated = await transaction.deletionRequest.updateMany({ where: { id: id.data, status: 'PENDING' }, data: { status: body.data.status } })
    if (!updated.count) throw new ModerationConflict()
    const changed = await transaction.deletionRequest.findUniqueOrThrow({ where: { id: id.data } })
    if (body.data.status === 'APPROVED') {
      await transaction.session.updateMany({ where: { userId: previous.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      await transaction.authToken.deleteMany({ where: { userId: previous.userId } })
      await transaction.listing.updateMany({ where: { ownerId: previous.userId }, data: { status: 'ARCHIVED', title: 'Deleted listing', description: '', houseRules: null,
        approximateArea: '', contactMethod: 'IN_APP', showExactLocation: false, latitude: null, longitude: null, address: null } })
      await transaction.listingPhoto.deleteMany({ where: { listing: { ownerId: previous.userId } } })
      await transaction.review.updateMany({ where: { authorId: previous.userId }, data: { body: '[deleted]', experienceDescription: '[deleted]', experienceProofKey: null, active: false } })
      await transaction.review.updateMany({ where: { landlordId: previous.userId }, data: { ownerResponse: null, ownerRespondedAt: null } })
      await transaction.reviewRevision.updateMany({ where: { editorId: previous.userId }, data: { body: '[deleted]' } })
      await transaction.inquiry.updateMany({ where: { senderId: previous.userId }, data: { message: '[deleted]' } })
      await transaction.inquiryMessage.updateMany({ where: { senderId: previous.userId }, data: { body: '[deleted]' } })
      await transaction.connectionMessage.updateMany({ where: { senderId: previous.userId }, data: { body: '[deleted]' } })
      await transaction.report.updateMany({ where: { reporterId: previous.userId }, data: { reason: '[deleted]' } })
      await transaction.notification.deleteMany({ where: { userId: previous.userId } })
      await transaction.notificationPreference.deleteMany({ where: { userId: previous.userId } })
      await transaction.phoneVerificationChallenge.deleteMany({ where: { userId: previous.userId } })
      await transaction.emailJob.deleteMany({ where: { to: previous.user.email } })
      await transaction.roommateProfile.deleteMany({ where: { userId: previous.userId } })
      await transaction.profile.deleteMany({ where: { userId: previous.userId } })
      await transaction.studentVerification.deleteMany({ where: { userId: previous.userId } })
      await transaction.landlordVerification.deleteMany({ where: { userId: previous.userId } })
      await transaction.propertyAuthorization.deleteMany({ where: { requesterId: previous.userId } })
      // Keep the media rows until every private file (including unattached
      // photos and review proofs) is actually removed. The worker retries a
      // failed unlink without losing the storage key.
      await transaction.mediaUpload.updateMany({ where: { ownerId: previous.userId, status: 'PENDING' }, data: { status: 'DELETE_PENDING_EMPTY' } })
      await transaction.mediaUpload.updateMany({ where: { ownerId: previous.userId,
        status: { notIn: ['DELETE_PENDING_EMPTY', 'DELETE_PENDING', 'DELETE_QUARANTINED'] } }, data: { status: 'DELETE_PENDING' } })
      await transaction.user.update({ where: { id: previous.userId }, data: { status: 'DELETED', name: 'Deleted account', email: `deleted-${previous.userId}@invalid.local`, passwordHash: randomBytes(48).toString('hex'), emailVerifiedAt: null, studentVerified: false, studentVerifiedUntil: null, verificationStatus: 'UNVERIFIED' } })
    } else {
      await notify(transaction, previous.userId, previous.user.email, 'DELETION_REQUEST', 'Account deletion request rejected', `Your account deletion request was rejected: ${body.data.reason}`, changed.id)
    }
    await audit(transaction, actorId, `DELETION_REQUEST_${body.data.status}`, 'DELETION_REQUEST', changed.id, { status: previous.status }, { status: changed.status, reason: body.data.reason })
    return changed
  }).catch(error => error instanceof LastAdminConflict ? 'LAST_ADMIN' as const
    : error instanceof EvidenceHoldConflict ? 'EVIDENCE_HOLD' as const : Promise.reject(error))
  if (result === 'LAST_ADMIN') return void fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
  if (result === 'EVIDENCE_HOLD') return void fail(res, 409, 'Release the active evidence preservation hold before deleting this account.', 'EVIDENCE_HOLD_ACTIVE')
  if (!result) return void fail(res, 409, 'This deletion request has already been reviewed.', 'ALREADY_REVIEWED')
  if (body.data.status === 'APPROVED') {
    // Best effort now; the API's periodic cleanup retries if a filesystem error
    // occurs after the account deletion transaction commits.
    await processPendingFileDeletions({ ownerId: previous.userId, limit: 500 }).catch(() => {})
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
    if (status === 'APPROVED' && decision.data.studentIdMatchesEmail !== true) return void fail(res, 400, 'Confirm that the Student ID on the card matches the school email before approval.', 'STUDENT_ID_MATCH_REQUIRED')
    const studyEndsAt = status === 'APPROVED' ? validStudyEnd(decision.data.studyEndsAt) : null
    if (status === 'APPROVED' && !studyEndsAt) return void fail(res, 400, 'Enter a valid current or future study end date from the offer letter (YYYY-MM-DD) before approval.', 'STUDY_END_DATE_REQUIRED')
    const evidenceRetainUntil = studyEndsAt ? addUtcCalendarYears(studyEndsAt, 1) : null
    const enrollmentCheckStatus = decision.data.enrollmentCheckStatus || 'NOT_CHECKED'
    const enrollmentCheckReference = decision.data.enrollmentCheckReference || null
    if ((enrollmentCheckStatus !== 'NOT_CHECKED' && !enrollmentCheckReference) || (enrollmentCheckStatus === 'NOT_CHECKED' && enrollmentCheckReference)) return void fail(res, 400, 'Record an official source reference only when an authorized enrollment check was performed.', 'ENROLLMENT_CHECK_REFERENCE_REQUIRED')
    if (status === 'APPROVED' && enrollmentCheckStatus === 'INACTIVE') return void fail(res, 400, 'Do not approve a student whose authorized university record says enrollment is inactive.', 'ENROLLMENT_INACTIVE')
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
    const changed = await atomicDecision(async transaction => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${previous.userId}))::text`
      const freshCase = await transaction.studentVerification.findUnique({ where: { id: id.data }, select: {
        status: true, evidenceHoldAt: true, proofKey: true, studentIdKey: true, offerLetterKey: true,
      } })
      if (!freshCase || freshCase.status !== 'PENDING') throw new ModerationConflict()
      const rejectedKeys = [freshCase.proofKey, freshCase.studentIdKey, freshCase.offerLetterKey].filter((key): key is string => Boolean(key))
      const purgeRejected = status === 'REJECTED' && !freshCase.evidenceHoldAt
      const updated = await transaction.studentVerification.updateMany({ where: { id: id.data, status: 'PENDING' }, data: {
        status: status as VerificationStatus, reason: reason || null, reviewedById: actorId, reviewedAt: new Date(),
        enrollmentCheckStatus, enrollmentCheckReference,
        enrollmentCheckedAt: enrollmentCheckStatus === 'NOT_CHECKED' ? null : new Date(),
        ...(status === 'APPROVED' ? { studyEndsAt, evidenceRetainUntil } : {}),
        ...(purgeRejected ? { proofKey: null, studentIdKey: null, offerLetterKey: null } : {}),
      } })
      if (!updated.count) throw new ModerationConflict()
      const row = await transaction.studentVerification.findUniqueOrThrow({ where: { id: id.data } })
      if (purgeRejected) await transaction.mediaUpload.updateMany({ where: { ownerId: row.userId, purpose: 'VERIFICATION', storageKey: { in: rejectedKeys } }, data: { status: 'DELETE_PENDING' } })
      const latestApproved = status === 'APPROVED' ? { studyEndsAt } : await transaction.studentVerification.findFirst({ where: { userId: row.userId, status: 'APPROVED' }, orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], select: { studyEndsAt: true } })
      const approved = Boolean(latestApproved?.studyEndsAt)
      await transaction.user.update({ where: { id: row.userId }, data: { studentVerified: approved, studentVerifiedUntil: latestApproved?.studyEndsAt || null, verificationStatus: approved ? 'APPROVED' : status as VerificationStatus } })
      await audit(transaction, actorId, `VERIFICATION_${status}`, 'STUDENT_VERIFICATION', row.id, { status: previous.status }, { status, reason, enrollmentCheckStatus, ...(status === 'APPROVED' ? { studentIdMatchesEmail: true, studyEndsAt: decision.data.studyEndsAt, evidenceRetainUntil: evidenceRetainUntil?.toISOString().slice(0, 10) } : {}) })
      await notify(transaction, row.userId, previous.user.email, 'STUDENT_VERIFICATION', `Student verification ${status.toLowerCase()}`, status === 'APPROVED' ? 'Your student verification has been approved.' : `Your student verification was rejected: ${reason}`, row.id)
      return row
    })
    if (!changed) return void fail(res, 409, 'This verification has already been reviewed.', 'ALREADY_REVIEWED')
    if (status === 'REJECTED') await processPendingFileDeletions({ ownerId: previous.userId, limit: 50 }).catch(() => {})
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
        prisma.user.findUnique({ where: { id: previous.ownerId }, select: { status: true, roles: true, emailVerifiedAt: true, studentVerified: true, studentVerifiedUntil: true } }),
        prisma.propertyAuthorization.findFirst({ where: { listingId: previous.id, requesterId: previous.ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, expiresAt: true, addressSnapshot: true } }),
      ])
      const identity = owner?.roles.includes('LANDLORD') ? await prisma.landlordVerification.findFirst({ where: { userId: previous.ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, expiresAt: true } }) : null
      if (!owner || owner.status !== 'ACTIVE' || !owner.emailVerifiedAt || !(owner.roles.includes('LANDLORD') ? approvalIsCurrent(identity) : owner.roles.includes('STUDENT') && studentVerificationIsCurrent(owner))) return void fail(res, 400, 'The listing owner must complete account verification before publication.', 'IDENTITY_REQUIRED')
      if (!approvalIsCurrent(authorization) || authorization?.addressSnapshot !== previous.address) return void fail(res, 400, 'Approve proof of rental authority for this exact address before publication.', 'AUTHORIZATION_REQUIRED')
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
        const identity = owner.roles.includes('LANDLORD') ? await transaction.landlordVerification.findFirst({ where: { userId: owner.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, expiresAt: true } }) : null
        if (listing.status !== previous.status || listing.address !== previous.address || owner.status !== 'ACTIVE' || !owner.emailVerifiedAt || !(owner.roles.includes('LANDLORD') ? approvalIsCurrent(identity) : owner.roles.includes('STUDENT') && studentVerificationIsCurrent(owner)) || !approvalIsCurrent(authorization) || authorization?.addressSnapshot !== listing.address) throw new ModerationConflict()
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
