import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export type SmsMode = 'localOutbox' | 'twilio' | 'disabled'

export function smsMode(): SmsMode {
  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase() || (process.env.NODE_ENV === 'production' ? 'disabled' : 'localoutbox')
  if (provider === 'disabled') return 'disabled'
  if (provider === 'localoutbox') {
    if (process.env.NODE_ENV === 'production') throw new Error('Local SMS outbox is unavailable in production.')
    return 'localOutbox'
  }
  if (provider === 'twilio') {
    if (!/^AC[a-f0-9]{32}$/.test(process.env.TWILIO_ACCOUNT_SID || '')) throw new Error('Set a valid TWILIO_ACCOUNT_SID.')
    if (!process.env.TWILIO_AUTH_TOKEN) throw new Error('Set TWILIO_AUTH_TOKEN.')
    if (!/^\+[1-9]\d{7,14}$/.test(process.env.TWILIO_FROM || '')) throw new Error('Set TWILIO_FROM to an E.164 sender number.')
    return 'twilio'
  }
  throw new Error('SMS_PROVIDER must be disabled, localOutbox, or twilio.')
}

/** Malaysia-local numbers are normalized; other countries require the +country code. */
export function normalizeSmsPhone(raw: string): string | null {
  const compact = raw.replace(/[ ()-]/g, '')
  const e164 = compact.startsWith('+') ? compact : compact.startsWith('0') ? `+60${compact.slice(1)}` : compact.startsWith('60') ? `+${compact}` : ''
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

export async function deliverSms(to: string, code: string): Promise<void> {
  const mode = smsMode()
  if (mode === 'disabled') throw new Error('SMS delivery is not configured.')
  const body = `UTS Housing phone verification code: ${code}. It expires in 10 minutes. Never share this code.`
  if (mode === 'localOutbox') {
    const directory = resolve(process.env.SMS_OUTBOX_DIR || './data/sms-outbox')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(join(directory, `${Date.now()}-${randomUUID()}.txt`), `To: ${to}\n\n${body}\n`, { mode: 0o600 })
    return
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!
  const credentials = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }), signal: controller.signal,
    })
    if (!response.ok) throw new Error(`SMS provider rejected the request (${response.status}).`)
  } finally { clearTimeout(timeout) }
}
