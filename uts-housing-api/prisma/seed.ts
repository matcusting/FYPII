import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import argon2 from 'argon2'
import { prisma } from '../src/core/db.js'

if (process.env.NODE_ENV === 'production' || process.env.CONFIRM_DEMO_SEED !== '1') {
  throw new Error('Demo seed is local-only. Set CONFIRM_DEMO_SEED=1 in a non-production environment to continue.')
}
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Demo seed only accepts a local PostgreSQL host.')
}
const password = process.env.SEED_DEMO_PASSWORD || 'Demo12345!'
if (password.length < 8) throw new Error('SEED_DEMO_PASSWORD must contain at least eight characters.')
const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  landlord: '10000000-0000-4000-8000-000000000002',
  student: '10000000-0000-4000-8000-000000000003',
  candidate: '10000000-0000-4000-8000-000000000004',
  campus: '20000000-0000-4000-8000-000000000001',
  listing: '30000000-0000-4000-8000-000000000001',
  photo: '40000000-0000-4000-8000-000000000001',
  photoKey: '50000000-0000-4000-8000-000000000001',
} as const

try {
  const now = new Date()
  for (const person of [
    { id: ids.admin, name: 'Demo Administrator', email: 'admin@demo.local', role: 'ADMIN' as const, studentVerified: false },
    { id: ids.landlord, name: 'Demo Landlord', email: 'landlord@demo.local', role: 'LANDLORD' as const, studentVerified: false },
    { id: ids.student, name: 'Demo Student', email: 'student@demo.local', role: 'STUDENT' as const, studentVerified: true },
    { id: ids.candidate, name: 'Demo Roommate', email: 'candidate@demo.local', role: 'STUDENT' as const, studentVerified: true },
  ]) {
    await prisma.user.upsert({
      where: { email: person.email },
      update: {},
      create: {
        id: person.id,
        name: person.name,
        email: person.email,
        passwordHash,
        roles: [person.role],
        emailVerifiedAt: now,
        studentVerified: person.studentVerified,
        verificationStatus: person.studentVerified ? 'APPROVED' : 'UNVERIFIED',
      },
    })
    await prisma.profile.upsert({
      where: { userId: person.id },
      update: {},
      create: { userId: person.id, displayName: person.name, university: person.role === 'STUDENT' ? 'University of Technology Sarawak' : null },
    })
    await prisma.notificationPreference.upsert({
      where: { userId: person.id }, update: {}, create: { userId: person.id },
    })
  }

  await prisma.campus.upsert({
    where: { id: ids.campus },
    update: {},
    create: {
      id: ids.campus,
      name: 'UTS Sibu Campus (Demo Coordinates)',
      university: 'University of Technology Sarawak',
      latitude: 2.322,
      longitude: 111.839,
      domains: ['uts.edu.my'],
    },
  })
  for (const amenity of [
    { slug: 'wifi', name: 'Wi-Fi' },
    { slug: 'air-conditioning', name: 'Air Conditioning' },
    { slug: 'furnished', name: 'Furnished' },
    { slug: 'laundry', name: 'Laundry' },
    { slug: 'parking', name: 'Parking' },
  ]) {
    await prisma.amenity.upsert({ where: { slug: amenity.slug }, update: {}, create: amenity })
  }

  const lifestyle = {
    smoking: 'NEVER', studySchedule: 'EVENING', sleepSchedule: 'LATE',
    cleanliness: 'MODERATE', noise: 'QUIET', guests: 'SOMETIMES', pets: 'NO_PETS',
  }
  for (const person of [
    { id: ids.student, name: 'Demo Student', location: 'Sibu Jaya' },
    { id: ids.candidate, name: 'Demo Roommate', location: 'Sibu Jaya' },
  ]) {
    await prisma.roommateProfile.upsert({
      where: { userId: person.id },
      update: {},
      create: {
        userId: person.id,
        displayName: person.name,
        university: 'University of Technology Sarawak',
        preferredLocation: person.location,
        budgetMin: 500,
        budgetMax: 900,
        discoverable: true,
        lifestyle,
        roommatePreferences: lifestyle,
        importanceWeights: { smoking: 1, studySchedule: 1, sleepSchedule: 1, cleanliness: 1, noise: 1, guests: 1, pets: 1 },
        visibility: { university: true, preferredLocation: true, budget: true, lifestyle: true },
        smokeFreeOnly: true,
      },
    })
  }

  // A synthetic photo and clearly fictional listing make local search and moderation easy to try.
  const seedImage = fileURLToPath(new URL('./seed-assets/demo-room.png', import.meta.url))
  const privateDirectory = resolve(process.env.MEDIA_PRIVATE_DIR || process.env.UPLOAD_DIR || './uploads', 'listings')
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 })
  const imageBytes = await readFile(seedImage)
  await copyFile(seedImage, resolve(privateDirectory, ids.photoKey))
  await writeFile(resolve(privateDirectory, `${ids.photoKey}.json`), JSON.stringify({
    key: ids.photoKey,
    ownerId: ids.landlord,
    mimeType: 'image/png',
    size: imageBytes.length,
    purpose: 'LISTING_PHOTO',
    uploadedAt: now.toISOString(),
  }))
  await prisma.mediaUpload.upsert({
    where: { storageKey: ids.photoKey },
    update: {},
    create: { ownerId: ids.landlord, storageKey: ids.photoKey, mimeType: 'image/png', size: imageBytes.length, purpose: 'LISTING_PHOTO', status: 'UPLOADED' },
  })

  const availableFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  await prisma.listing.upsert({
    where: { id: ids.listing },
    update: {},
    create: {
      id: ids.listing,
      ownerId: ids.landlord,
      campusId: ids.campus,
      title: 'Fictional demo room near UTS',
      description: 'This is a fictional demonstration property for testing the UTS Housing website. It is not a real room and must not be used to arrange a rental.',
      propertyType: 'APARTMENT',
      roomType: 'SINGLE',
      rent: 680,
      deposit: 680,
      availableFrom,
      approximateArea: 'Fictional Sibu Jaya demo area',
      latitude: 2.329,
      longitude: 111.845,
      showExactLocation: false,
      furnished: true,
      status: 'PUBLISHED',
      lastConfirmedAt: now,
      photos: { create: { id: ids.photo, storageKey: ids.photoKey, mimeType: 'image/png' } },
      amenities: { create: [
        { amenity: { connect: { slug: 'wifi' } } },
        { amenity: { connect: { slug: 'furnished' } } },
      ] },
    },
  })

  process.stdout.write('Seeded local fictional demo accounts, campus, amenities and one sample listing.\n')
  process.stdout.write('Accounts: admin@demo.local, landlord@demo.local, student@demo.local, candidate@demo.local\n')
  process.stdout.write('Use SEED_DEMO_PASSWORD or the local default password documented in the developer guide.\n')
} finally {
  await prisma.$disconnect()
}
