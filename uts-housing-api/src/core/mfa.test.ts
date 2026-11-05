import { afterEach, describe, expect, it } from 'vitest'
import { authenticatorUri, decryptMfaSecret, encryptMfaSecret, matchingTotpStep, newMfaSecret, newRecoveryCodes, normalizeRecoveryCode, totpAt, validateMfaConfiguration } from './mfa.js'

const previousMode = process.env.NODE_ENV
const previousKey = process.env.MFA_ENCRYPTION_KEY
afterEach(() => {
  if (previousMode === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousMode
  if (previousKey === undefined) delete process.env.MFA_ENCRYPTION_KEY
  else process.env.MFA_ENCRYPTION_KEY = previousKey
})

describe('privileged authenticator codes', () => {
  it('matches RFC 6238 SHA-1 vectors and accepts only a narrow time window', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    expect(totpAt(secret, 1)).toBe('287082')
    expect(matchingTotpStep(secret, '287082', 59_000)).toBe(1)
    expect(matchingTotpStep(secret, '287082', 59_000 + 90_000)).toBeNull()
    expect(matchingTotpStep(secret, '12345A', 59_000)).toBeNull()
  })

  it('encrypts secrets for one account and keeps recovery codes random and normalizable', () => {
    process.env.MFA_ENCRYPTION_KEY = '42'.repeat(32)
    const secret = newMfaSecret()
    const encrypted = encryptMfaSecret(secret, 'user-1')
    expect(encrypted).not.toContain(secret)
    expect(decryptMfaSecret(encrypted, 'user-1')).toBe(secret)
    expect(() => decryptMfaSecret(encrypted, 'user-2')).toThrow()
    expect(new Set(newRecoveryCodes()).size).toBe(8)
    expect(normalizeRecoveryCode('ABCD-EFGH-JKLM')).toBe('ABCDEFGHJKLM')
    expect(normalizeRecoveryCode('ABC')).toBeNull()
    expect(new URL(authenticatorUri(secret, 'reviewer@example.test')).searchParams.get('secret')).toBe(secret)
  })

  it('refuses production startup without an independent encryption key', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MFA_ENCRYPTION_KEY
    expect(validateMfaConfiguration).toThrow('MFA_ENCRYPTION_KEY')
    process.env.MFA_ENCRYPTION_KEY = '42'.repeat(32)
    expect(validateMfaConfiguration).not.toThrow()
  })
})
