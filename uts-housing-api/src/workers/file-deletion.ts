import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../core/db.js'

const documentKey = /^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/
const listingKey = /^[0-9a-f-]{36}$/

function filePairs(purpose: string, storageKey: string, privateRoot: string, listingRoot: string): Array<{ source: string; quarantine: string }> {
  if (purpose === 'VERIFICATION' && documentKey.test(storageKey)) {
    return [{ source: resolve(privateRoot, 'verifications', storageKey), quarantine: resolve(privateRoot, 'deletion-quarantine', storageKey) }]
  }
  if (['LANDLORD_IDENTITY', 'PROPERTY_AUTHORIZATION'].includes(purpose) && documentKey.test(storageKey)) {
    return [{ source: resolve(privateRoot, 'landlord-verifications', storageKey), quarantine: resolve(privateRoot, 'deletion-quarantine', storageKey) }]
  }
  if (['LISTING_PHOTO', 'REVIEW_EVIDENCE'].includes(purpose) && listingKey.test(storageKey)) {
    return [storageKey, `${storageKey}.json`].map(name => ({
      source: resolve(listingRoot, 'listings', name), quarantine: resolve(listingRoot, 'deletion-quarantine', name),
    }))
  }
  throw new Error('Pending file deletion has an unexpected purpose or storage key.')
}

async function regularFile(path: string): Promise<boolean> {
  const file = await lstat(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!file) return false
  if (!file.isFile() || file.isSymbolicLink()) throw new Error('Pending deletion path is not a regular file.')
  return true
}

async function hasLiveReference(db: PrismaClient, key: string): Promise<boolean> {
  const counts = await Promise.all([
    db.studentVerification.count({ where: { OR: [{ proofKey: key }, { studentIdKey: key }, { offerLetterKey: key }] } }),
    db.landlordVerification.count({ where: { OR: [{ identityKey: key }, { companyKey: key }, { representationKey: key }] } }),
    db.propertyAuthorization.count({ where: { OR: [{ proofKey: key }, { supportingKey: key }] } }),
    db.listingPhoto.count({ where: { storageKey: key } }),
    db.review.count({ where: { experienceProofKey: key } }),
  ])
  return counts.some(count => count > 0)
}

/** The MediaUpload row is a durable deletion journal. Moving bytes into a
 * private quarantine lets a retry recover after a crash between filesystem
 * work and a database commit; missing files in an unstarted deletion are
 * treated as an error instead of silently forgetting a possibly wrong root. */
export async function processPendingFileDeletions(options: { db?: PrismaClient; privateRoot?: string; limit?: number; ownerId?: string } = {}) {
  const db = options.db || prisma
  const privateRoot = resolve(options.privateRoot || process.env.MEDIA_PRIVATE_DIR || './data/private')
  const listingRoot = resolve(options.privateRoot || process.env.MEDIA_PRIVATE_DIR || process.env.UPLOAD_DIR || './uploads')
  const limit = options.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Use a deletion batch between 1 and 500.')
  const rows = await db.mediaUpload.findMany({ where: {
    status: { in: ['DELETE_PENDING', 'DELETE_PENDING_EMPTY', 'DELETE_QUARANTINED'] },
    ...(options.ownerId ? { ownerId: options.ownerId } : {}),
  }, orderBy: { createdAt: 'asc' }, take: limit })
  let removed = 0
  let failed = 0
  for (const row of rows) {
    try {
      const pairs = filePairs(row.purpose, row.storageKey, privateRoot, listingRoot)
      if (await hasLiveReference(db, row.storageKey)) throw new Error('Pending file still has a live reference.')
      let found = false
      for (const pair of pairs) {
        const [source, quarantine] = await Promise.all([regularFile(pair.source), regularFile(pair.quarantine)])
        if (source && quarantine) throw new Error('Duplicate source and quarantine file for pending deletion.')
        if (source) {
          await mkdir(dirname(pair.quarantine), { recursive: true, mode: 0o700 })
          await rename(pair.source, pair.quarantine)
          found = true
        } else if (quarantine) found = true
      }
      if (!found && row.status !== 'DELETE_PENDING_EMPTY') throw new Error('Pending file is missing; check the configured private media root before clearing its journal.')
      if (row.status !== 'DELETE_QUARANTINED') {
        const staged = await db.mediaUpload.updateMany({ where: { id: row.id, storageKey: row.storageKey, status: row.status }, data: { status: 'DELETE_QUARANTINED' } })
        if (!staged.count) throw new Error('Pending file deletion changed concurrently.')
      }
      if (await hasLiveReference(db, row.storageKey)) throw new Error('Pending file gained a live reference.')
      for (const pair of pairs) {
        if (await regularFile(pair.source)) throw new Error('Source file reappeared while deleting.')
        if (await regularFile(pair.quarantine)) await rm(pair.quarantine)
      }
      const deleted = await db.mediaUpload.deleteMany({ where: { id: row.id, storageKey: row.storageKey, status: 'DELETE_QUARANTINED' } })
      if (deleted.count) removed++
    } catch {
      failed++
    }
  }
  return { selected: rows.length, removed, failed }
}
