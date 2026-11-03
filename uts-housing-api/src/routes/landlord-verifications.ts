import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireAuth } from '../core/auth.js'
import { approvalIsCurrent, effectiveApprovalStatus } from '../core/approval.js'
import { asyncRoute, fail, ok } from '../core/http.js'

const router = Router()
const MAX_PROOF_BYTES = 5_000_000
const MAX_DAILY_SUBMISSIONS = 3
class PendingConflict extends Error {}
class SubmissionLimitConflict extends Error {}
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PROOF_BYTES, files: 3, fields: 2 } })

export function landlordProofDirectory() {
  return resolve(process.env.MEDIA_PRIVATE_DIR || './data/private', 'landlord-verifications')
}

export async function removeStoredLandlordDocuments(keys: Array<string | null | undefined>) {
  const safeKeys = [...new Set(keys.filter((key): key is string => Boolean(key && /^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(key))))]
  await Promise.all(safeKeys.map(key => rm(resolve(landlordProofDirectory(), key), { force: true })))
}

export function landlordProofMime(buffer: Buffer, declaredMime: string): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  const detected = buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-' ? 'application/pdf'
    : buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? 'image/jpeg'
      : buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : null
  return detected && detected === declaredMime ? detected : null
}

type Proof = { file: Express.Multer.File; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; storageKey: string }

function proofFrom(files: Record<string, Express.Multer.File[]>, name: string, imageOnly = false): Proof | null {
  const file = files[name]?.[0]
  if (!file || !file.size || file.size > MAX_PROOF_BYTES) return null
  const mimeType = landlordProofMime(file.buffer, file.mimetype)
  if (!mimeType || (imageOnly && mimeType === 'application/pdf')) return null
  return { file, mimeType, storageKey: `${randomUUID()}${mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/jpeg' ? '.jpg' : '.png'}` }
}

async function storeProofs(proofs: Proof[], written: string[]) {
  const directory = landlordProofDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const proof of proofs) {
    written.push(proof.storageKey)
    await writeFile(resolve(directory, proof.storageKey), proof.file.buffer, { flag: 'wx', mode: 0o600 })
  }
}

function latestOf(row: { id: string; kind: string; status: string; reason: string | null; createdAt: Date; reviewedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null } | null) {
  return row ? { id: row.id, kind: row.kind, status: effectiveApprovalStatus(row), reason: row.reason, createdAt: row.createdAt, reviewedAt: row.reviewedAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt } : null
}

function uploadFields(fields: Array<{ name: string; maxCount: number }>) {
  return (req: Request, res: Response, next: NextFunction) => fileUpload.fields(fields)(req, res, error => {
    if (!error) return next()
    fail(res, 400, error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'Each verification document must be no larger than 5 MB.'
      : 'Upload only the requested verification documents.', 'INVALID_PROOF')
  })
}

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  if (!user.roles.includes('LANDLORD')) return fail(res, 403, 'Only landlords can request identity verification.', 'FORBIDDEN')
  const latest = await prisma.landlordVerification.findFirst({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return ok(res, { status: effectiveApprovalStatus(latest), latest: latestOf(latest) })
}))

router.post('/identity', requireAuth, uploadFields([
  { name: 'identity', maxCount: 1 }, { name: 'companyRegistration', maxCount: 1 }, { name: 'representativeAuthority', maxCount: 1 },
]), async (req, res, next) => {
  const written: string[] = []
  let committed = false
  try {
    const user = currentUser(req)!
    if (!user.roles.includes('LANDLORD')) return void fail(res, 403, 'Only landlords can request identity verification.', 'FORBIDDEN')
    if (!user.emailVerifiedAt) return void fail(res, 403, 'Verify your email before submitting identity documents.', 'EMAIL_UNVERIFIED')
    const profile = await prisma.profile.findUnique({ where: { userId: user.id }, select: { phone: true } })
    if (!profile?.phone) return void fail(res, 400, 'Add a contact phone number to your landlord profile first.', 'PHONE_REQUIRED')
    const kind = z.enum(['INDIVIDUAL', 'COMPANY']).safeParse(req.body?.kind)
    if (!kind.success) return void fail(res, 400, 'Choose individual or company verification.', 'INVALID_KIND')
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>
    const identity = proofFrom(files, 'identity', true)
    const company = kind.data === 'COMPANY' ? proofFrom(files, 'companyRegistration') : null
    const representative = kind.data === 'COMPANY' ? proofFrom(files, 'representativeAuthority') : null
    if (!identity || (kind.data === 'COMPANY' && (!company || !representative)) || (kind.data === 'INDIVIDUAL' && (files.companyRegistration?.length || files.representativeAuthority?.length))) {
      return void fail(res, 400, 'Upload an ID photo; companies also need registration and representative-authority documents.', 'INVALID_PROOF')
    }
    const proofs = [identity, company, representative].filter((proof): proof is Proof => !!proof)
    await storeProofs(proofs, written)
    const record = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text`
      const [freshOwner, freshProfile] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: user.id } }),
        tx.profile.findUnique({ where: { userId: user.id }, select: { phone: true } }),
      ])
      if (freshOwner.status !== 'ACTIVE' || !freshOwner.roles.includes('LANDLORD') || !freshOwner.emailVerifiedAt || !freshProfile?.phone) throw new Error('ACCOUNT_CHANGED')
      if (await tx.landlordVerification.findFirst({ where: { userId: user.id, status: 'PENDING' } })) throw new PendingConflict()
      const recent = await tx.landlordVerification.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
      if (recent >= MAX_DAILY_SUBMISSIONS) throw new SubmissionLimitConflict()
      // Keep evidence for rejected, revoked and superseded cases until the
      // configured retention period ends. Only failed, uncommitted uploads are
      // removed immediately below.
      const previous = await tx.landlordVerification.findFirst({ where: { userId: user.id, status: 'APPROVED' } })
      if (previous) {
        const invalidatedAt = new Date()
        await tx.landlordVerification.updateMany({ where: { userId: user.id, status: 'APPROVED' }, data: { status: 'REJECTED', reason: 'Superseded by a new identity application.', reviewedAt: invalidatedAt } })
        await tx.propertyAuthorization.updateMany({ where: { requesterId: user.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REJECTED', reason: 'Landlord identity changed; submit new property proof.', reviewedAt: invalidatedAt } })
        await tx.listing.updateMany({ where: { ownerId: user.id, status: 'PUBLISHED' }, data: { status: 'PAUSED', reviewedAt: null, moderationReason: 'Landlord identity must be reviewed again.' } })
      }
      for (const proof of proofs) await tx.mediaUpload.create({ data: { ownerId: user.id, storageKey: proof.storageKey, mimeType: proof.mimeType, size: proof.file.size, purpose: 'LANDLORD_IDENTITY', status: 'READY' } })
      return tx.landlordVerification.create({ data: { userId: user.id, kind: kind.data, identityKey: identity.storageKey, companyKey: company?.storageKey, representationKey: representative?.storageKey } })
    })
    committed = true
    return void ok(res, { id: record.id, kind: record.kind, status: record.status, createdAt: record.createdAt }, 201)
  } catch (error) {
    if (!committed) await removeStoredLandlordDocuments(written).catch(() => {})
    if (error instanceof PendingConflict) return void fail(res, 409, 'Your landlord identity application is already pending.', 'VERIFICATION_PENDING')
    if (error instanceof SubmissionLimitConflict) return void fail(res, 429, 'You can submit identity documents up to three times in 24 hours.', 'VERIFICATION_RATE_LIMITED')
    if (error instanceof Error && error.message === 'ACCOUNT_CHANGED') return void fail(res, 409, 'Your account changed while uploading documents. Refresh and try again.', 'ACCOUNT_CHANGED')
    next(error)
  }
})

router.get('/listings/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req)!
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true, ownerId: true, address: true } })
  if (!listing || (listing.ownerId !== user.id && !user.roles.includes('ADMIN'))) return fail(res, 404, 'This listing could not be found.', 'NOT_FOUND')
  const latest = await prisma.propertyAuthorization.findFirst({ where: { listingId: listing.id, addressSnapshot: listing.address || '' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return ok(res, { status: effectiveApprovalStatus(latest), latest: latestOf(latest) })
}))

router.post('/listings/:id', requireAuth, uploadFields([{ name: 'proof', maxCount: 1 }, { name: 'supporting', maxCount: 1 }]), async (req, res, next) => {
  const written: string[] = []
  let committed = false
  try {
    const user = currentUser(req)!
    const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, select: { id: true, ownerId: true, address: true, status: true } })
    if (!listing || listing.ownerId !== user.id) return void fail(res, 404, 'This listing could not be found.', 'NOT_FOUND')
    if (listing.status === 'ARCHIVED') return void fail(res, 409, 'Archived listings cannot be verified.', 'INVALID_STATUS')
    if (!user.emailVerifiedAt) return void fail(res, 403, 'Verify your email before submitting property documents.', 'EMAIL_UNVERIFIED')
    const isLandlord = user.roles.includes('LANDLORD')
    const isVerifiedStudent = user.roles.includes('STUDENT') && user.studentVerified
    if (!isLandlord && !isVerifiedStudent) return void fail(res, 403, 'Only verified landlords or students can submit property authorization.', 'FORBIDDEN')
    if (isLandlord) {
      const identity = await prisma.landlordVerification.findFirst({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      if (!approvalIsCurrent(identity)) return void fail(res, 403, 'Approve your landlord identity before submitting a property authorization.', 'LANDLORD_IDENTITY_REQUIRED')
    }
    if (!listing.address || listing.address.trim().length < 10 || listing.address.trim().length > 250) return void fail(res, 400, 'Enter the full property address first.', 'ADDRESS_REQUIRED')
    const kind = z.enum(['OWNER', 'AGENT', 'SUBLETTING']).safeParse(req.body?.kind)
    if (!kind.success || (!isLandlord && kind.data !== 'SUBLETTING')) return void fail(res, 400, 'Choose an allowed property relationship.', 'INVALID_KIND')
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>
    const proof = proofFrom(files, 'proof')
    const supporting = files.supporting?.length ? proofFrom(files, 'supporting') : null
    if (!proof || (kind.data !== 'OWNER' && !supporting) || (kind.data === 'OWNER' && files.supporting?.length)) return void fail(res, 400, 'Upload ownership proof, or a lease/owner proof plus written authorization for agents and sublets.', 'INVALID_PROOF')
    const proofs = [proof, supporting].filter((item): item is Proof => !!item)
    await storeProofs(proofs, written)
    const record = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${listing.id}))::text`
      const freshOwner = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      const freshIdentity = isLandlord ? await tx.landlordVerification.findFirst({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : null
      if (freshOwner.status !== 'ACTIVE' || !freshOwner.emailVerifiedAt || !(isLandlord ? freshOwner.roles.includes('LANDLORD') && approvalIsCurrent(freshIdentity) : freshOwner.roles.includes('STUDENT') && freshOwner.studentVerified)) throw new Error('IDENTITY_CHANGED')
      const fresh = await tx.listing.findUniqueOrThrow({ where: { id: listing.id }, select: { address: true, status: true } })
      if (fresh.address !== listing.address || fresh.status === 'ARCHIVED') throw new Error('LISTING_CHANGED')
      if (await tx.propertyAuthorization.findFirst({ where: { listingId: listing.id, addressSnapshot: listing.address!, status: 'PENDING' } })) throw new PendingConflict()
      const recent = await tx.propertyAuthorization.count({ where: { listingId: listing.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
      if (recent >= MAX_DAILY_SUBMISSIONS) throw new SubmissionLimitConflict()
      await tx.propertyAuthorization.updateMany({ where: { listingId: listing.id, status: 'APPROVED' }, data: { status: 'REJECTED', reason: 'Superseded by a new property authorization application.', reviewedAt: new Date() } })
      if (fresh.status === 'PUBLISHED') await tx.listing.update({ where: { id: listing.id }, data: { status: 'PAUSED', reviewedAt: null, moderationReason: 'Property authorization must be reviewed again.' } })
      for (const item of proofs) await tx.mediaUpload.create({ data: { ownerId: user.id, storageKey: item.storageKey, mimeType: item.mimeType, size: item.file.size, purpose: 'PROPERTY_AUTHORIZATION', status: 'READY' } })
      return tx.propertyAuthorization.create({ data: { listingId: listing.id, requesterId: user.id, kind: kind.data, proofKey: proof.storageKey, supportingKey: supporting?.storageKey, addressSnapshot: listing.address! } })
    })
    committed = true
    return void ok(res, { id: record.id, kind: record.kind, status: record.status, createdAt: record.createdAt }, 201)
  } catch (error) {
    if (!committed) await removeStoredLandlordDocuments(written).catch(() => {})
    if (error instanceof PendingConflict) return void fail(res, 409, 'A property authorization application is already pending for this address.', 'VERIFICATION_PENDING')
    if (error instanceof SubmissionLimitConflict) return void fail(res, 429, 'You can submit property documents up to three times in 24 hours.', 'VERIFICATION_RATE_LIMITED')
    if (error instanceof Error && error.message === 'IDENTITY_CHANGED') return void fail(res, 409, 'Your account verification changed. Refresh and try again.', 'IDENTITY_CHANGED')
    if (error instanceof Error && error.message === 'LISTING_CHANGED') return void fail(res, 409, 'The listing changed while you submitted documents. Refresh and try again.', 'LISTING_CHANGED')
    next(error)
  }
})

export default router
