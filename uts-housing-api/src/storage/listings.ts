import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

export const MAX_LISTING_PHOTO_BYTES = 5 * 1024 * 1024
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const EVIDENCE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const UPLOAD_LIFETIME_MS = 10 * 60 * 1000
export type UploadPurpose = 'LISTING_PHOTO' | 'REVIEW_EVIDENCE'

export interface ListingUploadMetadata {
  key: string
  ownerId: string
  mimeType: string
  size: number
  purpose: UploadPurpose
  uploadedAt: string
}

function storageDirectory() {
  return resolve(process.env.MEDIA_PRIVATE_DIR || process.env.UPLOAD_DIR || './uploads', 'listings')
}

function uploadSecret() {
  const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-only-session-secret-change-before-launch')
  if (secret.length < 32) throw new Error('UPLOAD_SIGNING_SECRET or SESSION_SECRET must contain at least 32 characters.')
  return secret
}

function signature(key: string, ownerId: string, mimeType: string, size: number, expires: number, purpose: UploadPurpose) {
  return createHmac('sha256', uploadSecret()).update(`${key}:${ownerId}:${mimeType}:${size}:${expires}:${purpose}`).digest('hex')
}

export function isAllowedUploadType(purpose: UploadPurpose, mimeType: string, size: number) {
  const types = purpose === 'REVIEW_EVIDENCE' ? EVIDENCE_MIME_TYPES : PHOTO_MIME_TYPES
  return types.has(mimeType) && Number.isInteger(size) && size > 0 && size <= MAX_LISTING_PHOTO_BYTES
}

export function createUploadTicket(ownerId: string, mimeType: string, size: number, purpose: UploadPurpose = 'LISTING_PHOTO') {
  if (!isAllowedUploadType(purpose, mimeType, size)) throw new Error(purpose === 'LISTING_PHOTO' ? 'Choose a JPEG, PNG or WebP image under 5 MB.' : 'Choose a PDF, JPEG or PNG proof under 5 MB.')
  const objectKey = randomUUID()
  const expires = Date.now() + UPLOAD_LIFETIME_MS
  const sig = signature(objectKey, ownerId, mimeType, size, expires, purpose)
  const params = new URLSearchParams({ expires: String(expires), type: mimeType, size: String(size), purpose, sig })
  return { objectKey, uploadUrl: `/api/v1/uploads/${objectKey}?${params.toString()}`, headers: { 'Content-Type': mimeType }, expiresAt: new Date(expires).toISOString() }
}

export const createListingUploadTicket = (ownerId: string, mimeType: string, size: number) => createUploadTicket(ownerId, mimeType, size, 'LISTING_PHOTO')

function validImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (mimeType === 'application/pdf') return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-'
  return false
}

async function stripPublicPhotoMetadata(bytes: Buffer, mimeType: string) {
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
    const output = mimeType === 'image/jpeg' ? image.jpeg({ quality: 85 })
      : mimeType === 'image/png' ? image.png()
      : image.webp({ quality: 85 })
    const clean = await output.toBuffer()
    if (clean.length > MAX_LISTING_PHOTO_BYTES) throw new Error('The processed image is too large. Choose a smaller photo.')
    return clean
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The processed image')) throw error
    throw new Error('The selected image could not be processed. Choose a valid photo.')
  }
}

export async function saveUpload(args: {
  objectKey: string
  ownerId: string
  mimeType: string
  declaredSize: number
  expires: number
  sig: string
  purpose: UploadPurpose
  bytes: Buffer
}): Promise<ListingUploadMetadata> {
  const { objectKey, ownerId, mimeType, declaredSize, expires, sig, purpose, bytes } = args
  if (!/^[0-9a-f-]{36}$/.test(objectKey) || !isAllowedUploadType(purpose, mimeType, declaredSize) || !Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + UPLOAD_LIFETIME_MS || !/^[0-9a-f]{64}$/.test(sig)) throw new Error('This upload link is invalid or has expired.')
  const expected = Buffer.from(signature(objectKey, ownerId, mimeType, declaredSize, expires, purpose), 'hex')
  const received = Buffer.from(sig, 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('This upload link is invalid or has expired.')
  if (bytes.length !== declaredSize || !validImageSignature(bytes, mimeType)) throw new Error('The file content or size does not match the selected file.')
  // Sharp drops EXIF, XMP and other metadata by default. GPS tags on public
  // photos must not disclose a pin the owner chose to keep private.
  const storedBytes = purpose === 'LISTING_PHOTO' ? await stripPublicPhotoMetadata(bytes, mimeType) : bytes
  const directory = storageDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const metadata: ListingUploadMetadata = { key: objectKey, ownerId, mimeType, size: storedBytes.length, purpose, uploadedAt: new Date().toISOString() }
  await writeFile(resolve(directory, objectKey), storedBytes, { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(directory, `${objectKey}.json`), JSON.stringify(metadata), { flag: 'wx', mode: 0o600 })
  return metadata
}

export async function uploadMetadata(objectKey: string): Promise<ListingUploadMetadata | null> {
  if (!/^[0-9a-f-]{36}$/.test(objectKey)) return null
  try {
    const directory = storageDirectory()
    const metadata = JSON.parse(await readFile(resolve(directory, `${objectKey}.json`), 'utf8')) as ListingUploadMetadata
    const file = await stat(resolve(directory, objectKey))
    return metadata.key === objectKey && isAllowedUploadType(metadata.purpose, metadata.mimeType, metadata.size) && metadata.size === file.size ? metadata : null
  } catch {
    return null
  }
}

export async function readUpload(objectKey: string) {
  const metadata = await uploadMetadata(objectKey)
  if (!metadata) return null
  return { ...metadata, bytes: await readFile(resolve(storageDirectory(), objectKey)) }
}

export async function listingUploadMetadata(objectKey: string) {
  const metadata = await uploadMetadata(objectKey)
  return metadata?.purpose === 'LISTING_PHOTO' ? metadata : null
}

export async function readListingUpload(objectKey: string) {
  const value = await readUpload(objectKey)
  return value?.purpose === 'LISTING_PHOTO' ? value : null
}
