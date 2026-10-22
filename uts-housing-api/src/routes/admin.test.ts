import type { NextFunction, Request, Response } from 'express'
import type { User } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../core/db.js', () => ({ prisma: {} }))

import adminRouter from './admin.js'

function callProof(roles?: User['roles']) {
  const path = '/verifications/00000000-0000-0000-0000-000000000000/proof'
  const request = {
    method: 'GET', url: path, originalUrl: path,
    authUser: roles ? { id: 'test-user', roles } as User : null,
  } as Request
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    let status = 200
    const response = {
      status(code: number) { status = code; return response },
      json(data: unknown) { resolve({ status, data }); return response },
    }
    adminRouter(request, response as unknown as Response, ((error?: unknown) => reject(error || new Error('No route matched'))) as NextFunction)
  })
}

describe('admin document access', () => {
  it('requires an administrator before opening student proof documents', async () => {
    const guest = await callProof()
    const student = await callProof(['STUDENT'])
    expect(guest).toMatchObject({ status: 401, data: { error: { code: 'UNAUTHORIZED' } } })
    expect(student).toMatchObject({ status: 403, data: { error: { code: 'FORBIDDEN' } } })
  })
})
