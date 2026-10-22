import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireRole } from '../core/auth.js'
import { fail, ok } from '../core/http.js'

const router = Router()
const MAX_PROOF_BYTES = 5_000_000
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PROOF_BYTES, files: 1, fields: 4 } })
const universitySchema = z.string().trim().min(2).max(160)
const noteSchema = z.string().trim().max(500).optional()

export function verificationProofDirectory() {
  return resolve(process.env.MEDIA_PRIVATE_DIR || './data/private', 'verifications')
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
  upload.single('proof')(req, res, error => {
    if (!error) return next()
    const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
      ? 'The proof document must be no larger than 5 MB.'
      : 'Upload one PDF, JPG or PNG proof document no larger than 5 MB.'
    fail(res, 400, message, 'INVALID_PROOF')
  })
}

router.post('/', requireRole('STUDENT'), uploadedProof, async (req, res, next) => {
  let storedProofPath: string | null = null
  try {
    const user = currentUser(req)!
    if (user.studentVerified) return void fail(res, 409, 'Your student status is already verified.', 'ALREADY_VERIFIED')
    const pending = await prisma.studentVerification.findFirst({ where: { userId: user.id, status: 'PENDING' } })
    if (pending) return void fail(res, 409, 'Your student verification request is already pending.', 'VERIFICATION_PENDING')

    const method = req.body?.method
    const university = universitySchema.safeParse(req.body?.university)
    if (!university.success) return void fail(res, 400, 'Enter a valid university name.', 'INVALID_UNIVERSITY')
    if (method !== 'EMAIL_DOMAIN' && method !== 'MANUAL') return void fail(res, 400, 'Choose an available verification method.', 'INVALID_METHOD')

    if (method === 'EMAIL_DOMAIN') {
      if (!user.emailVerifiedAt) return void fail(res, 403, 'Verify your account email before using university email verification.', 'EMAIL_UNVERIFIED')
      const emailDomain = user.email.toLowerCase().split('@')[1]
      const campuses = await prisma.campus.findMany({ where: { active: true }, select: { university: true, domains: true } })
      const matchedCampus = campuses.find(campus => campus.university.trim().toLowerCase() === university.data.toLowerCase() && campus.domains.some(domain => domain.trim().toLowerCase() === emailDomain))
      if (!matchedCampus) return void fail(res, 400, 'This email domain is not approved for the selected university. Choose manual review.', 'DOMAIN_NOT_APPROVED')
      const record = await prisma.$transaction(async transaction => {
        const verification = await transaction.studentVerification.create({ data: { userId: user.id, method: 'EMAIL_DOMAIN', university: university.data, status: 'APPROVED', reviewedAt: new Date() } })
        await transaction.user.update({ where: { id: user.id }, data: { studentVerified: true, verificationStatus: 'APPROVED' } })
        await transaction.notification.create({ data: { userId: user.id, type: 'STUDENT_VERIFIED', payload: { verificationId: verification.id, method: 'EMAIL_DOMAIN' } } })
        return verification
      })
      return void ok(res, { id: record.id, method: record.method, status: record.status, createdAt: record.createdAt }, 201)
    }

    const note = noteSchema.safeParse(req.body?.note)
    if (!note.success) return void fail(res, 400, 'The verification note must be 500 characters or fewer.', 'INVALID_NOTE')
    const file = req.file
    if (!file || file.size === 0 || file.size > MAX_PROOF_BYTES) return void fail(res, 400, 'Upload one PDF, JPG or PNG proof document no larger than 5 MB.', 'INVALID_PROOF')
    const mimeType = verificationProofMime(file.buffer, file.mimetype)
    if (!mimeType) return void fail(res, 400, 'The proof document content does not match its PDF, JPG or PNG file type.', 'INVALID_PROOF')
    const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/jpeg' ? '.jpg' : '.png'
    const storageKey = `${randomUUID()}${extension}`
    const directory = verificationProofDirectory()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    storedProofPath = resolve(directory, storageKey)
    await writeFile(storedProofPath, file.buffer, { flag: 'wx', mode: 0o600 })
    const record = await prisma.$transaction(async transaction => {
      await transaction.mediaUpload.create({ data: { ownerId: user.id, storageKey, mimeType, size: file.size, purpose: 'VERIFICATION', status: 'READY' } })
      const verification = await transaction.studentVerification.create({ data: { userId: user.id, method: 'MANUAL', university: university.data, proofKey: storageKey, note: note.data || null, status: 'PENDING' } })
      await transaction.user.update({ where: { id: user.id }, data: { studentVerified: false, verificationStatus: 'PENDING' } })
      return verification
    })
    return void ok(res, { id: record.id, method: record.method, status: record.status, createdAt: record.createdAt }, 201)
  } catch (error) {
    if (storedProofPath) await rm(storedProofPath, { force: true }).catch(() => {})
    next(error)
  }
})

export default router
