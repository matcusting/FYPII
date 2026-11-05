import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.TEST_DATABASE_URL)('durable private file deletion', () => {
  let prisma: typeof import('../core/db.js').prisma
  let processPendingFileDeletions: typeof import('./file-deletion.js').processPendingFileDeletions
  let privateRoot = ''
  const ownerId = randomUUID()
  const keys = {
    missingRoot: `${randomUUID()}.jpg`,
    interrupted: `${randomUUID()}.pdf`,
    referenced: `${randomUUID()}.png`,
    empty: randomUUID(),
    listing: randomUUID(),
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    const [db, worker] = await Promise.all([import('../core/db.js'), import('./file-deletion.js')])
    prisma = db.prisma
    processPendingFileDeletions = worker.processPendingFileDeletions
    privateRoot = await mkdtemp(join(tmpdir(), 'housing-file-deletion-'))
    await prisma.user.create({ data: { id: ownerId, name: 'Synthetic deletion owner', email: `file-deletion-${ownerId}@example.test`, passwordHash: 'synthetic' } })
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.studentVerification.deleteMany({ where: { userId: ownerId } })
      await prisma.mediaUpload.deleteMany({ where: { ownerId } })
      await prisma.user.deleteMany({ where: { id: ownerId } })
      await prisma.$disconnect()
    }
    if (privateRoot) await rm(privateRoot, { recursive: true, force: true })
  })

  async function add(key: string, purpose: string, status = 'DELETE_PENDING') {
    await prisma.mediaUpload.create({ data: { ownerId, storageKey: key, mimeType: key.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', size: 4, purpose, status } })
  }

  it('keeps its journal when a mounted media root is wrong, then deletes the real file', async () => {
    const key = keys.missingRoot
    await add(key, 'VERIFICATION')
    await mkdir(join(privateRoot, 'verifications'))
    const path = join(privateRoot, 'verifications', key)
    await writeFile(path, 'test')
    const wrongRoot = await mkdtemp(join(tmpdir(), 'housing-wrong-media-root-'))
    try {
      expect(await processPendingFileDeletions({ db: prisma, privateRoot: wrongRoot, ownerId })).toMatchObject({ removed: 0, failed: 1 })
      expect(await prisma.mediaUpload.findUnique({ where: { storageKey: key } })).not.toBeNull()
      expect(await readFile(path, 'utf8')).toBe('test')
    } finally { await rm(wrongRoot, { recursive: true, force: true }) }
    expect(await processPendingFileDeletions({ db: prisma, privateRoot, ownerId })).toMatchObject({ removed: 1, failed: 0 })
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await prisma.mediaUpload.findUnique({ where: { storageKey: key } })).toBeNull()
  })

  it('recovers a crash after moving a document into private quarantine', async () => {
    const key = keys.interrupted
    await add(key, 'LANDLORD_IDENTITY')
    await mkdir(join(privateRoot, 'landlord-verifications'), { recursive: true })
    await mkdir(join(privateRoot, 'deletion-quarantine'), { recursive: true })
    await writeFile(join(privateRoot, 'landlord-verifications', key), 'test')
    await rename(join(privateRoot, 'landlord-verifications', key), join(privateRoot, 'deletion-quarantine', key))
    expect(await processPendingFileDeletions({ db: prisma, privateRoot, ownerId })).toMatchObject({ removed: 1, failed: 0 })
    await expect(lstat(join(privateRoot, 'deletion-quarantine', key))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to remove evidence while a case still references its key', async () => {
    const key = keys.referenced
    await add(key, 'VERIFICATION')
    await writeFile(join(privateRoot, 'verifications', key), 'test')
    const verification = await prisma.studentVerification.create({ data: { userId: ownerId, university: 'Synthetic University', method: 'DOCUMENTS', studentIdKey: key } })
    expect(await processPendingFileDeletions({ db: prisma, privateRoot, ownerId })).toMatchObject({ removed: 0, failed: 1 })
    expect(await readFile(join(privateRoot, 'verifications', key), 'utf8')).toBe('test')
    await prisma.studentVerification.update({ where: { id: verification.id }, data: { studentIdKey: null } })
    expect(await processPendingFileDeletions({ db: prisma, privateRoot, ownerId })).toMatchObject({ removed: 1, failed: 0 })
  })

  it('clears never-uploaded tickets and both listing file and metadata', async () => {
    await add(keys.empty, 'LISTING_PHOTO', 'DELETE_PENDING_EMPTY')
    await add(keys.listing, 'LISTING_PHOTO')
    await mkdir(join(privateRoot, 'listings'), { recursive: true })
    await writeFile(join(privateRoot, 'listings', keys.listing), 'test')
    await writeFile(join(privateRoot, 'listings', `${keys.listing}.json`), '{"ownerId":"synthetic"}')
    expect(await processPendingFileDeletions({ db: prisma, privateRoot, ownerId })).toMatchObject({ removed: 2, failed: 0 })
    await expect(lstat(join(privateRoot, 'listings', keys.listing))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(privateRoot, 'listings', `${keys.listing}.json`))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
