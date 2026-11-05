import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const periodSeconds = 30

export function validateMfaConfiguration(): void {
  if (process.env.NODE_ENV === 'production' && !/^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY || '')) {
    throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hexadecimal characters in production.')
  }
}

function encryptionKey(): Buffer {
  validateMfaConfiguration()
  return process.env.MFA_ENCRYPTION_KEY
    ? Buffer.from(process.env.MFA_ENCRYPTION_KEY, 'hex')
    : createHmac('sha256', 'local-preview-only').update('UTS Housing MFA encryption').digest()
}

function encodeBase32(bytes: Buffer): string {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let accumulator = 0
  let result = ''
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += digits[(accumulator >>> bits) & 31]
    }
  }
  if (bits) result += digits[(accumulator << (5 - bits)) & 31]
  return result
}

function decodeBase32(value: string): Buffer {
  if (!/^[A-Z2-7]+$/.test(value)) throw new Error('Invalid authenticator secret.')
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let accumulator = 0
  const bytes: number[] = []
  for (const character of value) {
    accumulator = (accumulator << 5) | digits.indexOf(character)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 255)
    }
  }
  return Buffer.from(bytes)
}

export function newMfaSecret(): string { return encodeBase32(randomBytes(20)) }

export function encryptMfaSecret(secret: string, userId: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce)
  cipher.setAAD(Buffer.from(userId))
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1.${nonce.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

export function decryptMfaSecret(value: string, userId: string): string {
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted authenticator secret.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[1], 'base64url'))
  decipher.setAAD(Buffer.from(userId))
  decipher.setAuthTag(Buffer.from(parts[3], 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8')
}

export function authenticatorUri(secret: string, email: string): string {
  const url = new URL(`otpauth://totp/${encodeURIComponent(`UTS Housing:${email}`)}`)
  url.searchParams.set('secret', secret)
  url.searchParams.set('issuer', 'UTS Housing')
  url.searchParams.set('algorithm', 'SHA1')
  url.searchParams.set('digits', '6')
  url.searchParams.set('period', String(periodSeconds))
  return url.toString()
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}

export function matchingTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const step = Math.floor(now / 1000 / periodSeconds)
  for (const candidate of [step, step - 1, step + 1]) {
    const expected = Buffer.from(totpAt(secret, candidate))
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate
  }
  return null
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const raw = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('')
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
  })
}

export function normalizeRecoveryCode(value: string): string | null {
  const raw = value.replace(/[\s-]/g, '').toUpperCase()
  return raw.length === 12 && [...raw].every(character => alphabet.includes(character)) ? raw : null
}
