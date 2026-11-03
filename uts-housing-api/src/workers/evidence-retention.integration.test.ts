import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Uses only a migrated disposable PostgreSQL database and synthetic bytes.
describe.skipIf(!process.env.TEST_DATABASE_URL)('verification evidence retention', () => {
  let prisma: typeof import('../core/db.js').prisma
  let retention: typeof import('./evidence-retention.js')
  let privateRoot = ''
  const now = new Date('2026-11-03T00:00:00.000Z')
  const old = new Date('2026-07-01T00:00:00.000Z')
  const expiry = new Date('2024-09-01T00:00:00.000Z')
  const currentExpiry = new Date('2027-02-01T00:00:00.000Z')
  const adminId = randomUUID()
  const studentId = randomUUID()
  const landlordId = randomUUID()
  const listingId = randomUUID()
  const campusId = randomUUID()
  const studentCaseId = randomUUID()
  const legacyStudentCaseId = randomUUID()
  const expiredIdentityId = randomUUID()
  const currentIdentityId = randomUUID()
  const expiredPropertyId = randomUUID()
  const pendingPropertyId = randomUUID()
  const syntheticJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11])
  const keys = {
    student: `${randomUUID()}.jpg`, offer: `${randomUUID()}.jpg`, legacyStudent: `${randomUUID()}.jpg`,
    expiredIdentity: `${randomUUID()}.jpg`, currentIdentity: `${randomUUID()}.jpg`,
    expiredProperty: `${randomUUID()}.jpg`, pendingProperty: `${randomUUID()}.jpg`,
  }

  async function addEvidence(ownerId: string, key: string, purpose: string, directory: string) {
    await mkdir(join(privateRoot, directory), { recursive: true })
    await writeFile(join(privateRoot, directory, key), syntheticJpeg)
    await prisma.mediaUpload.create({ data: { ownerId, storageKey: key, mimeType: 'image/jpeg', size: syntheticJpeg.length, purpose, status: 'READY' } })
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    privateRoot = await mkdtemp(join(tmpdir(), 'housing-retention-test-'))
    const [dbModule, workerModule] = await Promise.all([import('../core/db.js'), import('./evidence-retention.js')])
    prisma = dbModule.prisma
    retention = workerModule
    await prisma.user.createMany({ data: [
      { id: adminId, name: 'Synthetic Admin', email: `admin-${adminId}@example.test`, passwordHash: 'synthetic', roles: ['ADMIN'] },
      { id: studentId, name: 'Synthetic Student', email: `student-${studentId}@example.test`, passwordHash: 'synthetic', roles: ['STUDENT'] },
      { id: landlordId, name: 'Synthetic Landlord', email: `landlord-${landlordId}@example.test`, passwordHash: 'synthetic', roles: ['LANDLORD'] },
    ] })
    await prisma.campus.create({ data: { id: campusId, name: 'Synthetic Campus', university: 'Synthetic University', latitude: 2.322, longitude: 111.839 } })
    await prisma.listing.create({ data: {
      id: listingId, ownerId: landlordId, campusId, title: 'Synthetic retention room', description: 'A synthetic listing for retention integration testing.',
      propertyType: 'HOUSE', roomType: 'SINGLE', rent: '550.00', deposit: '550.00', availableFrom: new Date('2027-01-01T00:00:00.000Z'), approximateArea: 'Synthetic Sibu',
      address: '123 Synthetic Lane, 96000 Sibu, Sarawak', status: 'DRAFT',
    } })
    await addEvidence(studentId, keys.student, 'VERIFICATION', 'verifications')
    await addEvidence(studentId, keys.offer, 'VERIFICATION', 'verifications')
    await addEvidence(studentId, keys.legacyStudent, 'VERIFICATION', 'verifications')
    await addEvidence(landlordId, keys.expiredIdentity, 'LANDLORD_IDENTITY', 'landlord-verifications')
    await addEvidence(landlordId, keys.currentIdentity, 'LANDLORD_IDENTITY', 'landlord-verifications')
    await addEvidence(landlordId, keys.expiredProperty, 'PROPERTY_AUTHORIZATION', 'landlord-verifications')
    await addEvidence(landlordId, keys.pendingProperty, 'PROPERTY_AUTHORIZATION', 'landlord-verifications')
    await prisma.studentVerification.create({ data: { id: studentCaseId, userId: studentId, method: 'DOCUMENTS', university: 'Synthetic University', status: 'APPROVED', reviewedAt: old, studyEndsAt: new Date('2025-06-30T00:00:00.000Z'), evidenceRetainUntil: new Date('2026-06-30T00:00:00.000Z'), studentIdKey: keys.student, offerLetterKey: keys.offer } })
    await prisma.studentVerification.create({ data: { id: legacyStudentCaseId, userId: studentId, method: 'DOCUMENTS', university: 'Synthetic University', status: 'APPROVED', reviewedAt: old, studentIdKey: keys.legacyStudent } })
    await prisma.landlordVerification.createMany({ data: [
      { id: expiredIdentityId, userId: landlordId, kind: 'INDIVIDUAL', status: 'APPROVED', reviewedAt: old, expiresAt: expiry, identityKey: keys.expiredIdentity },
      { id: currentIdentityId, userId: landlordId, kind: 'INDIVIDUAL', status: 'APPROVED', reviewedAt: old, expiresAt: currentExpiry, identityKey: keys.currentIdentity },
    ] })
    await prisma.propertyAuthorization.createMany({ data: [
      { id: expiredPropertyId, requesterId: landlordId, listingId, kind: 'OWNER', addressSnapshot: '123 Synthetic Lane, 96000 Sibu, Sarawak', status: 'APPROVED', reviewedAt: old, expiresAt: expiry, proofKey: keys.expiredProperty },
      { id: pendingPropertyId, requesterId: landlordId, listingId, kind: 'OWNER', addressSnapshot: '123 Synthetic Lane, 96000 Sibu, Sarawak', status: 'PENDING', proofKey: keys.pendingProperty },
    ] })
  })

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
      await prisma.propertyAuthorization.deleteMany({ where: { requesterId: landlordId } })
      await prisma.landlordVerification.deleteMany({ where: { userId: landlordId } })
      await prisma.studentVerification.deleteMany({ where: { userId: studentId } })
      await prisma.mediaUpload.deleteMany({ where: { ownerId: { in: [studentId, landlordId] } } })
      await prisma.listing.deleteMany({ where: { id: listingId } })
      await prisma.campus.deleteMany({ where: { id: campusId } })
      await prisma.user.deleteMany({ where: { id: { in: [adminId, studentId, landlordId] } } })
      await prisma.$disconnect()
    }
    if (privateRoot) await rm(privateRoot, { recursive: true, force: true })
  })

  it('dry-runs without changes, purges only eligible evidence, and is idempotent', async () => {
    const policy = { student: 1, identity: 2, property: 2 }
    const plan = await retention.planEvidenceRetention(policy, { db: prisma, now, privateRoot })
    expect([plan.byKind.student.total, plan.byKind.identity.total, plan.byKind.property.total]).toEqual([1, 1, 1])
    expect((await prisma.studentVerification.findUniqueOrThrow({ where: { id: studentCaseId } })).studentIdKey).toBe(keys.student)
    expect((await lstat(join(privateRoot, 'verifications', keys.student))).isFile()).toBe(true)

    const result = await retention.applyEvidenceRetention(policy, adminId, { db: prisma, now, privateRoot })
    expect(result.counts).toEqual({ student: 1, identity: 1, property: 1 })
    expect((await prisma.studentVerification.findUniqueOrThrow({ where: { id: studentCaseId } })).studentIdKey).toBeNull()
    expect((await prisma.studentVerification.findUniqueOrThrow({ where: { id: legacyStudentCaseId } })).studentIdKey).toBe(keys.legacyStudent)
    expect((await prisma.landlordVerification.findUniqueOrThrow({ where: { id: expiredIdentityId } })).identityKey).toBeNull()
    expect((await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: expiredPropertyId } })).proofKey).toBeNull()
    expect((await prisma.landlordVerification.findUniqueOrThrow({ where: { id: currentIdentityId } })).identityKey).toBe(keys.currentIdentity)
    expect((await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: pendingPropertyId } })).proofKey).toBe(keys.pendingProperty)
    expect(await prisma.mediaUpload.count({ where: { storageKey: { in: [keys.student, keys.offer, keys.expiredIdentity, keys.expiredProperty] } } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { actorId: adminId, action: 'EVIDENCE_RETENTION_PURGED' } })).toBe(3)
    expect((await lstat(join(privateRoot, 'landlord-verifications', keys.pendingProperty))).isFile()).toBe(true)
    expect((await retention.applyEvidenceRetention(policy, adminId, { db: prisma, now, privateRoot })).processed).toBe(0)
  })

  it('starts the two-year clock at rejection or revocation for both landlord and property proof', async () => {
    const decidedAt = new Date('2024-11-03T00:00:00.000Z')
    const beforeAnniversary = new Date('2026-11-02T23:59:59.999Z')
    const anniversary = new Date('2026-11-03T00:00:00.000Z')
    const cases = {
      rejectedIdentity: { id: randomUUID(), key: `${randomUUID()}.jpg` },
      revokedIdentity: { id: randomUUID(), key: `${randomUUID()}.jpg` },
      rejectedProperty: { id: randomUUID(), key: `${randomUUID()}.jpg` },
      revokedProperty: { id: randomUUID(), key: `${randomUUID()}.jpg` },
    }
    for (const [name, item] of Object.entries(cases)) {
      await addEvidence(landlordId, item.key, name.includes('Identity') ? 'LANDLORD_IDENTITY' : 'PROPERTY_AUTHORIZATION', 'landlord-verifications')
    }
    await prisma.landlordVerification.createMany({ data: [
      { id: cases.rejectedIdentity.id, userId: landlordId, kind: 'INDIVIDUAL', status: 'REJECTED', reviewedAt: decidedAt,
        expiresAt: new Date('2022-01-01T00:00:00.000Z'), identityKey: cases.rejectedIdentity.key },
      { id: cases.revokedIdentity.id, userId: landlordId, kind: 'INDIVIDUAL', status: 'REVOKED', revokedAt: decidedAt,
        expiresAt: new Date('2022-01-01T00:00:00.000Z'), identityKey: cases.revokedIdentity.key },
    ] })
    await prisma.propertyAuthorization.createMany({ data: [
      { id: cases.rejectedProperty.id, requesterId: landlordId, listingId, kind: 'OWNER', addressSnapshot: '123 Synthetic Lane, 96000 Sibu, Sarawak',
        status: 'REJECTED', reviewedAt: decidedAt, expiresAt: new Date('2022-01-01T00:00:00.000Z'), proofKey: cases.rejectedProperty.key },
      { id: cases.revokedProperty.id, requesterId: landlordId, listingId, kind: 'OWNER', addressSnapshot: '123 Synthetic Lane, 96000 Sibu, Sarawak',
        status: 'REVOKED', revokedAt: decidedAt, expiresAt: new Date('2022-01-01T00:00:00.000Z'), proofKey: cases.revokedProperty.key },
    ] })

    const policy = { identity: 2, property: 2 }
    const early = await retention.planEvidenceRetention(policy, { db: prisma, now: beforeAnniversary, privateRoot })
    expect([early.byKind.identity.total, early.byKind.property.total]).toEqual([0, 0])
    for (const item of Object.values(cases)) expect((await lstat(join(privateRoot, 'landlord-verifications', item.key))).isFile()).toBe(true)

    const due = await retention.planEvidenceRetention(policy, { db: prisma, now: anniversary, privateRoot })
    expect([due.byKind.identity.total, due.byKind.property.total]).toEqual([2, 2])
    const result = await retention.applyEvidenceRetention(policy, adminId, { db: prisma, now: anniversary, privateRoot })
    expect(result.counts).toEqual({ student: 0, identity: 2, property: 2 })
    expect((await prisma.landlordVerification.findUniqueOrThrow({ where: { id: currentIdentityId } })).identityKey).toBe(keys.currentIdentity)
    for (const item of Object.values(cases)) {
      expect(await prisma.mediaUpload.findUnique({ where: { storageKey: item.key } })).toBeNull()
      await expect(lstat(join(privateRoot, 'landlord-verifications', item.key))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('restores a crashed pre-commit move only when the database still references it', async () => {
    const runId = randomUUID()
    const holding = join(privateRoot, 'retention-quarantine', runId)
    await mkdir(holding, { recursive: true })
    await rename(join(privateRoot, 'landlord-verifications', keys.pendingProperty), join(holding, keys.pendingProperty))
    const plan = await retention.recoverEvidenceQuarantine({ db: prisma, privateRoot })
    expect(plan.referenced).toBe(1)
    expect(plan.restored).toBe(0)
    const restored = await retention.recoverEvidenceQuarantine({ db: prisma, privateRoot, apply: true })
    expect(restored.restored).toBe(1)
    expect((await lstat(join(privateRoot, 'landlord-verifications', keys.pendingProperty))).isFile()).toBe(true)
    expect((await prisma.propertyAuthorization.findUniqueOrThrow({ where: { id: pendingPropertyId } })).proofKey).toBe(keys.pendingProperty)
  })

  it('stops on a missing eligible file without clearing its database reference', async () => {
    const file = join(privateRoot, 'landlord-verifications', keys.currentIdentity)
    await rm(file)
    await expect(retention.planEvidenceRetention({ identity: 2 }, { db: prisma, now: new Date('2030-04-01T00:00:00.000Z'), privateRoot })).rejects.toThrow('Referenced evidence is missing')
    expect((await prisma.landlordVerification.findUniqueOrThrow({ where: { id: currentIdentityId } })).identityKey).toBe(keys.currentIdentity)
    await writeFile(file, syntheticJpeg)
  })
})
