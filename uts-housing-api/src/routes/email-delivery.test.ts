import { afterEach, describe, expect, it } from 'vitest'
import { emailDeliveryConfiguration } from './email-delivery.js'

const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

describe('admin email delivery diagnostics', () => {
  it('does not claim real delivery when the local outbox is in use', () => {
    for (const key of keys) delete process.env[key]
    expect(emailDeliveryConfiguration()).toMatchObject({ mode: 'localOutbox', senderConfigured: false })
  })

  it('marks partial SMTP setup invalid without exposing credentials', () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.SMTP_PORT = '587'
    process.env.SMTP_USER = 'sender'
    process.env.SMTP_PASSWORD = 'synthetic-secret'
    process.env.EMAIL_FROM = 'UTS Housing <no-reply@example.local>'
    const result = emailDeliveryConfiguration()
    expect(result.mode).toBe('invalid')
    expect(result.issue).toContain('EMAIL_FROM')
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    process.env.EMAIL_FROM = 'UTS Housing <sender@example.test>'
    expect(emailDeliveryConfiguration()).toMatchObject({ mode: 'smtp', senderConfigured: true })
  })
})
