import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import nodemailer from 'nodemailer'
import { prisma } from '../core/db.js'
import { pauseListingsWithoutCurrentApproval } from './approval-expiry.js'

function message(template: string, payload: Record<string, unknown>) {
  const name = typeof payload.name === 'string' ? payload.name : 'there'
  const url = typeof payload.url === 'string' ? payload.url : ''
  if (template === 'email-verification') return `Hello ${name},\n\nVerify your UTS Housing email address using this link:\n${url}\n\nThe link expires in 24 hours. If you did not create an account, ignore this message.\n`
  if (template === 'password-reset') return `Hello ${name},\n\nReset your UTS Housing password using this link:\n${url}\n\nThe link expires in one hour. If you did not request a reset, ignore this message.\n`
  if (template === 'notification') {
    const body = typeof payload.body === 'string' ? payload.body : 'You have a new account notification.'
    const action = typeof payload.actionUrl === 'string' ? payload.actionUrl : '/dashboard'
    const base = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
    return `${body}\n\nOpen your account: ${new URL(action, base)}\n`
  }
  throw new Error('Unsupported email template.')
}

async function deliver(to: string, subject: string, text: string) {
  const from = process.env.EMAIL_FROM || 'UTS Housing <no-reply@example.local>'
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587)
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      ...(process.env.SMTP_USER && process.env.SMTP_PASSWORD ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    })
    await transport.sendMail({ from, to, subject, text })
    return
  }
  if (process.env.NODE_ENV === 'production') throw new Error('SMTP_HOST is required for production email delivery.')
  const outbox = resolve(process.env.EMAIL_OUTBOX_DIR || './data/outbox')
  await mkdir(outbox, { recursive: true, mode: 0o700 })
  await writeFile(join(outbox, `${Date.now()}-${randomUUID()}.txt`), `To: ${to}\nFrom: ${from}\nSubject: ${subject}\n\n${text}`, { mode: 0o600 })
}

export async function processEmailJobs() {
  const due = await prisma.emailJob.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' }, take: 20 })
  for (const job of due) {
    const claimed = await prisma.emailJob.updateMany({ where: { id: job.id, attempts: job.attempts, nextAttemptAt: { lte: new Date() } },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60_000) } })
    if (!claimed.count) continue
    try {
      const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload) ? job.payload as Record<string, unknown> : {}
      await deliver(job.to, job.subject, message(job.template, payload))
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: 'SENT', sentAt: new Date(), payload: {} } })
    } catch (error) {
      const retryMinutes = Math.min(60, 2 ** (job.attempts + 1))
      await prisma.emailJob.update({ where: { id: job.id }, data: { status: 'FAILED', nextAttemptAt: new Date(Date.now() + retryMinutes * 60_000), lastError: error instanceof Error ? error.name : 'DeliveryError' } })
      console.error('Email delivery failed for job:', job.id)
    }
  }
}

async function run() {
  if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) throw new Error('SMTP_HOST is required in production.')
  console.info('Email worker started.')
  let lastApprovalSweep = 0
  for (;;) {
    await processEmailJobs()
    if (Date.now() - lastApprovalSweep >= 60_000) {
      try { await pauseListingsWithoutCurrentApproval() }
      catch (error) { console.error('Approval expiry sweep failed:', error instanceof Error ? error.name : 'unknown') }
      lastApprovalSweep = Date.now()
    }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => { console.error('Email worker stopped:', error instanceof Error ? error.name : 'unknown'); process.exitCode = 1 })
}
