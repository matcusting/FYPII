import { afterEach, describe, expect, it } from 'vitest'
import { configuredSmtpTransport } from './smtp.js'

const original = Object.fromEntries(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'].map(key => [key, process.env[key]]))
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('SMTP configuration', () => {
  it('keeps local outbox mode only when SMTP is entirely unconfigured', () => {
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    expect(configuredSmtpTransport()).toBeNull()
    process.env.SMTP_USER = 'partial'
    expect(() => configuredSmtpTransport()).toThrow('Set SMTP_HOST')
  })

  it('requires paired credentials and TLS for a remote submission server', () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.SMTP_PORT = '587'
    process.env.SMTP_USER = 'sender'
    delete process.env.SMTP_PASSWORD
    expect(() => configuredSmtpTransport()).toThrow('Set both SMTP_USER and SMTP_PASSWORD')
    process.env.SMTP_PASSWORD = 'synthetic-password'
    const transport = configuredSmtpTransport()
    expect(transport).not.toBeNull()
    expect((transport as unknown as { options: { requireTLS: boolean; secure: boolean } }).options).toMatchObject({ requireTLS: true, secure: false })
    transport?.close()
  })
})
