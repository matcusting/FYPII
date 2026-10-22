import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

const database = vi.hoisted(() => ({
  inquiry: { findUnique: vi.fn() },
  inquiryMessage: { findMany: vi.fn(), count: vi.fn() },
  connectionRequest: { findUnique: vi.fn() },
  userBlock: { findFirst: vi.fn() },
  listing: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  review: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  mediaUpload: { findFirst: vi.fn() },
  user: { findMany: vi.fn(), findFirst: vi.fn() },
  report: { create: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
  notification: { updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
}))

vi.mock('../core/db.js', () => ({ prisma: database }))
vi.mock('../core/mail.js', () => ({ queueEmail: vi.fn() }))
vi.mock('../core/auth.js', () => ({
  currentUser: (req: { authUser?: unknown }) => req.authUser || null,
  requireAuth: ((req, res, next) => req.authUser ? next() : res.status(401).json({ error: { code: 'UNAUTHORIZED' } })) as RequestHandler,
  requireEmailVerified: ((_req, _res, next) => next()) as RequestHandler,
}))

import router from './community.js'

const student = { id: 'student-1', roles: ['STUDENT'], studentVerified: true }
beforeEach(() => vi.clearAllMocks())

function call(method: string, path: string, body?: unknown) {
  const parsed = new URL(path, 'http://example.test')
  const request = { method, url: `${parsed.pathname}${parsed.search}`, originalUrl: `${parsed.pathname}${parsed.search}`, body, authUser: student, query: Object.fromEntries(parsed.searchParams) } as unknown as Request
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    let statusCode = 200
    const responseMethods = {
      status(code: number) { statusCode = code; return responseMethods },
      json(data: unknown) { resolve({ status: statusCode, data }); return responseMethods },
    }
    router(request, responseMethods as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}

describe('community privacy boundaries', () => {
  it('returns approved review content without private rental proof metadata', async () => {
    database.listing.findUnique.mockResolvedValue({ id: 'listing-1', ownerId: 'landlord-1', status: 'PUBLISHED' })
    database.review.findMany.mockResolvedValue([{
      id: 'review-1', listingId: 'listing-1', authorId: 'student-1', rating: 5,
      body: 'A safe and quiet place to study.', status: 'APPROVED',
      ownerResponse: null, experienceDescription: 'Stayed in March',
      experienceProofKey: 'private-proof.pdf', createdAt: new Date(), updatedAt: new Date(),
    }])
    database.review.count.mockResolvedValue(1)
    database.user.findMany.mockResolvedValue([{ id: 'student-1', name: 'Student' }])
    database.listing.findMany.mockResolvedValue([{ id: 'listing-1', title: 'Student room' }])

    const response = await call('GET', '/listings/listing-1/reviews')
    expect(response.status).toBe(200)
    const result = response.data as { data: { items: Array<Record<string, unknown>> } }
    expect(result.data.items[0].body).toBe('A safe and quiet place to study.')
    expect(result.data.items[0]).not.toHaveProperty('experienceProofKey')
    expect(result.data.items[0]).not.toHaveProperty('experienceDescription')
  })

  it('does not let a user report a private listing by guessing its ID', async () => {
    database.listing.findFirst.mockResolvedValue(null)

    const response = await call('POST', '/reports', { targetType: 'LISTING', targetId: 'private-listing', reason: 'This information is inaccurate.' })
    expect(response.status).toBe(404)
    expect(database.listing.findFirst).toHaveBeenCalledWith({ where: { id: 'private-listing', OR: [{ status: 'PUBLISHED' }, { ownerId: student.id }] }, select: { id: true } })
    expect(database.report.create).not.toHaveBeenCalled()
  })

  it('rejects a rental review when the proof is not an uploaded document owned by the reviewer', async () => {
    database.listing.findUnique.mockResolvedValue({ id: 'listing-1', ownerId: 'landlord-1', status: 'PUBLISHED' })
    database.mediaUpload.findFirst.mockResolvedValue(null)

    const response = await call('POST', '/listings/listing-1/reviews', {
      rating: 4, body: 'The room was clean and quiet for studying.',
      experienceDescription: 'I rented this room last semester.', experienceProofKey: 'someone-elses-file',
    })
    expect(response.status).toBe(400)
    expect(response.data).toMatchObject({ error: { code: 'EVIDENCE_REQUIRED' } })
    expect(database.mediaUpload.findFirst).toHaveBeenCalledWith({ where: {
      storageKey: 'someone-elses-file', ownerId: student.id, purpose: 'REVIEW_EVIDENCE', status: 'UPLOADED',
    } })
  })

  it('returns the newest conversation page in reading order', async () => {
    database.inquiry.findUnique.mockResolvedValue({ id: 'inquiry-1', senderId: student.id, recipientId: 'landlord-1' })
    database.inquiryMessage.findMany.mockResolvedValue([
      { id: 'message-3', body: 'Newest' }, { id: 'message-2', body: 'Earlier' },
    ])
    database.inquiryMessage.count.mockResolvedValue(3)

    const response = await call('GET', '/inquiries/inquiry-1/messages?limit=2')
    expect(response.status).toBe(200)
    const result = response.data as { data: { items: Array<{ id: string }>; total: number } }
    expect(result.data.items.map(item => item.id)).toEqual(['message-2', 'message-3'])
    expect(result.data.total).toBe(3)
    expect(database.inquiryMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2 }))
  })

  it('blocks access to accepted roommate messages after either student blocks the other', async () => {
    database.connectionRequest.findUnique.mockResolvedValue({ id: 'request-1', senderId: student.id, recipientId: 'student-2', status: 'ACCEPTED' })
    database.userBlock.findFirst.mockResolvedValue({ blockerId: 'student-2', blockedId: student.id })

    const response = await call('GET', '/roommates/requests/request-1/messages')
    expect(response.status).toBe(403)
    expect(response.data).toMatchObject({ error: { code: 'BLOCKED' } })
  })

  it('marks only the signed-in user’s notification as read', async () => {
    database.notification.updateMany.mockResolvedValue({ count: 0 })
    database.notification.findFirst.mockResolvedValue(null)

    const response = await call('PATCH', '/notifications/other-user-notification/read')
    expect(response.status).toBe(404)
    expect(database.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other-user-notification', userId: student.id, readAt: null } }))
    expect(database.notification.findUnique).not.toHaveBeenCalled()
  })
})
