import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../core/smtp.js', () => ({ configuredSmtpTransport: vi.fn() }))

import { configuredSmtpTransport } from '../core/smtp.js'
import { deliver } from './email.js'

const keys = ['NODE_ENV', 'SMTP_HOST', 'EMAIL_FROM', 'EMAIL_OUTBOX_DIR'] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))

describe('email delivery for local-only recipients', () => {
  let outbox = ''

  beforeEach(async () => {
    vi.resetAllMocks()
    outbox = await mkdtemp(join(tmpdir(), 'housing-email-local-'))
    process.env.NODE_ENV = 'development'
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.EMAIL_FROM = 'UTS Housing <sender@example.test>'
    process.env.EMAIL_OUTBOX_DIR = outbox
  })

  afterEach(async () => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
    if (outbox) await rm(outbox, { recursive: true, force: true })
  })

  it('writes a local administrator reset to the outbox with SMTP configured', async () => {
    await deliver('local-admin@demo.local', 'Reset your password', 'synthetic reset link')

    expect(configuredSmtpTransport).not.toHaveBeenCalled()
    const files = await readdir(outbox)
    expect(files).toHaveLength(1)
    const written = await readFile(join(outbox, files[0]), 'utf8')
    expect(written).toContain('To: local-admin@demo.local')
    expect(written).toContain('synthetic reset link')
  })

  it('still sends real recipients through SMTP', async () => {
    const sendMail = vi.fn().mockResolvedValue({})
    const close = vi.fn()
    vi.mocked(configuredSmtpTransport).mockReturnValue({ sendMail, close } as unknown as ReturnType<typeof configuredSmtpTransport>)

    await deliver('student@student.uts.edu.my', 'Verify', 'synthetic code')

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'student@student.uts.edu.my' }))
    expect(close).toHaveBeenCalledOnce()
    expect(await readdir(outbox)).toEqual([])
  })

  it('never writes local mail to the outbox in production', async () => {
    process.env.NODE_ENV = 'production'
    const sendMail = vi.fn().mockResolvedValue({})
    vi.mocked(configuredSmtpTransport).mockReturnValue({ sendMail, close: vi.fn() } as unknown as ReturnType<typeof configuredSmtpTransport>)

    await deliver('local-admin@demo.local', 'Reset', 'synthetic reset link')

    expect(sendMail).toHaveBeenCalledOnce()
    expect(await readdir(outbox)).toEqual([])
  })
})
