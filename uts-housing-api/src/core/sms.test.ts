import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverSms, normalizeSmsPhone, smsMode } from './sms.js'

const keys = ['SMS_PROVIDER', 'SMS_OUTBOX_DIR', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'NODE_ENV'] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] }
  vi.unstubAllGlobals()
})

describe('SMS delivery', () => {
  it('normalizes Malaysian numbers and rejects invalid recipients', () => {
    expect(normalizeSmsPhone('012-345 6789')).toBe('+60123456789')
    expect(normalizeSmsPhone('+60 12-345 6789')).toBe('+60123456789')
    expect(normalizeSmsPhone('60123456789')).toBe('+60123456789')
    expect(normalizeSmsPhone('12345')).toBeNull()
  })

  it('writes a private local test message and never claims this is a real SMS', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'housing-sms-test-'))
    try {
      process.env.NODE_ENV = 'test'
      process.env.SMS_PROVIDER = 'localOutbox'
      process.env.SMS_OUTBOX_DIR = directory
      expect(smsMode()).toBe('localOutbox')
      await deliverSms('+60123456789', '123456')
      const files = await readdir(directory)
      expect(files).toHaveLength(1)
      expect(await readFile(join(directory, files[0]!), 'utf8')).toContain('code: 123456')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('requires complete Twilio credentials, HTTPS endpoint, and provider acceptance', async () => {
    process.env.SMS_PROVIDER = 'twilio'
    expect(() => smsMode()).toThrow('TWILIO_ACCOUNT_SID')
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`
    process.env.TWILIO_AUTH_TOKEN = 'test-secret'
    process.env.TWILIO_FROM = '+60123456789'
    const request = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    vi.stubGlobal('fetch', request)
    await deliverSms('+60111111111', '345678')
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/api\.twilio\.com\//), expect.objectContaining({
      method: 'POST', body: expect.any(URLSearchParams),
    }))
    request.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(deliverSms('+60111111111', '345678')).rejects.toThrow('rejected')
  })

  it('refuses local outbox in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.SMS_PROVIDER = 'localOutbox'
    expect(() => smsMode()).toThrow('unavailable in production')
  })
})
