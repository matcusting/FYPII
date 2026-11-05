import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { studentVerificationIsCurrent } from '../core/student-verification.js'
import { currentUser, requireRole } from '../core/auth.js'
import { MalwareScanError, scanUploadedProof } from '../core/malware-scan.js'
import { fail, ok } from '../core/http.js'

const router = Router()
const MAX_PROOF_BYTES = 5_000_000
const MAX_DAILY_SUBMISSIONS = 3
class PendingVerificationConflict extends Error {}
class SubmissionLimitConflict extends Error {}
class AccountChangedConflict extends Error {}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PROOF_BYTES, files: 2, fields: 3 } })
const noteSchema = z.string().trim().max(500).optional()

export function verificationProofDirectory() {
  return resolve(process.env.MEDIA_PRIVATE_DIR || './data/private', 'verifications')
}

export async function removeStoredVerificationDocuments(keys: Array<string | null | undefined>) {
  const safeKeys = [...new Set(keys.filter((key): key is string => Boolean(key && /^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(key))))]
  await Promise.all(safeKeys.map(key => rm(resolve(verificationProofDirectory(), key), { force: true })))
}

function proofType(buffer: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  return null
}

export function verificationProofMime(buffer: Buffer, declaredMime: string) {
  const detected = proofType(buffer)
  return detected && detected === declaredMime ? detected : null
}

function uploadedProof(req: Request, res: Response, next: NextFunction) {
  upload.fields([{ name: 'studentId', maxCount: 1 }, { name: 'offerLetter', maxCount: 1 }])(req, res, error => {
    if (!error) return next()
    const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'Each student verification document must be no larger than 5 MB.'
      : 'Upload one student ID photo and one offer letter file.'
    fail(res, 400, message, 'INVALID_PROOF')
  })
}

router.post('/', requireRole('STUDENT'), uploadedProof, async (req, res, next) => {
  const storedProofPaths: string[] = []
  try {
    const user = currentUser(req)!
    if (studentVerificationIsCurrent(user)) return void fail(res, 409, 'Your student status is already verified.', 'ALREADY_VERIFIED')
    const pending = await prisma.studentVerification.findFirst({ where: { userId: user.id, status: 'PENDING' } })
    if (pending) return void fail(res, 409, 'Your student verification request is already pending.', 'VERIFICATION_PENDING')
    const recentSubmissions = await prisma.studentVerification.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    if (recentSubmissions >= MAX_DAILY_SUBMISSIONS) return void fail(res, 429, 'You can submit student verification documents up to three times in 24 hours.', 'VERIFICATION_RATE_LIMITED')

    if (req.body?.method !== 'DOCUMENTS') return void fail(res, 400, 'Submit both documents with the DOCUMENTS verification method.', 'INVALID_METHOD')
    if (!user.emailVerifiedAt) return void fail(res, 403, 'Verify your school email before submitting student documents.', 'EMAIL_UNVERIFIED')
    const emailDomain = user.email.toLowerCase().split('@')[1]
    const campuses = await prisma.campus.findMany({ where: { active: true }, select: { university: true, domains: true } })
    const matchedCampus = campuses.find(campus => campus.domains.some(domain => domain.trim().toLowerCase() === emailDomain))
    if (!matchedCampus) return void fail(res, 400, 'Your verified school email domain is not configured for student verification.', 'DOMAIN_NOT_APPROVED')

    const note = noteSchema.safeParse(req.body?.note)
    if (!note.success) return void fail(res, 400, 'The verification note must be 500 characters or fewer.', 'INVALID_NOTE')
    const files = (req.files || {}) as Record<string, Express.Multer.File[]>
    const studentId = files.studentId?.[0]
    const offerLetter = files.offerLetter?.[0]
    if (!studentId || !offerLetter || studentId.size === 0 || offerLetter.size === 0 || studentId.size > MAX_PROOF_BYTES || offerLetter.size > MAX_PROOF_BYTES) {
      return void fail(res, 400, 'Upload a student ID JPG/PNG and an offer letter PDF/JPG/PNG, each no larger than 5 MB.', 'INVALID_PROOF')
    }
    const studentIdMime = verificationProofMime(studentId.buffer, studentId.mimetype)
    const offerLetterMime = verificationProofMime(offerLetter.buffer, offerLetter.mimetype)
    if (!studentIdMime || studentIdMime === 'application/pdf' || !offerLetterMime) {
      return void fail(res, 400, 'The student ID must be JPG/PNG and the offer letter must be PDF/JPG/PNG with matching file content.', 'INVALID_PROOF')
    }
    const extensionOf = (mimeType: string) => mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/jpeg' ? '.jpg' : '.png'
    const documents = [
      { file: studentId, mimeType: studentIdMime, storageKey: `${randomUUID()}${extensionOf(studentIdMime)}` },
      { file: offerLetter, mimeType: offerLetterMime, storageKey: `${randomUUID()}${extensionOf(offerLetterMime)}` },
    ]
    for (const document of documents) await scanUploadedProof(document.file.buffer)
    const directory = verificationProofDirectory()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    for (const document of documents) {
      const path = resolve(directory, document.storageKey)
      await writeFile(path, document.file.buffer, { flag: 'wx', mode: 0o600 })
      storedProofPaths.push(path)
    }
    const record = await prisma.$transaction(async transaction => {
      // Serialize requests for this student before checking again. Two uploads can
      // otherwise pass the initial pending check at the same time.
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text`
      const freshUser = await transaction.user.findUnique({ where: { id: user.id }, select: { status: true, roles: true, email: true, emailVerifiedAt: true, studentVerified: true, studentVerifiedUntil: true } })
      if (!freshUser || freshUser.status !== 'ACTIVE' || !freshUser.roles.includes('STUDENT') || !freshUser.emailVerifiedAt || freshUser.email !== user.email || studentVerificationIsCurrent(freshUser)) throw new AccountChangedConflict()
      if (await transaction.studentVerification.findFirst({ where: { userId: user.id, status: 'PENDING' } })) throw new PendingVerificationConflict()
      const submittedToday = await transaction.studentVerification.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
      if (submittedToday >= MAX_DAILY_SUBMISSIONS) throw new SubmissionLimitConflict()
      for (const document of documents) {
        await transaction.mediaUpload.create({ data: { ownerId: user.id, storageKey: document.storageKey, mimeType: document.mimeType, size: document.file.size, purpose: 'VERIFICATION', status: 'READY' } })
      }
      const verification = await transaction.studentVerification.create({ data: {
        userId: user.id, method: 'DOCUMENTS', university: matchedCampus.university,
        studentIdKey: documents[0].storageKey, offerLetterKey: documents[1].storageKey,
        note: note.data || null, status: 'PENDING',
      } })
      await transaction.user.update({ where: { id: user.id }, data: { studentVerified: false, studentVerifiedUntil: null, verificationStatus: 'PENDING' } })
      return verification
    })
    return void ok(res, { id: record.id, method: record.method, status: record.status, createdAt: record.createdAt }, 201)
  } catch (error) {
    await Promise.all(storedProofPaths.map(path => rm(path, { force: true }).catch(() => {})))
    if (error instanceof MalwareScanError) return void fail(res, error.code === 'MALWARE_DETECTED' ? 422 : 503, error.message, error.code)
    if (error instanceof PendingVerificationConflict) return void fail(res, 409, 'Your student verification request is already pending.', 'VERIFICATION_PENDING')
    if (error instanceof SubmissionLimitConflict) return void fail(res, 429, 'You can submit student verification documents up to three times in 24 hours.', 'VERIFICATION_RATE_LIMITED')
    if (error instanceof AccountChangedConflict) return void fail(res, 409, 'Your account changed while submitting documents. Refresh and try again.', 'ACCOUNT_CHANGED')
    next(error)
  }
})

export default router
