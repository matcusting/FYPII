import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findPending: vi.fn(), countSubmissions: vi.fn(), findCampuses: vi.fn(), createMedia: vi.fn(), createVerification: vi.fn(), updateUser: vi.fn(), findUser: vi.fn(), transaction: vi.fn(), lock: vi.fn(),
}))
vi.mock('../core/db.js', () => ({ prisma: {
  studentVerification: { findFirst: db.findPending, count: db.countSubmissions }, campus: { findMany: db.findCampuses }, $transaction: db.transaction,
} }))
vi.mock('../core/auth.js', () => ({
  currentUser: (req: { authUser?: unknown }) => req.authUser || null,
  requireRole: () => ((req, res, next) => req.authUser ? next() : res.status(401).json({ error: { code: 'UNAUTHORIZED' } })) as RequestHandler,
}))

import router from './verifications.js'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11])
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
const student = { id: 'student-1', email: 'sample@student.uts.edu.my', roles: ['STUDENT'], emailVerifiedAt: new Date(), studentVerified: false }
let privateDir: string

async function submit({ method = 'DOCUMENTS', studentId = true, offerLetter = true, idMime = 'image/jpeg', emailVerified = true } = {}) {
  const form = new FormData()
  form.set('method', method)
  if (studentId) form.set('studentId', new Blob([jpeg], { type: idMime }), 'student-id.jpg')
  if (offerLetter) form.set('offerLetter', new Blob([pdf], { type: 'application/pdf' }), 'offer-letter.pdf')
  const request = new globalThis.Request('http://localhost/verifications', { method: 'POST', body: form })
  const bytes = Buffer.from(await request.arrayBuffer())
  const stream = Readable.from([bytes]) as unknown as Request
  Object.assign(stream, {
    method: 'POST', url: '/', originalUrl: '/', authUser: { ...student, emailVerifiedAt: emailVerified ? student.emailVerifiedAt : null },
    headers: { 'content-type': request.headers.get('content-type'), 'content-length': String(bytes.length) },
  })
  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    let status = 200
    const response = {
      status(code: number) { status = code; return response },
      json(data: Record<string, unknown>) { resolve({ status, data }); return response },
    }
    router(stream, response as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}

beforeEach(async () => {
  privateDir = await mkdtemp(join(tmpdir(), 'student-verification-test-'))
  process.env.MEDIA_PRIVATE_DIR = privateDir
  vi.clearAllMocks()
  db.findPending.mockResolvedValue(null)
  db.countSubmissions.mockResolvedValue(0)
  db.findCampuses.mockResolvedValue([{ university: 'University of Technology Sarawak', domains: ['student.uts.edu.my'] }])
  db.createMedia.mockResolvedValue({})
  db.createVerification.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'verification-1', createdAt: new Date() }))
  db.updateUser.mockResolvedValue({})
  db.findUser.mockResolvedValue({ ...student, status: 'ACTIVE' })
  db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: db.lock, mediaUpload: { create: db.createMedia }, studentVerification: { create: db.createVerification, findFirst: db.findPending, count: db.countSubmissions }, user: { findUnique: db.findUser, update: db.updateUser },
  }))
})
afterEach(async () => {
  delete process.env.MEDIA_PRIVATE_DIR
  if (privateDir) await rm(privateDir, { recursive: true, force: true })
})

describe('two-document student verification', () => {
  it('stores both documents privately and submits a pending review for a verified school email', async () => {
    const result = await submit()
    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({ data: { method: 'DOCUMENTS', status: 'PENDING' } })
    expect(db.createMedia).toHaveBeenCalledTimes(2)
    expect(db.createVerification).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      university: 'University of Technology Sarawak', studentIdKey: expect.stringMatching(/\.jpg$/), offerLetterKey: expect.stringMatching(/\.pdf$/),
    }) }))
    expect(await readdir(join(privateDir, 'verifications'))).toHaveLength(2)
  })

  it('requires both files and an already verified school email', async () => {
    expect((await submit({ offerLetter: false })).status).toBe(400)
    expect((await submit({ emailVerified: false })).status).toBe(403)
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('rejects the retired email-only method and an ID file with the wrong media type', async () => {
    expect((await submit({ method: 'EMAIL_DOMAIN' })).status).toBe(400)
    expect((await submit({ idMime: 'application/pdf' })).status).toBe(400)
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('limits repeated submissions to three attempts in 24 hours', async () => {
    db.countSubmissions.mockResolvedValue(3)
    const result = await submit()
    expect(result.status).toBe(429)
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('discards uploaded files if the account was deleted before the transaction', async () => {
    db.findUser.mockResolvedValue({ ...student, status: 'DELETED' })
    const result = await submit()
    expect(result.status).toBe(409)
    expect(result.data).toMatchObject({ error: { code: 'ACCOUNT_CHANGED' } })
    expect(db.createMedia).not.toHaveBeenCalled()
    expect(await readdir(join(privateDir, 'verifications'))).toHaveLength(0)
  })
})
