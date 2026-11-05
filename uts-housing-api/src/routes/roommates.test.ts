import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

const database = vi.hoisted(() => ({
  roommateProfile: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  userBlock: { findMany: vi.fn() },
  connectionRequest: { findMany: vi.fn() },
}))
vi.mock('../core/db.js', () => ({ prisma: database }))
vi.mock('../core/auth.js', () => ({
  currentUser: (req: { authUser?: unknown }) => req.authUser || null,
  requireRole: (_role: string) => ((req, res, next) => req.authUser ? next() : res.status(401).json({ error: { code: 'UNAUTHORIZED' } })) as RequestHandler,
}))
vi.mock('../core/mail.js', () => ({ queueEmail: vi.fn() }))

import router from './roommates.js'

const student = { id: 'student-1', name: 'Student', roles: ['STUDENT'], studentVerified: true, studentVerifiedUntil: new Date('2099-12-31'), emailVerifiedAt: new Date(), status: 'ACTIVE' }
const legacyProfile = {
  userId: 'student-1', displayName: 'Student', university: 'Former public university', bio: 'Quiet student',
  preferredLocation: null, budgetMin: null, budgetMax: null, moveInDate: null, discoverable: true,
  lifestyle: {}, roommatePreferences: {}, importanceWeights: {}, visibility: { university: true, bio: true },
  smokeFreeOnly: false, petFreeOnly: false,
}

function call(method: string, path: string, body?: unknown) {
  const request = { method, url: path, originalUrl: path, authUser: student, body, query: {} } as unknown as Request
  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    let statusCode = 200
    const responseMethods = {
      status(code: number) { statusCode = code; return responseMethods },
      json(data: Record<string, unknown>) { resolve({ status: statusCode, data }); return responseMethods },
    }
    router(request, responseMethods as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  database.roommateProfile.findUnique.mockResolvedValue(legacyProfile)
  database.roommateProfile.findMany.mockResolvedValue([{ ...legacyProfile, userId: 'student-2', displayName: 'Candidate' }])
  database.userBlock.findMany.mockResolvedValue([])
  database.connectionRequest.findMany.mockResolvedValue([])
  database.roommateProfile.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create)
})

describe('roommate university privacy', () => {
  it('never includes a legacy university in a public match', async () => {
    const result = await call('GET', '/roommates/matches')
    expect(result.status).toBe(200)
    const items = (result.data.data as { items: Array<{ publicProfile: Record<string, unknown> }> }).items
    expect(items).toHaveLength(1)
    expect(items[0].publicProfile).toMatchObject({ displayName: 'Candidate', bio: 'Quiet student' })
    expect(items[0].publicProfile).not.toHaveProperty('university')
  })

  it('disables stale university visibility when the owner saves their profile', async () => {
    const result = await call('PATCH', '/roommates/profile', { university: null, visibility: { university: true } })
    expect(result.status).toBe(200)
    expect(database.roommateProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ university: null, visibility: expect.objectContaining({ university: false }) }),
    }))
    expect((result.data.data as { visibility: Record<string, unknown> }).visibility.university).toBe(false)
  })
})
