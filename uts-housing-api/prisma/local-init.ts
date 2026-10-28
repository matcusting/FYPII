import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import argon2 from 'argon2'
import { prisma } from '../src/core/db.js'

const ADMIN_EMAIL = 'local-admin@demo.local'
const CAMPUS_ID = '20000000-0000-4000-8000-000000000001'
const CAMPUS_DOMAIN = 'student.uts.edu.my'

const amenities = [
  ['wifi', 'Wi-Fi'], ['air-conditioning', 'Air Conditioning'],
  ['furnished', 'Furnished'], ['laundry', 'Laundry'],
  ['parking', 'Parking'], ['wardrobe', 'Wardrobe'],
  ['refrigerator', 'Refrigerator'], ['water-heater', 'Water Heater'],
  ['private-bathroom', 'Private Bathroom'], ['kitchen-access', 'Kitchen Access'],
  ['study-desk', 'Study Desk'], ['security-cctv', 'Security / CCTV'],
  ['balcony', 'Balcony'],
] as const

class InitializationError extends Error {}

function assertLocalDatabase() {
  if (process.env.NODE_ENV === 'production') throw new InitializationError('This initializer is only for a local development database.')
  if (!process.env.DATABASE_URL) throw new InitializationError('DATABASE_URL is required. Copy .env.example to .env first.')
  let hostname: string
  try { hostname = new URL(process.env.DATABASE_URL).hostname }
  catch { throw new InitializationError('DATABASE_URL must be a valid PostgreSQL URL.') }
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(hostname)) {
    throw new InitializationError('This initializer accepts only a local PostgreSQL host.')
  }
}

export async function initializeLocalDatabase(keepDemoAdmin = false) {
  assertLocalDatabase()
  const password = randomBytes(24).toString('base64url')
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(781424105)::text`
    const existing = await tx.user.findUnique({ where: { email: ADMIN_EMAIL } })
    if (existing && (!existing.roles.includes('ADMIN') || existing.status !== 'ACTIVE')) {
      throw new InitializationError('The local administrator address already belongs to an inactive or non-admin account. Resolve it manually; this command will not change its role or password.')
    }
    const admin = existing || await tx.user.create({ data: {
      name: 'Local Administrator', email: ADMIN_EMAIL, passwordHash,
      roles: ['ADMIN'], status: 'ACTIVE', emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Local Administrator' } },
      notificationPreference: { create: {} },
    } })
    const campus = await tx.campus.upsert({
      where: { id: CAMPUS_ID }, update: {},
      create: {
        id: CAMPUS_ID, name: 'UTS Sibu Campus (Local)',
        university: 'University of Technology Sarawak',
        latitude: 2.322, longitude: 111.839,
        domains: [CAMPUS_DOMAIN], active: true,
      },
    })
    for (const [slug, name] of amenities) {
      await tx.amenity.upsert({ where: { slug }, update: {}, create: { slug, name } })
    }
    const demoAdmin = await tx.user.findUnique({ where: { email: 'admin@demo.local' }, select: { id: true, roles: true, status: true } })
    const demoAdminActive = demoAdmin?.status === 'ACTIVE' && demoAdmin.roles.includes('ADMIN')
    if (demoAdminActive && !keepDemoAdmin) {
      await tx.user.update({ where: { id: demoAdmin.id }, data: { status: 'SUSPENDED' } })
      await tx.session.updateMany({ where: { userId: demoAdmin.id, revokedAt: null }, data: { revokedAt: new Date() } })
      await tx.auditLog.create({ data: {
        actorId: admin.id, action: 'LOCAL_DEMO_ADMIN_SUSPENDED', targetType: 'ACCOUNT', targetId: demoAdmin.id,
        before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED', reason: 'Local initialization disabled the publicly documented demo administrator.' },
      } })
    }
    return {
      created: !existing,
      adminEmail: admin.email,
      campusReady: campus.active && campus.domains.some(domain => domain.trim().toLowerCase() === CAMPUS_DOMAIN),
      demoAdminSuspended: demoAdminActive && !keepDemoAdmin,
      demoAdminActive: demoAdminActive && keepDemoAdmin,
    }
  })
  if (result.created) {
    process.stdout.write(`Local administrator created.\nEmail: ${result.adminEmail}\nPassword (shown only now): ${password}\nSave this password privately before closing this window.\n`)
  } else {
    process.stdout.write(`Local administrator already exists: ${result.adminEmail}. Password unchanged and not shown again.\n`)
  }
  if (!result.campusReady) process.stderr.write('The existing UTS campus is inactive or lacks student.uts.edu.my. Configure it in the administrator portal before student registration.\n')
  if (result.demoAdminSuspended) process.stdout.write('The publicly documented demo administrator was suspended and its sessions were revoked.\n')
  if (result.demoAdminActive) process.stderr.write('WARNING: admin@demo.local remains active for demo use. Upload only fictional documents in this mode.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argumentsPassed = process.argv.slice(2)
  const unknownArgument = argumentsPassed.find(value => value !== '--keep-demo-admin')
  const work = unknownArgument ? Promise.reject(new InitializationError(`Unknown option: ${unknownArgument}`)) : initializeLocalDatabase(argumentsPassed.includes('--keep-demo-admin'))
  work
    .catch(error => {
      process.stderr.write(`${error instanceof InitializationError ? error.message : 'Local database initialization failed. Check the database connection and migrations.'}\n`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
