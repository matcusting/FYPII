import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('email credential payload cleanup', () => {
  let prisma: typeof import('../core/db.js').prisma
  let scrubExpiredCredentialJobs: typeof import('./email.js').scrubExpiredCredentialJobs
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const now = new Date('2026-11-04T00:00:00.000Z')

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    const [db, worker] = await Promise.all([import('../core/db.js'), import('./email.js')])
    prisma = db.prisma
    scrubExpiredCredentialJobs = worker.scrubExpiredCredentialJobs
    await prisma.emailJob.createMany({ data: [
      { id: ids[0], to: 'test@example.test', subject: 'Reset', template: 'password-reset', payload: { url: 'synthetic-reset-token' }, createdAt: new Date(now.getTime() - 61 * 60_000) },
      { id: ids[1], to: 'test@example.test', subject: 'Verify', template: 'email-verification', payload: { code: 'ABC234' }, createdAt: new Date(now.getTime() - 25 * 60 * 60_000) },
      { id: ids[2], to: 'test@example.test', subject: 'Invite', template: 'account-invite', payload: { url: 'synthetic-invite-token' }, status: 'FAILED', attempts: 5 },
      { id: ids[3], to: 'test@example.test', subject: 'Fresh reset', template: 'password-reset', payload: { url: 'fresh-synthetic-token' }, createdAt: new Date(now.getTime() - 30 * 60_000), nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
    ] })
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.emailJob.deleteMany({ where: { id: { in: ids } } })
      await prisma.$disconnect()
    }
  })

  it('removes expired and exhausted credentials while keeping a fresh queued reset', async () => {
    await scrubExpiredCredentialJobs(now)
    const jobs = await prisma.emailJob.findMany({ where: { id: { in: ids } } })
    const byId = new Map(jobs.map(job => [job.id, job]))
    for (const id of ids.slice(0, 3)) {
      expect(byId.get(id)?.payload).toEqual({})
      expect(byId.get(id)?.status).toBe('FAILED')
      expect(byId.get(id)?.attempts).toBe(5)
    }
    expect(byId.get(ids[3])?.payload).toEqual({ url: 'fresh-synthetic-token' })
    expect(byId.get(ids[3])?.status).toBe('PENDING')
  })
})
