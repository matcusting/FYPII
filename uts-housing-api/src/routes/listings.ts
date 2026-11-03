import { Prisma, type User } from '@prisma/client'
import { Router, raw, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../core/db.js'
import { currentUser, requireAuth } from '../core/auth.js'
import { fail, ok } from '../core/http.js'
import { approvalIsCurrent, publicListingWhere } from '../core/approval.js'
import { geocodeAddress } from '../core/geocode.js'
import { createUploadTicket, isAllowedUploadType, listingUploadMetadata, readListingUpload, readUpload, saveUpload, type UploadPurpose } from '../storage/listings.js'

const router = Router()
const locationRetryAt = new Map<string, number>()

const withErrors = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
  void handler(req, res).catch(next)
}
const isAdmin = (user: User | null) => !!user?.roles.includes('ADMIN')
const mayPost = (user: User | null) => !!user && user.roles.some(role => role === 'STUDENT' || role === 'LANDLORD' || role === 'ADMIN')
const queryText = (req: Request, name: string) => typeof req.query[name] === 'string' ? String(req.query[name]).trim() : ''
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value)
const money = z.union([z.string(), z.number()]).transform(value => Number(value)).pipe(z.number().finite().min(0).max(9_999_999))
const fullAddress = z.string().trim().min(10).max(250)

export const listingInput = z.object({
  title: z.string().trim().min(8).max(120),
  description: z.string().trim().min(30).max(5000),
  campusId: z.string().min(1),
  propertyType: z.enum(['APARTMENT', 'HOUSE', 'STUDIO', 'OTHER']),
  roomType: z.enum(['SINGLE', 'SHARED', 'MASTER', 'ENTIRE']),
  rent: money.refine(value => value > 0),
  deposit: money,
  currency: z.literal('MYR').default('MYR'),
  availableFrom: isoDate,
  approximateArea: z.string().trim().min(3).max(120),
  houseRules: z.string().trim().max(2000).optional(),
  contactMethod: z.literal('IN_APP').default('IN_APP'),
  furnished: z.boolean().default(false),
  amenityIds: z.array(z.string().min(1)).max(30).default([]),
  photoKeys: z.array(z.uuid()).max(8).default([]),
  address: fullAddress,
  showExactLocation: z.boolean().default(false),
})

const listingPatch = listingInput.omit({ photoKeys: true }).partial().extend({
  newPhotoKeys: z.array(z.uuid()).max(8).optional(),
  removePhotoIds: z.array(z.uuid()).max(8).optional(),
  status: z.enum(['PAUSED', 'PUBLISHED', 'RENTED']).optional(),
})

const listingInclude = {
  owner: { select: { id: true, name: true } },
  campus: { select: { id: true, name: true, university: true } },
  photos: { orderBy: { sortOrder: 'asc' as const } },
  amenities: { include: { amenity: true } },
  reviews: { where: { status: 'APPROVED' as const, active: true }, select: { rating: true } },
} satisfies Prisma.ListingInclude

type ListingRecord = Prisma.ListingGetPayload<{ include: typeof listingInclude }>

export function canViewExactLocation(ownerId: string, showExactLocation: boolean, user: Pick<User, 'id' | 'roles'> | null) {
  return !!user && (user.id === ownerId || user.roles.includes('ADMIN') || (showExactLocation && user.roles.includes('STUDENT')))
}

export function serializeListing(record: ListingRecord, user: User | null) {
  const privateAccess = !!user && (record.ownerId === user.id || isAdmin(user))
  const exactLocationVisible = canViewExactLocation(record.ownerId, record.showExactLocation, user)
  const { latitude, longitude, address, moderationReason, ...safe } = record
  const rating = record.reviews.length ? Number((record.reviews.reduce((sum, review) => sum + review.rating, 0) / record.reviews.length).toFixed(1)) : undefined
  return {
    ...safe,
    rent: Number(record.rent),
    deposit: Number(record.deposit),
    availableFrom: record.availableFrom.toISOString().slice(0, 10),
    lastConfirmedAt: record.lastConfirmedAt?.toISOString() || null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    campusName: record.campus.name,
    campus: { id: record.campus.id, name: record.campus.name, university: record.campus.university },
    amenities: record.amenities.map(item => item.amenity.name),
    amenityIds: record.amenities.map(item => item.amenityId),
    photos: record.photos.map(photo => ({ id: photo.id, objectKey: photo.storageKey, url: photo.url || `/api/v1/media/${photo.storageKey}`, alt: `${record.title} property photo` })),
    reviews: undefined,
    rating,
    reviewCount: record.reviews.length,
    availabilityStale: !record.lastConfirmedAt || Date.now() - record.lastConfirmedAt.getTime() > 30 * 24 * 60 * 60 * 1000,
    rejectionReason: privateAccess ? moderationReason : undefined,
    showExactLocation: privateAccess ? record.showExactLocation : exactLocationVisible,
    address: exactLocationVisible ? address : undefined,
  }
}

function hasFullAddress(address: string | null | undefined) {
  return fullAddress.safeParse(address).success
}

async function publishClearance(db: Prisma.TransactionClient, owner: User, listing: { id: string; address: string | null }) {
  if (owner.status !== 'ACTIVE' || !owner.emailVerifiedAt) return 'ACCOUNT_VERIFICATION_REQUIRED'
  if (owner.roles.includes('LANDLORD')) {
    const identity = await db.landlordVerification.findFirst({ where: { userId: owner.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    if (!approvalIsCurrent(identity)) return 'LANDLORD_IDENTITY_REQUIRED'
  } else if (!owner.roles.includes('STUDENT') || !owner.studentVerified) return 'STUDENT_VERIFICATION_REQUIRED'
  const authorization = await db.propertyAuthorization.findFirst({ where: { listingId: listing.id, requesterId: owner.id, addressSnapshot: listing.address || '' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return approvalIsCurrent(authorization) ? null : 'PROPERTY_AUTHORIZATION_REQUIRED'
}

async function submitForReview(listingId: string, ownerId: string, allowed: Array<'DRAFT' | 'REJECTED' | 'RENTED' | 'PAUSED'>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))::text`
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${listingId}))::text`
    const [owner, listing] = await Promise.all([
      tx.user.findUnique({ where: { id: ownerId } }),
      tx.listing.findUnique({ where: { id: listingId }, include: { _count: { select: { photos: true } } } }),
    ])
    if (!owner || !listing || listing.ownerId !== ownerId) return 'NOT_FOUND' as const
    if (!allowed.includes(listing.status as typeof allowed[number]) || listing._count.photos < 1) return 'INVALID_STATUS' as const
    if (!hasFullAddress(listing.address)) return 'ADDRESS_REQUIRED' as const
    const clearance = await publishClearance(tx, owner, listing)
    if (clearance) return clearance
    await tx.listing.update({ where: { id: listing.id }, data: { status: 'PENDING_REVIEW', moderationReason: null, reviewedAt: null, lastConfirmedAt: new Date() } })
    return null
  })
}

function submitError(res: Response, code: string) {
  if (code === 'NOT_FOUND') return fail(res, 404, 'This property could not be found.', code)
  if (code === 'INVALID_STATUS') return fail(res, 409, 'Add at least one photo to an eligible draft before submitting.', code)
  if (code === 'ADDRESS_REQUIRED') return fail(res, 400, 'Enter the full property address before publishing.', code)
  return fail(res, 403, code === 'LANDLORD_IDENTITY_REQUIRED' ? 'Approve your landlord identity before submitting a listing.' : code === 'PROPERTY_AUTHORIZATION_REQUIRED' ? 'Approve property authorization before submitting a listing.' : 'Verify your account before submitting a listing.', code)
}

async function validAmenities(ids: string[]) {
  if (ids.length !== new Set(ids).size) return false
  if (!ids.length) return true
  return await prisma.amenity.count({ where: { id: { in: ids } } }) === ids.length
}

async function validPhotoUploads(keys: string[], ownerId: string) {
  if (keys.length !== new Set(keys).size) return null
  if (!keys.length) return []
  const uploads = await prisma.mediaUpload.findMany({ where: { storageKey: { in: keys }, ownerId, purpose: 'LISTING_PHOTO', status: 'UPLOADED' } })
  if (uploads.length !== keys.length) return null
  const linked = await prisma.listingPhoto.count({ where: { storageKey: { in: keys } } })
  if (linked) return null
  for (const key of keys) if (!await listingUploadMetadata(key)) return null
  return keys.map(key => ({ key, mimeType: uploads.find(upload => upload.storageKey === key)?.mimeType || 'image/jpeg' }))
}

function failValidation(res: Response, issue = 'Please check the listing details and try again.') {
  fail(res, 400, issue, 'VALIDATION_ERROR')
}

router.get('/campuses', withErrors(async (_req, res) => {
  const items = await prisma.campus.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
  ok(res, { items: items.map(({ id, name, university }) => ({ id, name, university })) })
}))

router.get('/amenities', withErrors(async (_req, res) => {
  ok(res, { items: await prisma.amenity.findMany({ orderBy: { name: 'asc' } }) })
}))

router.post('/uploads/sign', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  if (!mayPost(user)) { fail(res, 403, 'This account cannot upload property files.', 'FORBIDDEN'); return }
  const request = z.object({ fileName: z.string().min(1).max(255), contentType: z.string(), size: z.number().int(), purpose: z.enum(['LISTING_PHOTO', 'REVIEW_EVIDENCE']).default('LISTING_PHOTO') }).safeParse(req.body)
  if (!request.success || !isAllowedUploadType(request.data.purpose as UploadPurpose, request.data.contentType, request.data.size)) { failValidation(res, 'Choose an allowed file under 5 MB.'); return }
  if (request.data.purpose === 'REVIEW_EVIDENCE' && (!user.roles.includes('STUDENT') || !user.studentVerified)) { fail(res, 403, 'Only verified students can upload rental experience proof.', 'FORBIDDEN'); return }
  const ticket = createUploadTicket(user.id, request.data.contentType, request.data.size, request.data.purpose)
  await prisma.mediaUpload.create({ data: { ownerId: user.id, storageKey: ticket.objectKey, mimeType: request.data.contentType, size: request.data.size, purpose: request.data.purpose, status: 'PENDING' } })
  ok(res, ticket, 201)
}))

router.put('/uploads/:objectKey', requireAuth, raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: '6mb' }), withErrors(async (req, res) => {
  const user = currentUser(req)!
  const objectKey = req.params.objectKey
  const row = await prisma.mediaUpload.findUnique({ where: { storageKey: objectKey } })
  if (!row || row.ownerId !== user.id || row.status !== 'PENDING') { fail(res, 404, 'This upload link is unavailable.', 'NOT_FOUND'); return }
  const mimeType = queryText(req, 'type')
  const purpose = queryText(req, 'purpose')
  const declaredSize = Number(queryText(req, 'size'))
  const expires = Number(queryText(req, 'expires'))
  const sig = queryText(req, 'sig')
  if (mimeType !== row.mimeType || purpose !== row.purpose || declaredSize !== row.size || req.get('content-type')?.split(';')[0] !== row.mimeType || !Buffer.isBuffer(req.body)) { failValidation(res, 'The uploaded file does not match its upload link.'); return }
  try {
    await saveUpload({ objectKey, ownerId: user.id, mimeType, declaredSize, expires, sig, purpose: purpose as UploadPurpose, bytes: req.body as Buffer })
  } catch (error) {
    failValidation(res, error instanceof Error ? error.message : 'The upload failed validation.')
    return
  }
  await prisma.mediaUpload.update({ where: { storageKey: objectKey }, data: { status: 'UPLOADED' } })
  ok(res, { uploaded: true })
}))

router.get('/media/:objectKey', withErrors(async (req, res) => {
  const photo = await prisma.listingPhoto.findFirst({ where: { storageKey: req.params.objectKey }, include: { listing: { select: { status: true, ownerId: true } } } })
  const user = currentUser(req)
  if (!photo || (photo.listing.status !== 'PUBLISHED' && photo.listing.ownerId !== user?.id && !isAdmin(user))) { fail(res, 404, 'This photo is unavailable.', 'NOT_FOUND'); return }
  if (photo.listing.ownerId !== user?.id && !isAdmin(user) && !await prisma.listing.count({ where: { id: photo.listingId, ...publicListingWhere() } })) { fail(res, 404, 'This photo is unavailable.', 'NOT_FOUND'); return }
  const uploaded = await readListingUpload(photo.storageKey)
  if (!uploaded) { fail(res, 404, 'This photo is unavailable.', 'NOT_FOUND'); return }
  res.setHeader('Content-Type', uploaded.mimeType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(uploaded.bytes)
}))

router.get('/private-media/:objectKey', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const upload = await prisma.mediaUpload.findUnique({ where: { storageKey: req.params.objectKey } })
  if (!upload || upload.purpose !== 'REVIEW_EVIDENCE' || upload.status !== 'UPLOADED' || (upload.ownerId !== user.id && !isAdmin(user))) { fail(res, 404, 'This proof is unavailable.', 'NOT_FOUND'); return }
  const stored = await readUpload(upload.storageKey)
  if (!stored || stored.purpose !== 'REVIEW_EVIDENCE') { fail(res, 404, 'This proof is unavailable.', 'NOT_FOUND'); return }
  res.setHeader('Content-Type', stored.mimeType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="proof-${upload.id}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(stored.bytes)
}))

router.get('/listings', withErrors(async (req, res) => {
  const user = currentUser(req)
  const mine = queryText(req, 'mine') === 'true'
  if (mine && !user) { fail(res, 401, 'Sign in to see your listings.', 'UNAUTHORIZED'); return }
  const page = Number(queryText(req, 'page') || 1)
  const limit = Number(queryText(req, 'limit') || 12)
  if (!Number.isInteger(page) || page < 1 || page > 10_000 || !Number.isInteger(limit) || limit < 1 || limit > 100) { failValidation(res, 'Use a valid page and page size.'); return }
  const maxDistanceText = queryText(req, 'maxDistanceKm')
  const maxDistanceKm = maxDistanceText ? Number(maxDistanceText) : null
  if (maxDistanceKm != null && (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0 || maxDistanceKm > 20000)) { failValidation(res, 'Enter a maximum campus distance between 0 and 20000 km.'); return }
  const numericFilters = ['minRent', 'maxRent', 'minDeposit', 'maxDeposit'] as const
  const numbers = Object.fromEntries(numericFilters.map(name => [name, queryText(req, name) ? Number(queryText(req, name)) : null])) as Record<(typeof numericFilters)[number], number | null>
  if (numericFilters.some(name => numbers[name] != null && (!Number.isFinite(numbers[name]) || numbers[name]! < 0 || numbers[name]! > 9_999_999)) ||
    (numbers.minRent != null && numbers.maxRent != null && numbers.minRent > numbers.maxRent) ||
    (numbers.minDeposit != null && numbers.maxDeposit != null && numbers.minDeposit > numbers.maxDeposit)) { failValidation(res, 'Use valid price ranges.'); return }
  const availableBy = queryText(req, 'availableBy')
  if (availableBy && !isoDate.safeParse(availableBy).success) { failValidation(res, 'Enter a valid available-by date as YYYY-MM-DD.'); return }
  const sort = queryText(req, 'sort') || 'newest'
  if (!['newest', 'rent_asc', 'rent_desc', 'distance'].includes(sort)) { failValidation(res, 'Choose a valid sort order.'); return }
  const campusId = queryText(req, 'campusId')
  const campus = campusId ? await prisma.campus.findUnique({ where: { id: campusId } }) : null
  if (campusId && (!campus || !campus.active)) { ok(res, { items: [], total: 0, page, pages: 1, limit }); return }
  const terms = queryText(req, 'amenities').toLowerCase().split(',').map(term => term.trim()).filter(Boolean)
  const search = queryText(req, 'q')
  const area = queryText(req, 'area')
  const university = queryText(req, 'university')
  const propertyType = queryText(req, 'propertyType')
  const roomType = queryText(req, 'roomType')
  const furnished = queryText(req, 'furnished')
  const recentlyConfirmed = queryText(req, 'recentlyConfirmed')
  if (search.length > 200 || area.length > 120 || university.length > 120 || campusId.length > 100 || terms.length > 20 || terms.some(term => term.length > 60) ||
    (propertyType && !['APARTMENT', 'HOUSE', 'STUDIO', 'OTHER'].includes(propertyType)) ||
    (roomType && !['SINGLE', 'SHARED', 'MASTER', 'ENTIRE'].includes(roomType))) { failValidation(res, 'Check the search terms and property filters.'); return }
  if (furnished && !['true', 'false'].includes(furnished)) { failValidation(res, 'Choose a valid furnishing filter.'); return }
  if (recentlyConfirmed && recentlyConfirmed !== 'true') { failValidation(res, 'Choose a valid availability confirmation filter.'); return }
  const filters: Prisma.ListingWhereInput[] = []
  if (search) filters.push({ OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] })
  if (area) filters.push({ approximateArea: { contains: area, mode: 'insensitive' } })
  if (university) filters.push({ campus: { university: { contains: university, mode: 'insensitive' } } })
  if (campusId) filters.push({ campusId })
  if (maxDistanceKm != null) filters.push({ distanceKm: { lte: maxDistanceKm } })
  if (propertyType) filters.push({ propertyType })
  if (roomType) filters.push({ roomType })
  if (furnished) filters.push({ furnished: furnished === 'true' })
  if (recentlyConfirmed === 'true') filters.push({ lastConfirmedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } })
  if (numbers.minRent != null) filters.push({ rent: { gte: numbers.minRent } })
  if (numbers.maxRent != null) filters.push({ rent: { lte: numbers.maxRent } })
  if (numbers.minDeposit != null) filters.push({ deposit: { gte: numbers.minDeposit } })
  if (numbers.maxDeposit != null) filters.push({ deposit: { lte: numbers.maxDeposit } })
  if (availableBy) filters.push({ availableFrom: { lte: new Date(`${availableBy}T00:00:00.000Z`) } })
  for (const term of terms) filters.push({ amenities: { some: { OR: [{ amenityId: term }, { amenity: { name: { contains: term, mode: 'insensitive' } } }, { amenity: { slug: { contains: term, mode: 'insensitive' } } }] } } })
  const where: Prisma.ListingWhereInput = { ...(mine ? { ownerId: user!.id } : publicListingWhere()), AND: filters }
  const orderBy: Prisma.ListingOrderByWithRelationInput[] = sort === 'rent_asc' ? [{ rent: 'asc' }, { createdAt: 'desc' }] : sort === 'rent_desc' ? [{ rent: 'desc' }, { createdAt: 'desc' }] : sort === 'distance' ? [{ distanceKm: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }]
  const [total, records] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({ where, include: listingInclude, orderBy, skip: (page - 1) * limit, take: limit }),
  ])
  ok(res, { items: records.map(item => serializeListing(item, user)), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit })
}))

router.get('/listings/:id', withErrors(async (req, res) => {
  const record = await prisma.listing.findUnique({ where: { id: req.params.id }, include: listingInclude })
  const user = currentUser(req)
  if (!record || (record.status !== 'PUBLISHED' && record.ownerId !== user?.id && !isAdmin(user))) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
  if (record.status === 'PUBLISHED' && record.ownerId !== user?.id && !isAdmin(user)) {
    const visible = await prisma.listing.count({ where: { id: record.id, ...publicListingWhere() } })
    if (!visible) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
  }
  const landlordReviews = record.ownerId && await prisma.user.count({ where: { id: record.ownerId, roles: { has: 'LANDLORD' } } })
    ? await prisma.review.aggregate({
      where: { landlordId: record.ownerId, status: 'APPROVED', active: true, listing: { is: publicListingWhere() } },
      _avg: { rating: true }, _count: { _all: true },
    }) : null
  ok(res, {
    ...serializeListing(record, user),
    landlordRating: landlordReviews?._avg.rating == null ? null : Number(landlordReviews._avg.rating.toFixed(1)),
    landlordReviewCount: landlordReviews?._count._all,
  })
}))

router.post('/listings', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  if (!mayPost(user)) { fail(res, 403, 'This account cannot create property listings.', 'FORBIDDEN'); return }
  const parsed = listingInput.safeParse(req.body)
  if (!parsed.success) { failValidation(res); return }
  const value = parsed.data
  if (!await validAmenities(value.amenityIds)) { failValidation(res, 'Choose valid facilities.'); return }
  const campus = await prisma.campus.findUnique({ where: { id: value.campusId } })
  if (!campus?.active) { failValidation(res, 'Choose an active campus.'); return }
  const photos = await validPhotoUploads(value.photoKeys, user.id)
  if (!photos) { failValidation(res, 'Upload valid property photos before attaching them.'); return }
  const coordinates = await geocodeAddress(value.address)
  const created = await prisma.$transaction(async tx => {
    const listing = await tx.listing.create({ data: {
      ownerId: user.id, campusId: value.campusId, title: value.title, description: value.description, propertyType: value.propertyType, roomType: value.roomType,
      rent: value.rent.toFixed(2), deposit: value.deposit.toFixed(2), currency: value.currency, availableFrom: new Date(`${value.availableFrom}T00:00:00.000Z`),
      approximateArea: value.approximateArea, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null, address: value.address,
      showExactLocation: value.showExactLocation, houseRules: value.houseRules || null, contactMethod: value.contactMethod, furnished: value.furnished, status: 'DRAFT',
    } })
    if (value.amenityIds.length) await tx.listingAmenity.createMany({ data: value.amenityIds.map(amenityId => ({ listingId: listing.id, amenityId })) })
    if (photos.length) await tx.listingPhoto.createMany({ data: photos.map(({ key, mimeType }, sortOrder) => ({ listingId: listing.id, storageKey: key, mimeType, sortOrder })) })
    return listing
  })
  const result = await prisma.listing.findUniqueOrThrow({ where: { id: created.id }, include: listingInclude })
  ok(res, serializeListing(result, user), 201)
}))

router.patch('/listings/:id', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const existing = await prisma.listing.findUnique({ where: { id: req.params.id } })
  if (!existing || (existing.ownerId !== user.id && !isAdmin(user))) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
  if (existing.status === 'ARCHIVED') { fail(res, 409, 'Archived listings cannot be edited.', 'INVALID_STATUS'); return }
  const parsed = listingPatch.safeParse(req.body)
  if (!parsed.success) { failValidation(res); return }
  const value = parsed.data
  if (value.status) {
    if (Object.keys(req.body as Record<string, unknown>).some(key => key !== 'status')) { failValidation(res, 'Change listing status separately from its details.'); return }
    const allowed = (existing.status === 'PUBLISHED' && ['PAUSED', 'RENTED'].includes(value.status)) || (existing.status === 'PAUSED' && value.status === 'PUBLISHED')
    if (!allowed) { fail(res, 409, 'This listing status change is not allowed.', 'INVALID_STATUS'); return }
    if (existing.status === 'PAUSED') {
      // Re-listing always passes the same account and property checks as a new submission.
      if (existing.ownerId !== user.id) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
      const error = await submitForReview(existing.id, user.id, ['PAUSED'])
      if (error) { submitError(res, error); return }
    } else {
      await prisma.listing.updateMany({ where: { id: existing.id, status: 'PUBLISHED' }, data: { status: value.status } })
    }
  } else {
    if (!hasFullAddress(value.address ?? existing.address)) { failValidation(res, 'Enter a full property address between 10 and 250 characters.'); return }
    if (value.amenityIds && !await validAmenities(value.amenityIds)) { failValidation(res, 'Choose valid facilities.'); return }
    if (value.campusId) {
      const campus = await prisma.campus.findUnique({ where: { id: value.campusId } })
      if (!campus?.active) { failValidation(res, 'Choose an active campus.'); return }
    }
    const removePhotoIds = value.removePhotoIds || []
    const currentPhotos = await prisma.listingPhoto.findMany({ where: { listingId: existing.id } })
    if (removePhotoIds.some(id => !currentPhotos.some(photo => photo.id === id))) { failValidation(res, 'One or more photos do not belong to this listing.'); return }
    const newPhotos = await validPhotoUploads(value.newPhotoKeys || [], user.id)
    if (!newPhotos || currentPhotos.length - removePhotoIds.length + newPhotos.length > 8) { failValidation(res, 'A listing can have up to eight valid photos.'); return }
    const update: Prisma.ListingUncheckedUpdateInput = {}
    const addressChanged = value.address !== undefined && value.address !== existing.address
    if (value.title !== undefined) update.title = value.title
    if (value.description !== undefined) update.description = value.description
    if (value.campusId !== undefined) update.campusId = value.campusId
    if (value.propertyType !== undefined) update.propertyType = value.propertyType
    if (value.roomType !== undefined) update.roomType = value.roomType
    if (value.rent !== undefined) update.rent = value.rent.toFixed(2)
    if (value.deposit !== undefined) update.deposit = value.deposit.toFixed(2)
    if (value.availableFrom !== undefined) update.availableFrom = new Date(`${value.availableFrom}T00:00:00.000Z`)
    if (value.approximateArea !== undefined) update.approximateArea = value.approximateArea
    if (addressChanged) {
      const coordinates = await geocodeAddress(value.address!)
      update.address = value.address
      update.latitude = coordinates?.latitude ?? null
      update.longitude = coordinates?.longitude ?? null
    }
    if (value.showExactLocation !== undefined) update.showExactLocation = value.showExactLocation
    if (value.houseRules !== undefined) update.houseRules = value.houseRules
    if (value.contactMethod !== undefined) update.contactMethod = value.contactMethod
    if (value.furnished !== undefined) update.furnished = value.furnished
    if (Object.keys(update).length || value.amenityIds !== undefined || removePhotoIds.length || newPhotos.length) {
      if (existing.status === 'PUBLISHED' || existing.status === 'PAUSED') { update.status = addressChanged ? 'DRAFT' : 'PENDING_REVIEW'; update.reviewedAt = null }
      if (existing.status === 'REJECTED' || (addressChanged && existing.status === 'PENDING_REVIEW')) update.status = 'DRAFT'
      try { await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.id}))::text`
        const fresh = await tx.listing.findUniqueOrThrow({ where: { id: existing.id }, select: { address: true, status: true } })
        if (fresh.address !== existing.address || fresh.status !== existing.status) throw new Error('LISTING_CHANGED')
        if (addressChanged) {
          await tx.propertyAuthorization.updateMany({ where: { listingId: existing.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REJECTED', reason: 'Property address changed; submit new proof.', reviewedAt: new Date() } })
        }
        await tx.listing.update({ where: { id: existing.id }, data: update })
        if (value.amenityIds !== undefined) {
          await tx.listingAmenity.deleteMany({ where: { listingId: existing.id } })
          if (value.amenityIds.length) await tx.listingAmenity.createMany({ data: value.amenityIds.map(amenityId => ({ listingId: existing.id, amenityId })) })
        }
        if (removePhotoIds.length) await tx.listingPhoto.deleteMany({ where: { listingId: existing.id, id: { in: removePhotoIds } } })
        if (newPhotos.length) await tx.listingPhoto.createMany({ data: newPhotos.map(({ key, mimeType }, index) => ({ listingId: existing.id, storageKey: key, mimeType, sortOrder: currentPhotos.length - removePhotoIds.length + index })) })
      }) } catch (error) {
        if (error instanceof Error && error.message === 'LISTING_CHANGED') { fail(res, 409, 'The listing changed while you edited it. Refresh and try again.', 'LISTING_CHANGED'); return }
        throw error
      }
    }
  }
  const result = await prisma.listing.findUniqueOrThrow({ where: { id: existing.id }, include: listingInclude })
  ok(res, serializeListing(result, user))
}))

router.delete('/listings/:id', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const existing = await prisma.listing.findUnique({ where: { id: req.params.id } })
  if (!existing || (existing.ownerId !== user.id && !isAdmin(user))) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
  const updated = await prisma.listing.update({ where: { id: existing.id }, data: { status: 'ARCHIVED' }, include: listingInclude })
  ok(res, serializeListing(updated, user))
}))

// A failed address lookup can be retried without changing the listing or
// restarting the server. The address and precise point remain owner/admin-only.
router.post('/listings/:id/location/refresh', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const existing = await prisma.listing.findUnique({ where: { id: req.params.id } })
  if (!existing || existing.ownerId !== user.id || existing.status === 'ARCHIVED') {
    fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return
  }
  if (!hasFullAddress(existing.address)) { failValidation(res, 'Enter the full property address before calculating distance.'); return }
  if (existing.latitude != null && existing.longitude != null) {
    const record = await prisma.listing.findUniqueOrThrow({ where: { id: existing.id }, include: listingInclude })
    ok(res, serializeListing(record, user)); return
  }
  const key = `${existing.id}:${existing.address}`
  const now = Date.now()
  if (now - (locationRetryAt.get(key) || 0) < 60_000) {
    fail(res, 429, 'Wait one minute before retrying this address.', 'LOCATION_RETRY_LIMIT'); return
  }
  if (locationRetryAt.size > 1000) locationRetryAt.clear()
  locationRetryAt.set(key, now)
  const point = await geocodeAddress(existing.address!)
  if (!point) { fail(res, 422, 'This address could not be located. Check the full address or try again later.', 'ADDRESS_NOT_LOCATED'); return }
  const updated = await prisma.listing.updateMany({
    where: { id: existing.id, ownerId: user.id, address: existing.address, latitude: null, longitude: null, status: { not: 'ARCHIVED' } },
    data: point,
  })
  if (!updated.count) { fail(res, 409, 'The listing changed while the address was checked. Refresh and try again.', 'LISTING_CHANGED'); return }
  locationRetryAt.delete(key)
  const record = await prisma.listing.findUniqueOrThrow({ where: { id: existing.id }, include: listingInclude })
  ok(res, serializeListing(record, user))
}))

router.post('/listings/:id/submit', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const error = await submitForReview(req.params.id, user.id, ['DRAFT', 'REJECTED', 'RENTED', 'PAUSED'])
  if (error) { submitError(res, error); return }
  const updated = await prisma.listing.findUniqueOrThrow({ where: { id: req.params.id }, include: listingInclude })
  ok(res, serializeListing(updated, user))
}))

router.post('/listings/:id/availability', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const existing = await prisma.listing.findUnique({ where: { id: req.params.id } })
  if (!existing || (existing.ownerId !== user.id && !isAdmin(user))) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
  if (!['PUBLISHED', 'PAUSED'].includes(existing.status)) { fail(res, 409, 'Only approved listings can confirm availability.', 'INVALID_STATUS'); return }
  const updated = await prisma.listing.update({ where: { id: existing.id }, data: { lastConfirmedAt: new Date() }, include: listingInclude })
  ok(res, serializeListing(updated, user))
}))

router.get('/favorites', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const records = await prisma.favorite.findMany({ where: { userId: user.id, listing: publicListingWhere() }, orderBy: { createdAt: 'desc' }, include: { listing: { include: listingInclude } } })
  ok(res, { items: records.map(record => serializeListing(record.listing, user)) })
}))

router.post('/favorites', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const listingId = typeof req.body?.listingId === 'string' ? req.body.listingId : ''
  const listing = listingId ? await prisma.listing.findUnique({ where: { id: listingId } }) : null
  if (!listing || !await prisma.listing.count({ where: { id: listing.id, ...publicListingWhere() } })) { fail(res, 404, 'This property could not be found.', 'NOT_FOUND'); return }
  await prisma.favorite.upsert({ where: { userId_listingId: { userId: user.id, listingId } }, create: { userId: user.id, listingId }, update: {} })
  ok(res, { saved: true })
}))

router.delete('/favorites', requireAuth, withErrors(async (req, res) => {
  const user = currentUser(req)!
  const listingId = typeof req.body?.listingId === 'string' ? req.body.listingId : ''
  if (!listingId) { failValidation(res, 'Choose a property to remove from favorites.'); return }
  await prisma.favorite.deleteMany({ where: { userId: user.id, listingId } })
  ok(res, { saved: false })
}))

export default router
