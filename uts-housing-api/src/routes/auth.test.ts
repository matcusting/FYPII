import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

const database = vi.hoisted(() => ({
  campus: { findMany: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn() },
  authToken: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  emailJob: { create: vi.fn() },
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}))
const queueEmail = vi.hoisted(() => vi.fn())

vi.mock('express-rate-limit', () => ({ rateLimit: () => ((_req: Request, _res: Response, next: NextFunction) => next()) as RequestHandler }))
vi.mock('argon2', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed-password') } }))
vi.mock('../core/db.js', () => ({ prisma: { campus: database.campus, user: database.user, $transaction: database.transaction } }))
vi.mock('../core/auth.js', () => ({
  clearSession: vi.fn(), createSession: vi.fn(), currentUser: vi.fn(),
  requireAuth: ((_req: Request, _res: Response, next: NextFunction) => next()) as RequestHandler,
  tokenHash: () => 'token-hash',
}))
vi.mock('../core/mail.js', () => ({ queueEmail }))

import router from './auth.js'

function post(path: string, body: Record<string, unknown>) {
  const request = { method: 'POST', url: path, originalUrl: path, body } as unknown as Request
  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    let statusCode = 200
    const responseMethods = {
      status(code: number) { statusCode = code; return responseMethods },
      json(data: Record<string, unknown>) { resolve({ status: statusCode, data }); return responseMethods },
    }
    router(request, responseMethods as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}
const register = (body: Record<string, unknown>) => post('/register', body)

beforeEach(() => {
  vi.clearAllMocks()
  database.campus.findMany.mockResolvedValue([{ domains: ['student.uts.edu.my'] }])
  database.user.findUnique.mockResolvedValue(null)
  database.user.create.mockResolvedValue({ id: 'new-user', name: 'New Student', email: 'bcs123@student.uts.edu.my' })
  database.authToken.create.mockResolvedValue({ id: 'token' })
  database.authToken.findFirst.mockResolvedValue(null)
  database.authToken.updateMany.mockResolvedValue({ count: 1 })
  database.emailJob.create.mockResolvedValue({ id: 'email-job' })
  database.queryRaw.mockResolvedValue([])
  database.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ user: database.user, authToken: database.authToken, emailJob: database.emailJob, $queryRaw: database.queryRaw }))
  queueEmail.mockResolvedValue(undefined)
})

describe('resending email verification', () => {
  const address = 'new.student@student.uts.edu.my'

  it('uses the same response for unknown and already verified accounts', async () => {
    const missing = await post('/resend-verification', { email: address })
    expect(missing).toEqual({ status: 200, data: { data: { accepted: true } } })
    database.user.findUnique.mockResolvedValueOnce({ id: 'student-1' }).mockResolvedValueOnce({ email: address, name: 'Student', status: 'ACTIVE', emailVerifiedAt: new Date() })
    const verified = await post('/resend-verification', { email: address })
    expect(verified).toEqual(missing)
    expect(database.authToken.create).not.toHaveBeenCalled()
    expect(database.emailJob.create).not.toHaveBeenCalled()
  })

  it('rejects malformed addresses and applies a per-account cooldown', async () => {
    expect((await post('/resend-verification', { email: 'not-an-email' })).status).toBe(400)
    database.user.findUnique.mockResolvedValueOnce({ id: 'student-1' }).mockResolvedValueOnce({ email: address, name: 'Student', status: 'ACTIVE', emailVerifiedAt: null })
    database.authToken.findFirst.mockResolvedValue({ createdAt: new Date() })
    expect((await post('/resend-verification', { email: address })).status).toBe(200)
    expect(database.authToken.updateMany).not.toHaveBeenCalled()
    expect(database.emailJob.create).not.toHaveBeenCalled()
  })

  it('expires previous links and queues a replacement after the cooldown', async () => {
    database.user.findUnique.mockResolvedValueOnce({ id: 'student-1' }).mockResolvedValueOnce({ email: address, name: 'Student', status: 'ACTIVE', emailVerifiedAt: null })
    database.authToken.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 11 * 60_000) })
    const result = await post('/resend-verification', { email: address.toUpperCase() })
    expect(result).toEqual({ status: 200, data: { data: { accepted: true } } })
    expect(database.authToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'student-1', kind: 'EMAIL_VERIFY', usedAt: null } }))
    expect(database.authToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'student-1', kind: 'EMAIL_VERIFY' }) }))
    expect(database.emailJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ to: address, template: 'email-verification' }) }))
  })
})

describe('school email registration', () => {
  const base = { name: 'New Student', password: 'A-strong-password-123', acceptTerms: true }

  it('rejects a personal email for student registration before creating an account', async () => {
    const result = await register({ ...base, email: 'new.student@example.com', role: 'STUDENT' })
    expect(result.status).toBe(400)
    expect(result.data).toMatchObject({ error: { code: 'STUDENT_EMAIL_REQUIRED' } })
    expect((await register({ ...base, email: 'new.student@student.uts.edu.my.example.com', role: 'STUDENT' })).status).toBe(400)
    expect(database.user.create).not.toHaveBeenCalled()
    expect(queueEmail).not.toHaveBeenCalled()
  })

  it('accepts an exact active campus domain and normalizes email casing', async () => {
    const result = await register({ ...base, email: 'BCS123@STUDENT.UTS.EDU.MY', role: 'STUDENT' })
    expect(result.status).toBe(201)
    expect(database.campus.findMany).toHaveBeenCalledWith({ where: { active: true }, select: { domains: true } })
    expect(database.user.findUnique).toHaveBeenCalledWith({ where: { email: 'bcs123@student.uts.edu.my' }, select: { id: true } })
    expect(database.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roles: ['STUDENT'], email: 'bcs123@student.uts.edu.my' }) }))
    expect(queueEmail).toHaveBeenCalledOnce()
  })

  it('keeps landlord registration available with a personal email', async () => {
    const result = await register({ ...base, email: 'landlord@example.com', role: 'LANDLORD', phone: '+60 12-345 6789' })
    expect(result.status).toBe(201)
    expect(database.campus.findMany).not.toHaveBeenCalled()
    expect(database.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ profile: { create: { displayName: base.name, phone: '+60 12-345 6789' } } }) }))
  })

  it('requires a valid contact number for landlord registration', async () => {
    expect((await register({ ...base, email: 'landlord@example.com', role: 'LANDLORD' })).data).toMatchObject({ error: { code: 'PHONE_REQUIRED' } })
    expect((await register({ ...base, email: 'landlord@example.com', role: 'LANDLORD', phone: '123' })).status).toBe(400)
    expect(database.user.create).not.toHaveBeenCalled()
  })
})
