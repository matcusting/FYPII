import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

const database = vi.hoisted(() => ({
  profile: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { update: vi.fn() },
  landlordVerification: { findMany: vi.fn(), updateMany: vi.fn() },
  propertyAuthorization: { findMany: vi.fn(), updateMany: vi.fn() },
  listing: { updateMany: vi.fn() },
  mediaUpload: { deleteMany: vi.fn() },
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('../core/db.js', () => ({ prisma: {
  profile: database.profile,
  $transaction: database.transaction,
} }))
vi.mock('../core/auth.js', () => ({
  currentUser: (req: { authUser?: unknown }) => req.authUser || null,
  requireAuth: ((req, res, next) => req.authUser ? next() : res.status(401).json({ error: { code: 'UNAUTHORIZED' } })) as RequestHandler,
}))

import router from './profile.js'

const landlord = { id: 'landlord-1', name: 'Landlord', email: 'landlord@example.test', roles: ['LANDLORD'], verificationStatus: 'UNVERIFIED' }
const student = { id: 'student-1', name: 'Student', email: 'student@example.test', roles: ['STUDENT'], verificationStatus: 'APPROVED' }
const admin = { id: 'admin-1', name: 'Admin', email: 'admin@example.test', roles: ['ADMIN'], verificationStatus: 'UNVERIFIED' }

function call(method: string, path: string, authUser: typeof landlord, body?: unknown) {
  const request = { method, url: path, originalUrl: path, authUser, body } as unknown as Request
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    let statusCode = 200
    const responseMethods = {
      status(code: number) { statusCode = code; return responseMethods },
      json(data: unknown) { resolve({ status: statusCode, data }); return responseMethods },
    }
    router(request, responseMethods as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  database.profile.findUnique.mockResolvedValue(null)
  database.landlordVerification.findMany.mockResolvedValue([])
  database.propertyAuthorization.findMany.mockResolvedValue([])
  database.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    profile: database.profile, user: database.user, landlordVerification: database.landlordVerification,
    propertyAuthorization: database.propertyAuthorization, listing: database.listing,
    mediaUpload: database.mediaUpload, $queryRaw: database.queryRaw,
  }))
  database.profile.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ ...create, university: null, bio: null, preferredLocation: null, budgetMin: null, budgetMax: null, preferredMoveInDate: null }))
})

describe('private account contact phone', () => {
  it('saves a landlord phone and returns it in the owner profile response', async () => {
    const saved = await call('PATCH', '/profile', landlord, { displayName: 'Updated Landlord', phone: '+60 12-345 6789' })
    expect(saved.status).toBe(200)
    expect(saved.data).toMatchObject({ data: { displayName: 'Updated Landlord', email: landlord.email, phone: '+60 12-345 6789' } })
    expect(database.profile.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: landlord.id }, create: expect.objectContaining({ userId: landlord.id, phone: '+60 12-345 6789' }) }))
    expect(database.landlordVerification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: landlord.id }), data: expect.objectContaining({ status: 'REJECTED' }) }))
    expect(database.propertyAuthorization.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ requesterId: landlord.id }), data: expect.objectContaining({ status: 'REJECTED' }) }))
    expect(database.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: landlord.id }), data: expect.objectContaining({ status: 'PAUSED' }) }))
  })

  it('lets a student save a private phone in their own account profile', async () => {
    const saved = await call('PATCH', '/profile', student, { displayName: 'Updated Student', phone: '+60 16-234 5678' })
    expect(saved.status).toBe(200)
    expect(saved.data).toMatchObject({ data: { displayName: 'Updated Student', email: student.email, phone: '+60 16-234 5678' } })
    expect(database.profile.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: student.id }, create: expect.objectContaining({ userId: student.id, phone: '+60 16-234 5678' }) }))
  })

  it('rejects invalid phone numbers and admin attempts before writing data', async () => {
    expect((await call('PATCH', '/profile', landlord, { phone: 'abc123' })).status).toBe(400)
    expect((await call('PATCH', '/profile', student, { phone: '123' })).status).toBe(400)
    expect((await call('PATCH', '/profile', admin, { phone: '+60 12-345 6789' })).status).toBe(403)
    expect(database.profile.upsert).not.toHaveBeenCalled()
  })
})
