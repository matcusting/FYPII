import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireRole } from '../core/auth.js'
import { asyncRoute, fail, ok } from '../core/http.js'
import { landlordProofDirectory, landlordProofMime } from './landlord-verifications.js'

const router = Router()
router.use(requireRole('LAWYER'))
router.use((req, res, next) => {
  const roles = currentUser(req)!.roles
  if (roles.length !== 1 || roles[0] !== 'LAWYER') return void fail(res, 403, 'A dedicated lawyer account is required.', 'FORBIDDEN')
  next()
})

const casePath = z.object({ kind: z.enum(['identity', 'property']), id: z.string().uuid() })
const documentPath = casePath.extend({ document: z.enum(['identity', 'company', 'representative', 'proof', 'supporting']) })
const recommendation = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'NEEDS_MORE_INFO']),
  reason: z.string().trim().min(10).max(2000).regex(/^[^\u0000]+$/),
  sourceReference: z.string().trim().min(4).max(160).regex(/^[^\r\n]+$/).optional(),
  identityMatched: z.boolean().optional(), companyRegistryChecked: z.boolean().optional(),
  authorityChecked: z.boolean().optional(), addressMatched: z.boolean().optional(),
})

async function storedProof(key: string | null, ownerId: string, purpose: 'LANDLORD_IDENTITY' | 'PROPERTY_AUTHORIZATION') {
  if (!key || !/^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(key)) return null
  const upload = await prisma.mediaUpload.findUnique({ where: { storageKey: key } })
  if (!upload || upload.ownerId !== ownerId || upload.purpose !== purpose || upload.status !== 'READY'
    || !['application/pdf', 'image/jpeg', 'image/png'].includes(upload.mimeType) || upload.size < 1 || upload.size > 5_000_000) return null
  const path = resolve(landlordProofDirectory(), key)
  const file = await stat(path).catch(() => null)
  if (!file?.isFile() || file.size !== upload.size) return null
  const bytes = await readFile(path).catch(() => null)
  if (!bytes || landlordProofMime(bytes, upload.mimeType) !== upload.mimeType) return null
  return { bytes, mimeType: upload.mimeType }
}

router.get('/cases', asyncRoute(async (req, res) => {
  const lawyerId = currentUser(req)!.id
  const page = Math.min(10_000, Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1))
  const offset = (page - 1) * 20
  const [ordered, identityTotal, propertyTotal] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; kind: string }>>`
      SELECT id, kind FROM (
        SELECT "id", "createdAt", 'identity'::text AS kind FROM "LandlordVerification" WHERE "lawyerId" = ${lawyerId} AND "status" = 'PENDING'
        UNION ALL
        SELECT "id", "createdAt", 'property'::text AS kind FROM "PropertyAuthorization" WHERE "lawyerId" = ${lawyerId} AND "status" = 'PENDING'
      ) assigned ORDER BY "createdAt" DESC, id DESC OFFSET ${offset} LIMIT 20`,
    prisma.landlordVerification.count({ where: { lawyerId, status: 'PENDING' } }),
    prisma.propertyAuthorization.count({ where: { lawyerId, status: 'PENDING' } }),
  ])
  const [identities, properties] = await Promise.all([
    prisma.landlordVerification.findMany({ where: { id: { in: ordered.filter(row => row.kind === 'identity').map(row => row.id) }, lawyerId, status: 'PENDING' }, include: { user: { select: { name: true } } } }),
    prisma.propertyAuthorization.findMany({ where: { id: { in: ordered.filter(row => row.kind === 'property').map(row => row.id) }, lawyerId, status: 'PENDING' }, include: { requester: { select: { name: true } }, listing: { select: { title: true } } } }),
  ])
  const itemMap = new Map([
    ...identities.map(row => ({ id: row.id, kind: 'identity' as const, status: row.status, applicantName: row.user.name,
      assignedAt: row.lawyerAssignedAt, decision: row.lawyerDecision })),
    ...properties.map(row => ({ id: row.id, kind: 'property' as const, status: row.status, applicantName: row.requester.name,
      listingTitle: row.listing.title, addressSnapshot: row.addressSnapshot,
      assignedAt: row.lawyerAssignedAt, decision: row.lawyerDecision })),
  ].map(item => [`${item.kind}:${item.id}` as string, item] as const))
  const total = identityTotal + propertyTotal
  ok(res, { items: ordered.map(row => itemMap.get(`${row.kind}:${row.id}`)).filter(Boolean), total, page, pages: Math.max(1, Math.ceil(total / 20)) })
}))

router.get('/cases/:kind/:id', asyncRoute(async (req, res) => {
  const path = casePath.safeParse(req.params)
  if (!path.success) return void fail(res, 404, 'Case unavailable.', 'NOT_FOUND')
  const lawyerId = currentUser(req)!.id
  const { kind, id } = path.data
  if (kind === 'identity') {
    const row = await prisma.landlordVerification.findFirst({ where: { id, lawyerId, status: 'PENDING' }, include: { user: { select: { name: true, email: true } } } })
    if (!row) return void fail(res, 404, 'Case unavailable.', 'NOT_FOUND')
    return void ok(res, { id, kind, status: row.status, evidenceKind: row.kind, applicantName: row.user.name, applicantEmail: row.user.email,
      assignedAt: row.lawyerAssignedAt, decision: row.lawyerDecision, reason: row.lawyerReason, sourceReference: row.lawyerSourceReference,
      identityMatched: row.lawyerIdentityMatched, companyRegistryChecked: row.lawyerCompanyRegistryChecked, reviewedAt: row.lawyerReviewedAt,
      ...(row.identityKey ? { identityUrl: `/api/v1/lawyer/cases/identity/${id}/identity` } : {}),
      ...(row.companyKey ? { companyUrl: `/api/v1/lawyer/cases/identity/${id}/company` } : {}),
      ...(row.representationKey ? { representativeUrl: `/api/v1/lawyer/cases/identity/${id}/representative` } : {}),
    })
  }
  const row = await prisma.propertyAuthorization.findFirst({ where: { id, lawyerId, status: 'PENDING' }, include: {
    requester: { select: { name: true, email: true } }, listing: { select: { title: true, address: true } },
  } })
  if (!row) return void fail(res, 404, 'Case unavailable.', 'NOT_FOUND')
  return void ok(res, { id, kind, status: row.status, evidenceKind: row.kind, applicantName: row.requester.name, applicantEmail: row.requester.email,
    listingTitle: row.listing.title, addressSnapshot: row.addressSnapshot, currentListingAddress: row.listing.address,
    assignedAt: row.lawyerAssignedAt, decision: row.lawyerDecision, reason: row.lawyerReason, sourceReference: row.lawyerSourceReference,
    authorityChecked: row.lawyerAuthorityChecked, addressMatched: row.lawyerAddressMatched, reviewedAt: row.lawyerReviewedAt,
    ...(row.proofKey ? { proofUrl: `/api/v1/lawyer/cases/property/${id}/proof` } : {}),
    ...(row.supportingKey ? { supportingUrl: `/api/v1/lawyer/cases/property/${id}/supporting` } : {}),
  })
}))

router.get('/cases/:kind/:id/:document', asyncRoute(async (req, res) => {
  const path = documentPath.safeParse(req.params)
  if (!path.success) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
  const { kind, id, document } = path.data
  if (kind === 'identity' && !['identity', 'company', 'representative'].includes(document)) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
  if (kind === 'property' && !['proof', 'supporting'].includes(document)) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
  const lawyerId = currentUser(req)!.id
  let key: string | null = null
  let ownerId = ''
  if (kind === 'identity') {
    const row = await prisma.landlordVerification.findFirst({ where: { id, lawyerId, status: 'PENDING' }, select: { userId: true, identityKey: true, companyKey: true, representationKey: true } })
    if (!row) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
    ownerId = row.userId
    key = document === 'identity' ? row.identityKey : document === 'company' ? row.companyKey : row.representationKey
  } else {
    const row = await prisma.propertyAuthorization.findFirst({ where: { id, lawyerId, status: 'PENDING' }, select: { requesterId: true, proofKey: true, supportingKey: true } })
    if (!row) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
    ownerId = row.requesterId
    key = document === 'proof' ? row.proofKey : row.supportingKey
  }
  const stored = await storedProof(key, ownerId, kind === 'identity' ? 'LANDLORD_IDENTITY' : 'PROPERTY_AUTHORIZATION')
  if (!stored) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
  // Access checks above are repeated after reading, so reassignment or final
  // decision during I/O never returns the old assignee a private document.
  const stillAssigned = kind === 'identity'
    ? await prisma.landlordVerification.count({ where: { id, lawyerId, status: 'PENDING', identityKey: document === 'identity' ? key : undefined,
      companyKey: document === 'company' ? key : undefined, representationKey: document === 'representative' ? key : undefined } })
    : await prisma.propertyAuthorization.count({ where: { id, lawyerId, status: 'PENDING', proofKey: document === 'proof' ? key : undefined, supportingKey: document === 'supporting' ? key : undefined } })
  if (!stillAssigned) return void fail(res, 404, 'Document unavailable.', 'NOT_FOUND')
  const freshLawyer = await prisma.user.findUnique({ where: { id: lawyerId }, select: { status: true, roles: true } })
  if (!freshLawyer || freshLawyer.status !== 'ACTIVE' || freshLawyer.roles.length !== 1 || freshLawyer.roles[0] !== 'LAWYER') return void fail(res, 403, 'Lawyer access is no longer active.', 'FORBIDDEN')
  await prisma.auditLog.create({ data: { actorId: lawyerId, action: 'LAWYER_DOCUMENT_VIEWED', targetType: kind === 'identity' ? 'LANDLORD_VERIFICATION' : 'PROPERTY_AUTHORIZATION', targetId: id, after: { document } } })
  const extension = stored.mimeType === 'application/pdf' ? '.pdf' : stored.mimeType === 'image/jpeg' ? '.jpg' : '.png'
  res.setHeader('Content-Type', stored.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="case-${document}${extension}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(stored.bytes)
}))

router.post('/cases/:kind/:id/recommendation', asyncRoute(async (req, res) => {
  const path = casePath.safeParse(req.params)
  const body = recommendation.safeParse(req.body)
  if (!path.success || !body.success) return void fail(res, 400, 'Enter a written finding of at least 10 characters and valid review checks.', 'INVALID_RECOMMENDATION')
  const { kind, id } = path.data
  const { decision, reason, sourceReference } = body.data
  if (decision === 'APPROVE' && (!sourceReference || (kind === 'identity' ? body.data.identityMatched !== true : body.data.authorityChecked !== true || body.data.addressMatched !== true))) {
    return void fail(res, 400, 'Approval needs an independent source and completed case checks.', 'INDEPENDENT_CHECK_REQUIRED')
  }
  const lawyerId = currentUser(req)!.id
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`
    const freshLawyer = await tx.user.findUnique({ where: { id: lawyerId }, select: { status: true, roles: true } })
    if (!freshLawyer || freshLawyer.status !== 'ACTIVE' || freshLawyer.roles.length !== 1 || freshLawyer.roles[0] !== 'LAWYER') return 'CHANGED' as const
    if (kind === 'identity') {
      const old = await tx.landlordVerification.findUnique({ where: { id }, select: { userId: true, kind: true, status: true, lawyerId: true, lawyerDecision: true } })
      if (!old || old.status !== 'PENDING' || old.lawyerId !== lawyerId || old.userId === lawyerId) return 'CHANGED' as const
      if (old.lawyerDecision) return 'EXISTS' as const
      if (decision === 'APPROVE' && old.kind === 'COMPANY' && body.data.companyRegistryChecked !== true) return 'CHECKS' as const
      await tx.landlordVerification.update({ where: { id }, data: { lawyerDecision: decision, lawyerReason: reason,
        lawyerSourceReference: sourceReference || null, lawyerIdentityMatched: decision === 'APPROVE' && body.data.identityMatched === true,
        lawyerCompanyRegistryChecked: decision === 'APPROVE' && old.kind === 'COMPANY' && body.data.companyRegistryChecked === true,
        lawyerReviewedAt: new Date() } })
      await tx.auditLog.create({ data: { actorId: lawyerId, action: 'LAWYER_IDENTITY_RECOMMENDATION', targetType: 'LANDLORD_VERIFICATION', targetId: id,
        before: { decision: old.lawyerDecision }, after: { decision, checksComplete: decision === 'APPROVE', sourceRecorded: Boolean(sourceReference) } } })
    } else {
      const old = await tx.propertyAuthorization.findUnique({ where: { id }, select: { requesterId: true, status: true, lawyerId: true, lawyerDecision: true, addressSnapshot: true, listing: { select: { address: true } } } })
      if (!old || old.status !== 'PENDING' || old.lawyerId !== lawyerId || old.requesterId === lawyerId || (decision === 'APPROVE' && old.addressSnapshot !== old.listing.address)) return 'CHANGED' as const
      if (old.lawyerDecision) return 'EXISTS' as const
      await tx.propertyAuthorization.update({ where: { id }, data: { lawyerDecision: decision, lawyerReason: reason,
        lawyerSourceReference: sourceReference || null, lawyerAuthorityChecked: decision === 'APPROVE' && body.data.authorityChecked === true,
        lawyerAddressMatched: decision === 'APPROVE' && body.data.addressMatched === true, lawyerReviewedAt: new Date() } })
      await tx.auditLog.create({ data: { actorId: lawyerId, action: 'LAWYER_PROPERTY_RECOMMENDATION', targetType: 'PROPERTY_AUTHORIZATION', targetId: id,
        before: { decision: old.lawyerDecision }, after: { decision, checksComplete: decision === 'APPROVE', sourceRecorded: Boolean(sourceReference) } } })
    }
    return 'SAVED' as const
  })
  if (result === 'CHECKS') return void fail(res, 400, 'Company registration and representative authority must be checked.', 'INDEPENDENT_CHECK_REQUIRED')
  if (result === 'EXISTS') return void fail(res, 409, 'A recommendation has already been submitted. Ask an administrator to reassign the case if a new review is necessary.', 'RECOMMENDATION_EXISTS')
  if (result !== 'SAVED') return void fail(res, 409, 'This case is no longer assigned to you, or its evidence changed.', 'CASE_CHANGED')
  ok(res, { id, kind, decision })
}))

export default router
