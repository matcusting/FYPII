import { describe, expect, it, vi } from 'vitest'

vi.mock('../core/db.js', () => ({ prisma: {} }))
import { verificationProofMime } from './verifications.js'

describe('student verification proof type', () => {
  it('accepts a declared type only when the bytes have that signature', () => {
    expect(verificationProofMime(Buffer.from('%PDF-1.7\n'), 'application/pdf')).toBe('application/pdf')
    expect(verificationProofMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe('image/jpeg')
    expect(verificationProofMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')).toBe('image/png')
    expect(verificationProofMime(Buffer.from('%PDF-1.7\n'), 'image/jpeg')).toBeNull()
    expect(verificationProofMime(Buffer.from('<script>'), 'application/pdf')).toBeNull()
  })
})
