import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultDb } from '../core/db.js'
import { addUtcCalendarYears, utcDayAfter } from '../core/retention-dates.js'

type Kind = 'student' | 'identity' | 'property'
type Policy = Partial<Record<Kind, number>>
type Database = PrismaClient | Prisma.TransactionClient
type Candidate = {
  kind: Kind
  id: string
  ownerId: string
  status: string
  reviewedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  evidenceRetainUntil: Date | null
  keys: string[]
}

const safeKey = /^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/
const purposes: Record<Kind, string> = { student: 'VERIFICATION', identity: 'LANDLORD_IDENTITY', property: 'PROPERTY_AUTHORIZATION' }
const targetTypes: Record<Kind, string> = { student: 'STUDENT_VERIFICATION', identity: 'LANDLORD_VERIFICATION', property: 'PROPERTY_AUTHORIZATION' }

export function validateRetentionPolicy(policy: Policy): void {
  if (!Object.keys(policy).length) throw new Error('Choose at least one evidence type for the approved retention policy.')
  for (const [kind, days] of Object.entries(policy)) {
    // The values are policy-version markers, not arbitrary operator-supplied
    // durations: student = offer end + 1 calendar year; other proof = 2 years.
    if (!['student', 'identity', 'property'].includes(kind) || !Number.isInteger(days)
      || (kind === 'student' ? days !== 1 : days !== 2)) {
      throw new Error(`Invalid ${kind} retention policy. Use student offer-end + 1 year or identity/property + 2 years.`)
    }
  }
}

export function retentionAnchor(candidate: Candidate): Date | null {
  if (candidate.kind === 'student') return candidate.status === 'APPROVED' ? candidate.evidenceRetainUntil : null
  if (candidate.status === 'REJECTED') return candidate.reviewedAt
  if (candidate.status === 'REVOKED') return candidate.revokedAt
  if (candidate.status !== 'APPROVED') return null
  // Never remove evidence while a landlord identity or property authorization
  // is still current. Their two-year clock starts only after expiry.
  return candidate.expiresAt
}

export function isRetentionEligible(candidate: Candidate, policyVersion: number, now: Date): boolean {
  const anchor = retentionAnchor(candidate)
  if (!anchor || !candidate.keys.length) return false
  return candidate.kind === 'student'
    ? policyVersion === 1 && utcDayAfter(anchor).getTime() <= now.getTime()
    : policyVersion === 2 && addUtcCalendarYears(anchor, 2).getTime() <= now.getTime()
}

function keysOf(row: Record<string, unknown>, kind: Kind): string[] {
  const fields = kind === 'student' ? ['proofKey', 'studentIdKey', 'offerLetterKey']
    : kind === 'identity' ? ['identityKey', 'companyKey', 'representationKey'] : ['proofKey', 'supportingKey']
  return fields.map(field => row[field]).filter((key): key is string => typeof key === 'string' && key.length > 0)
}

function asCandidate(kind: Kind, row: Record<string, unknown>): Candidate {
  return {
    kind, id: row.id as string, ownerId: (kind === 'property' ? row.requesterId : row.userId) as string,
    status: row.status as string, reviewedAt: row.reviewedAt as Date | null,
    expiresAt: (row.expiresAt as Date | null) || null, revokedAt: (row.revokedAt as Date | null) || null,
    evidenceRetainUntil: (row.evidenceRetainUntil as Date | null) || null,
    keys: keysOf(row, kind),
  }
}

async function loadCandidate(db: Database, kind: Kind, id: string): Promise<Candidate | null> {
  const row = kind === 'student' ? await db.studentVerification.findUnique({ where: { id } })
    : kind === 'identity' ? await db.landlordVerification.findUnique({ where: { id } })
      : await db.propertyAuthorization.findUnique({ where: { id } })
  return row ? asCandidate(kind, row as unknown as Record<string, unknown>) : null
}

async function eligibleCandidates(db: PrismaClient, kind: Kind, policyVersion: number, now: Date, limit: number): Promise<{ total: number; rows: Candidate[] }> {
  let cursor: string | undefined
  let total = 0
  const rows: Candidate[] = []
  // Scan metadata in bounded pages so leap-day anniversary arithmetic is
  // exact. A simple "now minus two years" SQL cutoff misses 29 February.
  while (true) {
    const pageSize = 500
    const page = kind === 'student' ? await db.studentVerification.findMany({
      where: { status: 'APPROVED', evidenceRetainUntil: { not: null }, OR: [{ proofKey: { not: null } }, { studentIdKey: { not: null } }, { offerLetterKey: { not: null } }] },
      orderBy: { id: 'asc' }, take: pageSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }) : kind === 'identity' ? await db.landlordVerification.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED', 'REVOKED'] }, OR: [{ identityKey: { not: null } }, { companyKey: { not: null } }, { representationKey: { not: null } }] },
      orderBy: { id: 'asc' }, take: pageSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }) : await db.propertyAuthorization.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED', 'REVOKED'] }, OR: [{ proofKey: { not: null } }, { supportingKey: { not: null } }] },
      orderBy: { id: 'asc' }, take: pageSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    for (const row of page) {
      const candidate = asCandidate(kind, row as unknown as Record<string, unknown>)
      if (!isRetentionEligible(candidate, policyVersion, now)) continue
      total++
      if (rows.length < limit) rows.push(candidate)
    }
    if (page.length < pageSize) break
    cursor = page[page.length - 1].id
  }
  return { total, rows }
}

async function assertEvidenceFiles(db: PrismaClient, candidate: Candidate, privateRoot: string): Promise<void> {
  if (new Set(candidate.keys).size !== candidate.keys.length) throw new Error('Duplicate evidence keys found. Run the private media audit before retention.')
  const uploads = await db.mediaUpload.findMany({ where: { storageKey: { in: candidate.keys } } })
  if (uploads.length !== candidate.keys.length || uploads.some(upload => upload.ownerId !== candidate.ownerId || upload.purpose !== purposes[candidate.kind] || upload.status !== 'READY')) {
    throw new Error('Evidence metadata does not match its case. Run the private media audit before retention.')
  }
  const category = candidate.kind === 'student' ? 'verifications' : 'landlord-verifications'
  for (const key of candidate.keys) {
    if (!safeKey.test(key)) throw new Error('Unexpected evidence storage key; retention stopped.')
    const file = await lstat(resolve(privateRoot, category, key)).catch(() => null)
    if (!file?.isFile() || file.isSymbolicLink() || file.size !== uploads.find(upload => upload.storageKey === key)!.size) {
      throw new Error('Referenced evidence is missing or changed. Run the quarantine recovery and private media audit before retention.')
    }
  }
}

export async function planEvidenceRetention(policy: Policy, options: { db?: PrismaClient; now?: Date; limit?: number; privateRoot?: string } = {}) {
  validateRetentionPolicy(policy)
  const db = options.db || defaultDb
  const now = options.now || new Date()
  const limit = options.limit ?? 100
  const privateRoot = resolve(options.privateRoot || process.env.MEDIA_PRIVATE_DIR || './data/private')
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('The per-run limit must be between 1 and 1000.')
  const byKind = {} as Record<Kind, { total: number; rows: Candidate[] }>
  let remaining = limit
  for (const kind of ['student', 'identity', 'property'] as const) {
    byKind[kind] = policy[kind] ? await eligibleCandidates(db, kind, policy[kind], now, remaining) : { total: 0, rows: [] }
    for (const candidate of byKind[kind].rows) await assertEvidenceFiles(db, candidate, privateRoot)
    remaining -= byKind[kind].rows.length
  }
  return { byKind, now, limit }
}

async function lockCase(tx: Prisma.TransactionClient, candidate: Candidate) {
  if (candidate.kind === 'student') await tx.$queryRaw`SELECT id FROM "StudentVerification" WHERE id = ${candidate.id} FOR UPDATE`
  else if (candidate.kind === 'identity') await tx.$queryRaw`SELECT id FROM "LandlordVerification" WHERE id = ${candidate.id} FOR UPDATE`
  else await tx.$queryRaw`SELECT id FROM "PropertyAuthorization" WHERE id = ${candidate.id} FOR UPDATE`
}

async function retireOne(db: PrismaClient, candidate: Candidate, policyVersion: number, actorId: string, now: Date, privateRoot: string): Promise<void> {
  const moved: Array<{ from: string; to: string }> = []
  const holding = resolve(privateRoot, 'retention-quarantine', randomUUID())
  try {
    await db.$transaction(async tx => {
      await lockCase(tx, candidate)
      const fresh = await loadCandidate(tx, candidate.kind, candidate.id)
      if (!fresh || fresh.ownerId !== candidate.ownerId || fresh.keys.join(',') !== candidate.keys.join(',') || !isRetentionEligible(fresh, policyVersion, now)) {
        throw new Error('An evidence record changed during retention. Stop and rerun the dry-run.')
      }
      const uploadRows = await tx.mediaUpload.findMany({ where: { storageKey: { in: fresh.keys } } })
      if (uploadRows.length !== fresh.keys.length || uploadRows.some(upload => upload.ownerId !== fresh.ownerId || upload.purpose !== purposes[fresh.kind] || upload.status !== 'READY')) {
        throw new Error('Evidence metadata does not match its owner or purpose. Run the private media audit before retention.')
      }
      const category = fresh.kind === 'student' ? 'verifications' : 'landlord-verifications'
      await mkdir(holding, { recursive: true, mode: 0o700 })
      for (const key of fresh.keys) {
        if (!safeKey.test(key)) throw new Error('Unexpected evidence storage key; retention stopped.')
        const from = resolve(privateRoot, category, key)
        const to = resolve(holding, key)
        const file = await lstat(from)
        const metadata = uploadRows.find(upload => upload.storageKey === key)!
        if (!file.isFile() || file.isSymbolicLink() || file.size !== metadata.size) throw new Error('Evidence file failed integrity checks; retention stopped.')
        await rename(from, to)
        moved.push({ from, to })
      }
      if (fresh.kind === 'student') await tx.studentVerification.update({ where: { id: fresh.id }, data: { proofKey: null, studentIdKey: null, offerLetterKey: null } })
      else if (fresh.kind === 'identity') await tx.landlordVerification.update({ where: { id: fresh.id }, data: { identityKey: null, companyKey: null, representationKey: null } })
      else await tx.propertyAuthorization.update({ where: { id: fresh.id }, data: { proofKey: null, supportingKey: null } })
      await tx.mediaUpload.deleteMany({ where: { ownerId: fresh.ownerId, purpose: purposes[fresh.kind], storageKey: { in: fresh.keys } } })
      await tx.auditLog.create({ data: {
        actorId, action: 'EVIDENCE_RETENTION_PURGED', targetType: targetTypes[fresh.kind], targetId: fresh.id,
        before: { files: fresh.keys.length }, after: { files: 0, retentionPolicy: fresh.kind === 'student' ? 'offer_end_plus_one_calendar_year' : 'anchor_plus_two_calendar_years', basis: fresh.kind === 'student' ? 'offer_end' : fresh.status === 'APPROVED' ? 'approval_expiry' : fresh.status === 'REVOKED' ? 'revocation' : 'rejection' },
      } })
    }, { timeout: 20_000 })
  } catch (error) {
    const failures: unknown[] = []
    for (const file of moved.reverse()) await rename(file.to, file.from).catch(failure => failures.push(failure))
    if (failures.length) throw new AggregateError([error, ...failures], 'Retention failed and some evidence files could not be restored; inspect the private directory immediately.')
    await rm(holding, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  // A filesystem deletion error after the committed transaction leaves private
  // quarantined files for an operator to reconcile; it never restores a live DB
  // pointer to deleted evidence or exposes them publicly.
  await rm(holding, { recursive: true, force: true })
}

export async function applyEvidenceRetention(policy: Policy, actorId: string, options: { db?: PrismaClient; now?: Date; limit?: number; privateRoot?: string } = {}) {
  const db = options.db || defaultDb
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { status: true, roles: true } })
  if (actor?.status !== 'ACTIVE' || !actor.roles.includes('ADMIN')) throw new Error('An active administrator actor is required for retention audit records.')
  const privateRoot = resolve(options.privateRoot || process.env.MEDIA_PRIVATE_DIR || './data/private')
  const plan = await planEvidenceRetention(policy, { db, now: options.now, limit: options.limit, privateRoot })
  let processed = 0
  const counts: Record<Kind, number> = { student: 0, identity: 0, property: 0 }
  for (const kind of ['student', 'identity', 'property'] as const) {
    for (const candidate of plan.byKind[kind].rows) {
      if (processed >= plan.limit) return { plan, counts, processed }
      await retireOne(db, candidate, policy[kind]!, actorId, plan.now, privateRoot)
      processed += 1
      counts[kind] += 1
    }
  }
  return { plan, counts, processed }
}

/** Restore only quarantined files that the database still references. This is
 * safe after a process crash before the retention transaction committed. Files
 * whose database pointers were already cleared remain quarantined for audit. */
export async function recoverEvidenceQuarantine(options: { db?: PrismaClient; privateRoot?: string; apply?: boolean } = {}) {
  const db = options.db || defaultDb
  const privateRoot = resolve(options.privateRoot || process.env.MEDIA_PRIVATE_DIR || './data/private')
  const quarantineRoot = resolve(privateRoot, 'retention-quarantine')
  const runs = await readdir(quarantineRoot, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  let referenced = 0
  let unreferenced = 0
  let restored = 0
  for (const run of runs) {
    if (!run.isDirectory() || run.isSymbolicLink() || !/^[0-9a-f-]{36}$/.test(run.name)) throw new Error('Unexpected retention quarantine entry; recovery stopped.')
    const files = await readdir(resolve(quarantineRoot, run.name), { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || file.isSymbolicLink() || !safeKey.test(file.name)) throw new Error('Unexpected retention quarantine file; recovery stopped.')
      const upload = await db.mediaUpload.findUnique({ where: { storageKey: file.name } })
      if (!upload) { unreferenced++; continue }
      const kind: Kind | null = upload.purpose === 'VERIFICATION' ? 'student' : upload.purpose === 'LANDLORD_IDENTITY' ? 'identity' : upload.purpose === 'PROPERTY_AUTHORIZATION' ? 'property' : null
      if (!kind) throw new Error('Quarantined file has an unexpected media purpose; recovery stopped.')
      const related = kind === 'student'
        ? await db.studentVerification.count({ where: { userId: upload.ownerId, OR: [{ proofKey: file.name }, { studentIdKey: file.name }, { offerLetterKey: file.name }] } })
        : kind === 'identity'
          ? await db.landlordVerification.count({ where: { userId: upload.ownerId, OR: [{ identityKey: file.name }, { companyKey: file.name }, { representationKey: file.name }] } })
          : await db.propertyAuthorization.count({ where: { requesterId: upload.ownerId, OR: [{ proofKey: file.name }, { supportingKey: file.name }] } })
      if (!related) { unreferenced++; continue }
      const source = resolve(quarantineRoot, run.name, file.name)
      const destination = resolve(privateRoot, kind === 'student' ? 'verifications' : 'landlord-verifications', file.name)
      const sourceStat = await lstat(source)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size !== upload.size) throw new Error('Quarantined evidence failed integrity checks; recovery stopped.')
      const existing = await lstat(destination).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (existing) throw new Error('A destination evidence file already exists; recovery will not overwrite it.')
      referenced++
      if (options.apply) {
        await mkdir(resolve(privateRoot, kind === 'student' ? 'verifications' : 'landlord-verifications'), { recursive: true, mode: 0o700 })
        await rename(source, destination)
        restored++
      }
    }
  }
  return { referenced, unreferenced, restored }
}
