import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createUploadTicket, readListingUpload, readUpload, saveUpload } from './listings.js'

let privateDirectory: string | null = null
afterEach(async () => {
  if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true })
  privateDirectory = null
  delete process.env.MEDIA_PRIVATE_DIR
})

async function upload(purpose: 'LISTING_PHOTO' | 'REVIEW_EVIDENCE', bytes: Buffer, mimeType: string) {
  privateDirectory = await mkdtemp(join(tmpdir(), 'housing-upload-test-'))
  process.env.MEDIA_PRIVATE_DIR = privateDirectory
  const ticket = createUploadTicket('uploader', mimeType, bytes.length, purpose)
  const signedUrl = new URL(ticket.uploadUrl, 'http://localhost')
  return { ticket, args: {
    objectKey: ticket.objectKey,
    ownerId: 'uploader',
    mimeType,
    declaredSize: bytes.length,
    expires: Number(signedUrl.searchParams.get('expires')),
    sig: signedUrl.searchParams.get('sig')!,
    purpose,
    bytes,
  } }
}

describe('private upload tickets', () => {
  it('rejects a modified ticket and content whose signature does not match the MIME type', async () => {
    const bytes = Buffer.from('not-a-png')
    const { args } = await upload('LISTING_PHOTO', bytes, 'image/png')
    await expect(saveUpload({ ...args, declaredSize: bytes.length + 1 })).rejects.toThrow('invalid or has expired')
    await expect(saveUpload(args)).rejects.toThrow('file content or size')
  })

  it('never serves review proof as a public listing image', async () => {
    const bytes = Buffer.from('%PDF-1.7\nprivate proof')
    const { args, ticket } = await upload('REVIEW_EVIDENCE', bytes, 'application/pdf')
    await saveUpload(args)
    expect(await readListingUpload(ticket.objectKey)).toBeNull()
    expect((await readUpload(ticket.objectKey))?.bytes).toEqual(bytes)
  })

  it('removes embedded metadata from a public photo before storage', async () => {
    const original = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#4080c0' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'Private location metadata' } })
      .toBuffer()
    expect((await sharp(original).metadata()).exif).toBeDefined()
    const { args, ticket } = await upload('LISTING_PHOTO', original, 'image/jpeg')
    await saveUpload(args)
    const stored = await readListingUpload(ticket.objectKey)
    expect(stored?.bytes).toBeDefined()
    expect((await sharp(stored!.bytes).metadata()).exif).toBeUndefined()
  })
})
