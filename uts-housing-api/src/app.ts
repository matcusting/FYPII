import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import helmet from 'helmet'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { hydrateAuth } from './core/auth.js'
import { prisma } from './core/db.js'
import { fail, ok } from './core/http.js'
import authRouter from './routes/auth.js'
import profileRouter from './routes/profile.js'
import phoneVerificationRouter from './routes/phone-verification.js'
import listingsRouter from './routes/listings.js'
import communityRouter from './routes/community.js'
import roommatesRouter from './routes/roommates.js'
import verificationsRouter from './routes/verifications.js'
import landlordVerificationsRouter from './routes/landlord-verifications.js'
import lawyerRouter from './routes/lawyer.js'
import adminRouter from './routes/admin.js'
import emailDeliveryRouter from './routes/email-delivery.js'

const configuredOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(value => value.trim()).filter(Boolean)

const csrfOrigin: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.cookies?.housing_session) return next()
  const source = req.get('origin') || req.get('referer')
  if (!source) return void fail(res, 403, 'The request origin could not be verified.', 'CSRF_REJECTED')
  try {
    const origin = new URL(source).origin
    if (configuredOrigins.includes(origin)) return next()
  } catch { /* invalid origin */ }
  return void fail(res, 403, 'The request origin is not allowed.', 'CSRF_REJECTED')
}

export const app = express()
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1)
app.disable('x-powered-by')
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin(origin, callback) {
  if (!origin || configuredOrigins.includes(origin)) return callback(null, true)
  return callback(new Error('CORS origin denied'))
}, credentials: true }))
app.use(cookieParser())
app.use(csrfOrigin)
// API clients send plain JSON. Reject compressed request bodies so the
// body-parser decompression path is never reachable from the public gateway.
app.use(express.json({ limit: '1mb', inflate: false }))
app.use(hydrateAuth)

app.get('/health/live', (_req, res) => ok(res, { status: 'live' }))
app.get('/health/ready', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; return ok(res, { status: 'ready' }) }
  catch { return fail(res, 503, 'Database unavailable.', 'NOT_READY') }
})

app.use('/api/v1/auth', authRouter)
app.use('/api/v1', profileRouter)
app.use('/api/v1', phoneVerificationRouter)
app.use('/api/v1/verifications', verificationsRouter)
app.use('/api/v1/landlord-verifications', landlordVerificationsRouter)
app.use('/api/v1/lawyer', lawyerRouter)
app.use('/api/v1', listingsRouter)
app.use('/api/v1', communityRouter)
app.use('/api/v1', roommatesRouter)
app.use('/api/v1/admin', adminRouter)
app.use('/api/v1/operations', emailDeliveryRouter)
app.use('/api/v1', (_req, res) => fail(res, 404, 'API endpoint not found.', 'NOT_FOUND'))

const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (res.headersSent) return
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return void fail(res, 409, 'This record already exists.', 'CONFLICT')
    if (error.code === 'P2025') return void fail(res, 404, 'The requested record was not found.', 'NOT_FOUND')
  }
  if (error instanceof ZodError) return void fail(res, 400, 'The request contains invalid data.', 'VALIDATION_ERROR')
  if (error && typeof error === 'object' && 'type' in error && error.type === 'encoding.unsupported') {
    return void fail(res, 415, 'Send an uncompressed request body.', 'UNSUPPORTED_ENCODING')
  }
  if (error instanceof SyntaxError && 'body' in error) return void fail(res, 400, 'The JSON request body is invalid.', 'INVALID_JSON')
  if (error instanceof Error && error.message === 'CORS origin denied') return void fail(res, 403, 'The request origin is not allowed.', 'CORS_REJECTED')
  if (error instanceof Error && error.name === 'MulterError') return void fail(res, 400, 'The uploaded file was rejected.', 'UPLOAD_REJECTED')
  console.error('Unhandled API error:', error instanceof Error ? error.name : 'unknown')
  return void fail(res, 500, 'An unexpected server error occurred.', 'INTERNAL_ERROR')
}
app.use(onError)

export default app
