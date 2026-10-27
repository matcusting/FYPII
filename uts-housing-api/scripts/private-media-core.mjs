import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const fileKey = /^[0-9a-f-]{36}(?:\.(?:pdf|jpg|png))?$/
const listingKey = /^[0-9a-f-]{36}$/

export function mediaDirectories(env = process.env) {
  const privateRoot = resolve(env.MEDIA_PRIVATE_DIR || './data/private')
  return {
    privateRoot,
    verifications: join(privateRoot, 'verifications'),
    landlord: join(privateRoot, 'landlord-verifications'),
    listings: resolve(env.MEDIA_PRIVATE_DIR || env.UPLOAD_DIR || './uploads', 'listings'),
  }
}

export function bucketForPurpose(purpose) {
  if (purpose === 'VERIFICATION') return 'verifications'
  if (purpose === 'LANDLORD_IDENTITY' || purpose === 'PROPERTY_AUTHORIZATION') return 'landlord'
  if (purpose === 'LISTING_PHOTO' || purpose === 'REVIEW_EVIDENCE') return 'listings'
  return null
}

function referencesFrom(rows) {
  const references = []
  const add = (key, purpose, source) => { if (key) references.push({ key, purpose, source }) }
  for (const row of rows.studentVerifications) {
    add(row.proofKey, 'VERIFICATION', 'student verification')
    add(row.studentIdKey, 'VERIFICATION', 'student verification')
    add(row.offerLetterKey, 'VERIFICATION', 'student verification')
  }
  for (const row of rows.landlordVerifications) {
    add(row.identityKey, 'LANDLORD_IDENTITY', 'landlord identity')
    add(row.companyKey, 'LANDLORD_IDENTITY', 'landlord identity')
    add(row.representationKey, 'LANDLORD_IDENTITY', 'landlord identity')
  }
  for (const row of rows.propertyAuthorizations) {
    add(row.proofKey, 'PROPERTY_AUTHORIZATION', 'property authorization')
    add(row.supportingKey, 'PROPERTY_AUTHORIZATION', 'property authorization')
  }
  for (const row of rows.listingPhotos) add(row.storageKey, 'LISTING_PHOTO', 'listing photo')
  for (const row of rows.reviews) add(row.experienceProofKey, 'REVIEW_EVIDENCE', 'review evidence')
  return references
}

async function fileStatus(path) {
  try { return await lstat(path) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** Read-only inventory. Never treats a referenced or recently written file as an orphan. */
export async function auditPrivateMedia(rows, directories, { now = Date.now(), orphanDays = 30 } = {}) {
  if (!Number.isInteger(orphanDays) || orphanDays < 1) throw new Error('orphanDays must be a positive whole number.')
  const problems = []
  const uploads = new Map(rows.uploads.map(row => [row.storageKey, row]))
  const references = referencesFrom(rows)
  const referencedKeys = new Set(references.map(row => row.key))
  for (const reference of references) {
    const upload = uploads.get(reference.key)
    if (!upload) problems.push({ type: 'missing database upload', bucket: bucketForPurpose(reference.purpose), key: reference.key, source: reference.source })
    else if (upload.purpose !== reference.purpose) problems.push({ type: 'wrong upload purpose', bucket: bucketForPurpose(reference.purpose), key: reference.key, source: reference.source })
  }
  for (const upload of rows.uploads) {
    const bucket = bucketForPurpose(upload.purpose)
    if (!bucket) { problems.push({ type: 'unknown upload purpose', key: upload.storageKey }); continue }
    if (!(bucket === 'listings' ? listingKey : fileKey).test(upload.storageKey) || basename(upload.storageKey) !== upload.storageKey) {
      problems.push({ type: 'unsafe upload key', bucket, key: upload.storageKey }); continue
    }
    if (upload.status === 'PENDING') continue
    const file = await fileStatus(join(directories[bucket], upload.storageKey))
    if (!file || !file.isFile()) problems.push({ type: 'missing or unsafe file', bucket, key: upload.storageKey })
    else if (bucket !== 'listings' && file.size !== upload.size) problems.push({ type: 'file size mismatch', bucket, key: upload.storageKey })
    if (bucket === 'listings') {
      const path = join(directories.listings, `${upload.storageKey}.json`)
      const metadata = await fileStatus(path)
      if (!metadata?.isFile()) problems.push({ type: 'missing listing metadata', bucket, key: upload.storageKey })
      else {
        try {
          const value = JSON.parse(await readFile(path, 'utf8'))
          if (value.key !== upload.storageKey || value.purpose !== upload.purpose || value.mimeType !== upload.mimeType || value.size !== file?.size) {
            problems.push({ type: 'listing metadata mismatch', bucket, key: upload.storageKey })
          }
        } catch { problems.push({ type: 'invalid listing metadata', bucket, key: upload.storageKey }) }
      }
    }
  }

  const orphans = []
  const threshold = now - orphanDays * 24 * 60 * 60 * 1000
  for (const bucket of ['verifications', 'landlord', 'listings']) {
    let entries
    try { entries = await readdir(directories[bucket], { withFileTypes: true }) }
    catch (error) { if (error?.code === 'ENOENT') continue; throw error }
    for (const entry of entries) {
      if (!entry.isFile()) {
        problems.push({ type: 'unexpected directory entry', bucket, key: entry.name })
        continue
      }
      const key = bucket === 'listings' ? entry.name.replace(/\.json$/, '') : entry.name
      if (!(bucket === 'listings' ? listingKey : fileKey).test(key) || (bucket === 'listings' && entry.name !== key && entry.name !== `${key}.json`)) {
        problems.push({ type: 'unexpected file name', bucket, key: entry.name })
        continue
      }
      if (uploads.has(key) || referencedKeys.has(key)) continue
      const path = join(directories[bucket], entry.name)
      const stat = await lstat(path)
      if (stat.mtimeMs > threshold) continue
      orphans.push({ bucket, key, name: entry.name, path, mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }
  return { problems, orphans, checkedUploads: rows.uploads.length, checkedReferences: references.length, orphanDays }
}

/** Move only vetted orphan files into a private quarantine. No files are deleted. */
export async function quarantineOrphans(orphans, directories, stillUnreferenced) {
  if (!orphans.length) return { moved: 0, directory: null }
  const destination = join(directories.privateRoot, 'quarantine', new Date().toISOString().replaceAll(':', '-'))
  let moved = 0
  for (const item of orphans) {
    if (!(await stillUnreferenced(item.key))) continue
    const current = await fileStatus(item.path)
    if (!current?.isFile() || current.mtimeMs !== item.mtimeMs || current.size !== item.size) continue
    const targetDirectory = join(destination, item.bucket)
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 })
    await rename(item.path, join(targetDirectory, item.name))
    moved++
  }
  return { moved, directory: moved ? destination : null }
}
