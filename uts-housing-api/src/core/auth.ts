import { createHmac, randomBytes } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'
import type { User } from '@prisma/client'
import { prisma } from './db.js'
import { fail } from './http.js'

const cookieName = 'housing_session'
const standardLifetimeMs = 30 * 24 * 60 * 60 * 1000
const lawyerLifetimeMs = 8 * 60 * 60 * 1000

const secret = () => {
  const value = process.env.SESSION_SECRET || ''
  if (process.env.NODE_ENV === 'production' && value.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters in production.')
  return value || 'development-only-session-secret-change-before-launch'
}

export function tokenHash(token: string): string {
  return createHmac('sha256', secret()).update(token).digest('hex')
}

export function currentUser(req: Request): User | null {
  return req.authUser || null
}

declare global {
  namespace Express {
    interface Request {
      authUser?: User | null
      authSessionId?: string | null
    }
  }
}

export const hydrateAuth: RequestHandler = async (req, _res, next) => {
  try {
    req.authUser = null
    req.authSessionId = null
    const token = req.cookies?.[cookieName] as string | undefined
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return next()
    const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } })
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return next()
    // Applying this cap when reading a session also covers an existing account
    // that receives the LAWYER role after it signed in.
    if (session.user.roles.includes('LAWYER') && session.createdAt.getTime() + lawyerLifetimeMs <= Date.now()) return next()
    req.authUser = session.user
    req.authSessionId = session.id
    if (Date.now() - session.lastActiveAt.getTime() > 5 * 60_000) {
      await prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
    }
    next()
  } catch (error) { next(error) }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.authUser) return void fail(res, 401, 'Please sign in to continue.', 'UNAUTHORIZED')
  next()
}

export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.authUser) return void fail(res, 401, 'Please sign in to continue.', 'UNAUTHORIZED')
    if (!roles.some(role => req.authUser!.roles.includes(role as User['roles'][number]))) return void fail(res, 403, 'This account cannot perform this action.', 'FORBIDDEN')
    next()
  }
}

export const requireEmailVerified: RequestHandler = (req, res, next) => {
  if (!req.authUser) return void fail(res, 401, 'Please sign in to continue.', 'UNAUTHORIZED')
  if (!req.authUser.emailVerifiedAt) return void fail(res, 403, 'Verify your email address before using this feature.', 'EMAIL_NOT_VERIFIED')
  next()
}

export async function createSession(res: Response, user: Pick<User, 'id' | 'roles'>, req: Request): Promise<void> {
  const token = randomBytes(32).toString('hex')
  const lifetimeMs = user.roles.includes('LAWYER') ? lawyerLifetimeMs : standardLifetimeMs
  await prisma.session.create({ data: {
    userId: user.id,
    tokenHash: tokenHash(token),
    device: (req.headers['user-agent'] || 'Unknown device').slice(0, 250),
    ipAddress: req.ip,
    expiresAt: new Date(Date.now() + lifetimeMs),
  } })
  res.cookie(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: lifetimeMs })
}

export function clearSession(res: Response): void {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' })
}
