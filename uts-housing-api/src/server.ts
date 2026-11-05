import { app } from './app.js'
import { isAbsolute } from 'node:path'
import { smsMode } from './core/sms.js'
import { validateMalwareScanConfiguration } from './core/malware-scan.js'
import { validateMfaConfiguration } from './core/mfa.js'
import { processPendingFileDeletions } from './workers/file-deletion.js'

const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
validateMalwareScanConfiguration()
validateMfaConfiguration()
if (process.env.NODE_ENV === 'production') {
  smsMode()
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('DATABASE_URL and a strong SESSION_SECRET are required in production.')
  }
  if (!process.env.SMTP_HOST || !process.env.EMAIL_FROM || process.env.EMAIL_FROM.includes('example.local')) {
    throw new Error('SMTP_HOST and a real EMAIL_FROM address are required in production.')
  }
  const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
  if (!origins.length || origins.some(value => { try { return new URL(value).protocol !== 'https:' } catch { return true } })) {
    throw new Error('Set FRONTEND_ORIGIN to one or more HTTPS origins in production.')
  }
  try {
    if (new URL(process.env.PUBLIC_BASE_URL || '').protocol !== 'https:') throw new Error('invalid')
  } catch { throw new Error('Set PUBLIC_BASE_URL to the HTTPS website address in production.') }
  if (!process.env.MEDIA_PRIVATE_DIR || !isAbsolute(process.env.MEDIA_PRIVATE_DIR)) {
    throw new Error('Set MEDIA_PRIVATE_DIR to a persistent absolute private path in production.')
  }
  try {
    if (new URL(process.env.GEOCODER_URL || '').protocol !== 'https:') throw new Error('invalid')
  } catch { throw new Error('Set GEOCODER_URL to an HTTPS address lookup service in production.') }
}
app.listen(port, host, () => {
  console.info(`UTS Housing API listening on ${host}:${port}`)
  // Render attaches the private media disk only to this web service. Retry
  // durable deletion records here, where the bytes are actually mounted.
  let cleanupRunning = false
  const cleanup = async () => {
    if (cleanupRunning) return
    cleanupRunning = true
    try {
      const result = await processPendingFileDeletions()
      if (result.failed) console.error('Private file cleanup has unresolved items:', result.failed)
    } catch (error) {
      console.error('Private file cleanup failed:', error instanceof Error ? error.name : 'unknown')
    } finally { cleanupRunning = false }
  }
  void cleanup()
  setInterval(() => void cleanup(), 60_000)
})
