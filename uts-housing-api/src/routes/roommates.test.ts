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
  gender: 'MALE',
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

describe('roommate gender', () => {
  it('defaults a new owner profile to undisclosed and private', async () => {
    database.roommateProfile.findUnique.mockResolvedValueOnce(null)
    const result = await call('GET', '/roommates/profile')
    expect(result.status).toBe(200)
    expect(result.data.data).toMatchObject({ gender: 'UNDISCLOSED', visibility: { gender: false } })
  })

  it('keeps a legacy or undisclosed gender out of public matches by default', async () => {
    const result = await call('GET', '/roommates/matches')
    expect(result.status).toBe(200)
    const items = (result.data.data as { items: Array<{ publicProfile: Record<string, unknown> }> }).items
    expect(items[0].publicProfile).not.toHaveProperty('gender')
  })

  it('shows gender in a match only after the candidate opts in', async () => {
    database.roommateProfile.findMany.mockResolvedValueOnce([{
      ...legacyProfile, userId: 'student-2', gender: 'FEMALE', visibility: { gender: true },
    }])
    const result = await call('GET', '/roommates/matches')
    expect(result.status).toBe(200)
    const items = (result.data.data as { items: Array<{ publicProfile: Record<string, unknown> }> }).items
    expect(items[0].publicProfile.gender).toBe('FEMALE')
  })

  it('never shows an undisclosed gender even when legacy visibility says to share', async () => {
    database.roommateProfile.findMany.mockResolvedValueOnce([{
      ...legacyProfile, userId: 'student-2', gender: 'UNDISCLOSED', visibility: { gender: true },
    }])
    const result = await call('GET', '/roommates/matches')
    expect(result.status).toBe(200)
    const items = (result.data.data as { items: Array<{ publicProfile: Record<string, unknown> }> }).items
    expect(items[0].publicProfile).not.toHaveProperty('gender')
  })

  it('stores a selected gender and separate sharing consent in the owner profile', async () => {
    const result = await call('PATCH', '/roommates/profile', { gender: 'FEMALE', visibility: { gender: true } })
    expect(result.status).toBe(200)
    expect(database.roommateProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ gender: 'FEMALE', visibility: expect.objectContaining({ gender: true }) }),
    }))
    expect(result.data.data).toMatchObject({ gender: 'FEMALE', visibility: { gender: true } })
  })

  it('clears sharing consent when gender is undisclosed, even if the request asks to share it', async () => {
    const result = await call('PATCH', '/roommates/profile', { gender: 'UNDISCLOSED', visibility: { gender: true } })
    expect(result.status).toBe(200)
    expect(database.roommateProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ gender: 'UNDISCLOSED', visibility: expect.objectContaining({ gender: false }) }),
    }))
    expect(result.data.data).toMatchObject({ gender: 'UNDISCLOSED', visibility: { gender: false } })
  })

  it('does not inherit stale sharing consent when an undisclosed profile selects a gender', async () => {
    database.roommateProfile.findUnique.mockResolvedValueOnce({ ...legacyProfile, gender: 'UNDISCLOSED', visibility: { gender: true } })
    const result = await call('PATCH', '/roommates/profile', { gender: 'MALE' })
    expect(result.status).toBe(200)
    expect(database.roommateProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ visibility: expect.objectContaining({ gender: false }) }),
    }))
  })

  it('rejects unsupported genders', async () => {
    const result = await call('PATCH', '/roommates/profile', { gender: 'OTHER' })
    expect(result.status).toBe(400)
    expect(database.roommateProfile.upsert).not.toHaveBeenCalled()
  })
})
