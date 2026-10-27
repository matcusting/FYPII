import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditPrivateMedia, mediaDirectories, quarantineOrphans } from './private-media-core.mjs'

const roots = []
const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const empty = () => ({ uploads: [], studentVerifications: [], landlordVerifications: [], propertyAuthorizations: [], listingPhotos: [], reviews: [] })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fypii-media-audit-'))
  roots.push(root)
  const directories = mediaDirectories({ MEDIA_PRIVATE_DIR: join(root, 'private') })
  await Promise.all([directories.verifications, directories.landlord, directories.listings].map(path => mkdir(path, { recursive: true })))
  return directories
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('private media audit', () => {
  it('checks referenced private proof content and database upload records', async () => {
    const directories = await fixture()
    const proof = `${id}.jpg`
    await writeFile(join(directories.verifications, proof), 'proof')
    const rows = { ...empty(), uploads: [{ storageKey: proof, purpose: 'VERIFICATION', status: 'READY', size: 5 }], studentVerifications: [{ studentIdKey: proof, offerLetterKey: `${otherId}.pdf`, proofKey: null }] }
    const report = await auditPrivateMedia(rows, directories)
    expect(report.problems.map(problem => problem.type)).toEqual(['missing database upload'])
    expect(report.orphans).toEqual([])
  })

  it('detects missing or damaged files without quarantining live media', async () => {
    const directories = await fixture()
    const rows = { ...empty(), uploads: [{ storageKey: `${id}.png`, purpose: 'LANDLORD_IDENTITY', status: 'READY', size: 100 }] }
    const report = await auditPrivateMedia(rows, directories)
    expect(report.problems[0]?.type).toBe('missing or unsafe file')
    expect(report.orphans).toEqual([])
    await writeFile(join(directories.landlord, `${id}.png`), 'small')
    const second = await auditPrivateMedia(rows, directories)
    expect(second.problems[0]?.type).toBe('file size mismatch')
  })

  it('only identifies old unreferenced files and moves them to a reversible quarantine on request', async () => {
    const directories = await fixture()
    const oldPath = join(directories.landlord, `${id}.pdf`)
    const recentPath = join(directories.landlord, `${otherId}.pdf`)
    await writeFile(oldPath, 'old')
    await writeFile(recentPath, 'new')
    const now = Date.now()
    await utimes(oldPath, new Date(now - 40 * 86_400_000), new Date(now - 40 * 86_400_000))
    const report = await auditPrivateMedia(empty(), directories, { now, orphanDays: 30 })
    expect(report.orphans.map(item => item.name)).toEqual([`${id}.pdf`])
    expect(await readFile(oldPath, 'utf8')).toBe('old')
    const skipped = await quarantineOrphans(report.orphans, directories, async () => false)
    expect(skipped.moved).toBe(0)
    const moved = await quarantineOrphans(report.orphans, directories, async () => true)
    expect(moved.moved).toBe(1)
    expect(await readFile(join(moved.directory, 'landlord', `${id}.pdf`), 'utf8')).toBe('old')
    expect(await readFile(recentPath, 'utf8')).toBe('new')
  })

  it('keeps listed files even when their upload row is absent', async () => {
    const directories = await fixture()
    const key = `${id}.png`
    const path = join(directories.landlord, key)
    await writeFile(path, 'proof')
    await utimes(path, new Date(0), new Date(0))
    const report = await auditPrivateMedia({ ...empty(), landlordVerifications: [{ identityKey: key, companyKey: null, representationKey: null }] }, directories)
    expect(report.problems[0]?.type).toBe('missing database upload')
    expect(report.orphans).toEqual([])
  })

  it('checks processed listing photos against their metadata rather than the original upload size', async () => {
    const directories = await fixture()
    await writeFile(join(directories.listings, id), 'processed')
    await writeFile(join(directories.listings, `${id}.json`), JSON.stringify({ key: id, size: 9, purpose: 'LISTING_PHOTO', mimeType: 'image/jpeg' }))
    const rows = { ...empty(), uploads: [{ storageKey: id, purpose: 'LISTING_PHOTO', status: 'UPLOADED', size: 100, mimeType: 'image/jpeg' }], listingPhotos: [{ storageKey: id }] }
    expect((await auditPrivateMedia(rows, directories)).problems).toEqual([])
  })
})
