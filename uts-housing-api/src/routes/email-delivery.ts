import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { prisma } from '../core/db.js'
import { requireRole } from '../core/auth.js'
import { asyncRoute, fail, ok } from '../core/http.js'
import { configuredSmtpTransport } from '../core/smtp.js'

const router = Router()
router.use(requireRole('ADMIN'))

// Never return recipients, message payloads, codes, SMTP credentials or raw
// provider errors from this operational endpoint.
export function emailDeliveryConfiguration() {
  const sender = process.env.EMAIL_FROM?.trim() || ''
  const senderConfigured = Boolean(sender && !sender.includes('example.local'))
  try {
    const transport = configuredSmtpTransport()
    if (!transport) return { mode: 'localOutbox' as const, senderConfigured: false, issue: null }
    transport.close()
    return senderConfigured
      ? { mode: 'smtp' as const, senderConfigured: true, issue: null }
      : { mode: 'invalid' as const, senderConfigured: false, issue: 'Set EMAIL_FROM to a sender accepted by your SMTP provider.' }
  } catch (error) {
    return { mode: 'invalid' as const, senderConfigured, issue: error instanceof Error ? error.message : 'Invalid SMTP configuration.' }
  }
}

router.get('/email-delivery', asyncRoute(async (_req, res) => {
  const [pending, retrying, exhausted, acceptedByTransport, latestAccepted] = await Promise.all([
    prisma.emailJob.count({ where: { status: 'PENDING', attempts: { lt: 5 } } }),
    prisma.emailJob.count({ where: { status: 'FAILED', attempts: { lt: 5 } } }),
    prisma.emailJob.count({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { gte: 5 } } }),
    prisma.emailJob.count({ where: { status: 'SENT' } }),
    prisma.emailJob.findFirst({ where: { status: 'SENT' }, select: { sentAt: true }, orderBy: { sentAt: 'desc' } }),
  ])
  return ok(res, { ...emailDeliveryConfiguration(), queue: { pending, retrying, exhausted, acceptedByTransport, latestAcceptedAt: latestAccepted?.sentAt ?? null } })
}))

router.post('/email-delivery/check-connection', rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (_req, res) => {
  const configuration = emailDeliveryConfiguration()
  if (configuration.mode !== 'smtp') return fail(res, 503, configuration.issue || 'No SMTP provider is configured. Local outbox mode cannot deliver real email.', 'SMTP_NOT_READY')
  const transport = configuredSmtpTransport()!
  try {
    await transport.verify()
    return ok(res, { connected: true })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    return fail(res, 503, code === 'EAUTH' ? 'SMTP authentication was rejected. Check the provider login and app password.' : 'SMTP connection failed. Check the provider host, port, TLS and network access.', 'SMTP_CHECK_FAILED')
  } finally {
    transport.close()
  }
}))

export default router
