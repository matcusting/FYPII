import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import argon2 from 'argon2'
import sharp from 'sharp'
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
  landlordVerification: '60000000-0000-4000-8000-000000000001',
  identityKey: '60000000-0000-4000-8000-000000000002.png',
  propertyAuthorization: '70000000-0000-4000-8000-000000000001',
  authorityKey: '70000000-0000-4000-8000-000000000002.png',
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
      update: person.studentVerified ? { studentVerified: true, studentVerifiedUntil: new Date('2099-12-31T00:00:00.000Z'), verificationStatus: 'APPROVED' } : {},
      create: {
        id: person.id,
        name: person.name,
        email: person.email,
        passwordHash,
        roles: [person.role],
        emailVerifiedAt: now,
        studentVerified: person.studentVerified,
        studentVerifiedUntil: person.studentVerified ? new Date('2099-12-31T00:00:00.000Z') : null,
        verificationStatus: person.studentVerified ? 'APPROVED' : 'UNVERIFIED',
      },
    })
    await prisma.profile.upsert({
      where: { userId: person.id },
      update: {},
      create: { userId: person.id, displayName: person.name, phone: person.role === 'LANDLORD' ? '+60 00-000 0000' : null, university: person.role === 'STUDENT' ? 'University of Technology Sarawak' : null },
    })
    await prisma.notificationPreference.upsert({
      where: { userId: person.id }, update: {}, create: { userId: person.id },
    })
  }
  // Older local demo databases may predate the landlord-phone requirement.
  // Fill only this fictional account's missing number; keep any entered value.
  await prisma.profile.updateMany({ where: { userId: ids.landlord, phone: null }, data: { phone: '+60 00-000 0000' } })

  await prisma.campus.upsert({
    where: { id: ids.campus },
    update: {},
    create: {
      id: ids.campus,
      name: 'UTS Sibu Campus (Demo Coordinates)',
      university: 'University of Technology Sarawak',
      latitude: 2.322,
      longitude: 111.839,
      domains: ['student.uts.edu.my'],
    },
  })
  const demoCampus = await prisma.campus.findUniqueOrThrow({ where: { id: ids.campus }, select: { domains: true } })
  const configuredDomains = demoCampus.domains.map(domain => domain.trim().toLowerCase())
  const legacyDemoDomains = configuredDomains.every(domain => domain === 'uts.edu.my' || domain === 'student.uts.edu.my')
  if (legacyDemoDomains && (configuredDomains.length !== 1 || configuredDomains[0] !== 'student.uts.edu.my')) {
    await prisma.campus.update({ where: { id: ids.campus }, data: { domains: ['student.uts.edu.my'] } })
  } else if (!configuredDomains.includes('student.uts.edu.my')) {
    await prisma.campus.update({ where: { id: ids.campus }, data: { domains: [...demoCampus.domains, 'student.uts.edu.my'] } })
  }
  for (const amenity of [
    { slug: 'wifi', name: 'Wi-Fi' },
    { slug: 'air-conditioning', name: 'Air Conditioning' },
    { slug: 'furnished', name: 'Furnished' },
    { slug: 'laundry', name: 'Laundry' },
    { slug: 'parking', name: 'Parking' },
    { slug: 'wardrobe', name: 'Wardrobe' },
    { slug: 'refrigerator', name: 'Refrigerator' },
    { slug: 'water-heater', name: 'Water Heater' },
    { slug: 'private-bathroom', name: 'Private Bathroom' },
    { slug: 'kitchen-access', name: 'Kitchen Access' },
    { slug: 'study-desk', name: 'Study Desk' },
    { slug: 'security-cctv', name: 'Security / CCTV' },
    { slug: 'balcony', name: 'Balcony' },
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
      address: '12 Demo Road, Sibu Jaya, 96000 Sibu, Sarawak',
      showExactLocation: false,
      furnished: true,
      status: 'PAUSED',
      moderationReason: 'Identity and property authority review required.',
      lastConfirmedAt: now,
      photos: { create: { id: ids.photo, storageKey: ids.photoKey, mimeType: 'image/png' } },
      amenities: { create: [
        { amenity: { connect: { slug: 'wifi' } } },
        { amenity: { connect: { slug: 'furnished' } } },
      ] },
    },
  })
  await prisma.listing.updateMany({
    where: { id: ids.listing, address: null },
    data: { address: '12 Demo Road, Sibu Jaya, 96000 Sibu, Sarawak', latitude: null, longitude: null },
  })

  // These are generated generic local fixtures, never a real person's documents.
  // Create the sample reviews only once. A later rejection or new application must
  // not be undone merely because a developer runs the seed script again.
  const landlordDirectory = resolve(process.env.MEDIA_PRIVATE_DIR || './data/private', 'landlord-verifications')
  await mkdir(landlordDirectory, { recursive: true, mode: 0o700 })
  const makeDemoProof = async (label: string) => sharp(Buffer.from(
    `<svg width="960" height="540" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="540" fill="#edf2fa"/><text x="60" y="170" fill="#162b59" font-family="Arial" font-size="44">SYNTHETIC DEMO ONLY</text><text x="60" y="260" fill="#162b59" font-family="Arial" font-size="30">${label}</text><text x="60" y="340" fill="#5b6475" font-family="Arial" font-size="24">Not an identity or ownership document</text></svg>`,
  )).png().toBuffer()
  const existingIdentity = await prisma.landlordVerification.findUnique({ where: { id: ids.landlordVerification } })
  const existingAuthorization = await prisma.propertyAuthorization.findUnique({ where: { id: ids.propertyAuthorization } })
  for (const item of [
    { key: ids.identityKey, purpose: 'LANDLORD_IDENTITY', label: 'Placeholder identity evidence', needed: !existingIdentity },
    { key: ids.authorityKey, purpose: 'PROPERTY_AUTHORIZATION', label: 'Placeholder rental authority evidence', needed: !existingAuthorization },
  ]) {
    if (!item.needed) continue
    const bytes = await makeDemoProof(item.label)
    await writeFile(resolve(landlordDirectory, item.key), bytes, { mode: 0o600 })
    await prisma.mediaUpload.upsert({
      where: { storageKey: item.key },
      update: { size: bytes.length, mimeType: 'image/png', purpose: item.purpose, status: 'READY' },
      create: { ownerId: ids.landlord, storageKey: item.key, mimeType: 'image/png', size: bytes.length, purpose: item.purpose, status: 'READY' },
    })
  }
  await prisma.landlordVerification.upsert({
    where: { id: ids.landlordVerification },
    update: {},
    create: { id: ids.landlordVerification, userId: ids.landlord, kind: 'INDIVIDUAL', identityKey: ids.identityKey, status: 'APPROVED', reviewedById: ids.admin, reviewedAt: now, expiresAt: new Date(now.getTime() + 365 * 86_400_000) },
  })
  await prisma.propertyAuthorization.upsert({
    where: { id: ids.propertyAuthorization },
    update: {},
    create: { id: ids.propertyAuthorization, listingId: ids.listing, requesterId: ids.landlord, kind: 'OWNER', proofKey: ids.authorityKey, addressSnapshot: '12 Demo Road, Sibu Jaya, 96000 Sibu, Sarawak', status: 'APPROVED', reviewedById: ids.admin, reviewedAt: now, expiresAt: new Date(now.getTime() + 180 * 86_400_000) },
  })
  // The fictional fixture can be renewed after a migration expires historical
  // approvals. Never alter a rejected or revoked review.
  await prisma.landlordVerification.updateMany({ where: { id: ids.landlordVerification, status: 'APPROVED', expiresAt: { lte: now } }, data: { expiresAt: new Date(now.getTime() + 365 * 86_400_000) } })
  await prisma.propertyAuthorization.updateMany({ where: { id: ids.propertyAuthorization, status: 'APPROVED', expiresAt: { lte: now } }, data: { expiresAt: new Date(now.getTime() + 180 * 86_400_000) } })
  const [demoOwner, demoListing, latestIdentity, latestAuthorization] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ids.landlord }, include: { profile: true } }),
    prisma.listing.findUniqueOrThrow({ where: { id: ids.listing } }),
    prisma.landlordVerification.findFirst({ where: { userId: ids.landlord }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.propertyAuthorization.findFirst({ where: { listingId: ids.listing }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
  ])
  const mayPublishDemo = demoOwner.status === 'ACTIVE' && demoOwner.emailVerifiedAt && demoOwner.profile?.phone &&
    latestIdentity?.status === 'APPROVED' && latestAuthorization?.status === 'APPROVED' &&
    latestAuthorization.requesterId === demoOwner.id && latestAuthorization.addressSnapshot === demoListing.address
  // Only lift the one-time pause caused by the migration when these fictional
  // reviews have just been created. Never override a later administrator pause.
  const newlyReviewedSample = !existingIdentity || !existingAuthorization
  if (mayPublishDemo && newlyReviewedSample && demoListing.status === 'PAUSED' && demoListing.moderationReason === 'Identity and property authority review required.') {
    await prisma.listing.update({ where: { id: ids.listing }, data: { status: 'PUBLISHED', moderationReason: null, reviewedAt: now } })
  } else if (!mayPublishDemo && demoListing.status === 'PUBLISHED') {
    await prisma.listing.update({ where: { id: ids.listing }, data: { status: 'PAUSED', moderationReason: 'Identity and property authority review required.', reviewedAt: null } })
  }

  process.stdout.write('Seeded local fictional demo accounts, campus, amenities and one sample listing.\n')
  process.stdout.write('Accounts: admin@demo.local, landlord@demo.local, student@demo.local, candidate@demo.local\n')
  process.stdout.write('Use SEED_DEMO_PASSWORD or the local default password documented in the developer guide.\n')
} finally {
  await prisma.$disconnect()
}
