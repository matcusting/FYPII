/**
 * Local-only, in-memory UI preview. This is deliberately NOT a production API.
 * Start after `npm run build`: node preview/demo-server.mjs
 */
import { createServer } from 'node:http'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.PREVIEW_PORT || 4173)
const host = '127.0.0.1'
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const now = () => new Date().toISOString()
const id = prefix => `${prefix}-${randomUUID().slice(0, 8)}`
const seedDate = '2026-10-01T09:00:00.000Z'
const demoPassword = 'Demo12345!'
const DAY_MS = 24 * 60 * 60 * 1000
const studentPreviewEmail = /^demo-[a-z0-9][a-z0-9._+-]{0,54}@student\.uts\.edu\.my$/
const users = [
  { id: 'student-demo', name: 'Demo Student', email: 'student@demo.local', roles: ['STUDENT'], emailVerified: true, studentVerified: true, verificationStatus: 'APPROVED', status: 'ACTIVE' },
  { id: 'landlord-demo', name: 'Demo Landlord', email: 'landlord@demo.local', roles: ['LANDLORD'], emailVerified: true, studentVerified: false, status: 'ACTIVE' },
  { id: 'landlord-applicant', name: 'Demo New Landlord', email: 'landlord-applicant@demo.local', roles: ['LANDLORD'], emailVerified: true, studentVerified: false, status: 'ACTIVE' },
  { id: 'admin-demo', name: 'Demo Admin', email: 'admin@demo.local', roles: ['ADMIN'], emailVerified: true, studentVerified: false, status: 'ACTIVE' },
  { id: 'student-candidate', name: 'Demo Roommate', email: 'candidate@demo.local', roles: ['STUDENT'], emailVerified: true, studentVerified: true, verificationStatus: 'APPROVED', status: 'ACTIVE' },
  { id: 'student-applicant', name: 'Demo Applicant', email: 'verification-demo@student.uts.edu.my', roles: ['STUDENT'], emailVerified: true, studentVerified: false, verificationStatus: 'UNVERIFIED', status: 'ACTIVE' },
]
const sessions = new Map()
const demoEmailTokens = new Map()
const demoResetTokens = new Map()
function hashPassword(password) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`
}
function validPassword(password, digest) {
  if (typeof password !== 'string' || !digest) return false
  const [saltHex, hashHex] = digest.split(':')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
const demoPasswordHashes = new Map(users.map(account => [account.id, hashPassword(demoPassword)]))
function createDemoToken(tokens, userId, lifetimeMs) {
  for (const [value, record] of tokens) if (record.userId === userId) tokens.delete(value)
  const token = randomBytes(32).toString('hex')
  tokens.set(token, { userId, expiresAt: Date.now() + lifetimeMs })
  return token
}
function consumeDemoToken(tokens, value) {
  const record = tokens.get(value)
  if (!record) return null
  tokens.delete(value)
  return record.expiresAt > Date.now() ? users.find(account => account.id === record.userId) || null : null
}
const uploads = new Map()
const campuses = [
  { id: 'uts-sibu', name: 'UTS Sibu Campus', university: 'University of Technology Sarawak', latitude: 2.286, longitude: 111.835, domains: ['student.uts.edu.my'], active: true },
  { id: 'sibu-center', name: 'Sibu City Centre', university: 'University of Technology Sarawak', latitude: 2.298, longitude: 111.829, domains: [], active: true },
]
const amenities = [
  { id: 'wifi', name: 'Wi-Fi', slug: 'wifi' }, { id: 'parking', name: 'Parking', slug: 'parking' },
  { id: 'aircon', name: 'Air Conditioning', slug: 'aircon' }, { id: 'laundry', name: 'Washing Machine', slug: 'laundry' },
  { id: 'wardrobe', name: 'Wardrobe', slug: 'wardrobe' }, { id: 'refrigerator', name: 'Refrigerator', slug: 'refrigerator' },
  { id: 'water-heater', name: 'Water Heater', slug: 'water-heater' }, { id: 'private-bathroom', name: 'Private Bathroom', slug: 'private-bathroom' },
  { id: 'kitchen-access', name: 'Kitchen Access', slug: 'kitchen-access' }, { id: 'study-desk', name: 'Study Desk', slug: 'study-desk' },
  { id: 'security-cctv', name: 'Security / CCTV', slug: 'security-cctv' }, { id: 'balcony', name: 'Balcony', slug: 'balcony' },
]
const listing = (idValue, title, rent, area, type, room, photo, status = 'PUBLISHED') => ({
  id: idValue, title, description: `${title}. This fictional property is for preview use only and is not available to rent. Explore the layout, amenities, and in-app inquiry flow.`,
  rent, deposit: rent, currency: 'MYR', approximateArea: area,
  address: idValue === 'demo-listing-1' ? '12 Demo Road, Sibu Jaya, 96000 Sibu, Sarawak' : '45 Example Street, 96000 Sibu, Sarawak',
  showExactLocation: idValue === 'demo-listing-1',
  availableFrom: '2026-11-01', lastConfirmedAt: seedDate, propertyType: type, roomType: room,
  furnished: true, amenityIds: ['wifi', 'aircon'], amenities: ['Wi-Fi', 'Air Conditioning'],
  photos: photo ? [{ id: `${idValue}-photo`, url: `/demo/illustrations/${photo}.svg`, alt: 'Illustration of a demo property' }] : [],
  status, campusId: 'uts-sibu', campusName: 'UTS Sibu Campus', ownerId: 'landlord-demo',
  owner: { id: 'landlord-demo', name: 'Demo Landlord' }, rating: 4.5, reviewCount: 1,
  houseRules: 'Please keep shared spaces tidy.', contactMethod: 'IN_APP', createdAt: seedDate, updatedAt: seedDate,
})
const listings = [
  listing('demo-listing-1', 'Room Near UTS (Demo)', 680, 'Sibu Jaya area', 'APARTMENT', 'SINGLE', 'room'),
  listing('demo-listing-2', 'Furnished Apartment Near Campus (Demo)', 1200, 'Sibu city centre', 'APARTMENT', 'ENTIRE', 'apartment'),
  listing('demo-listing-3', 'Quiet Shared Room (Demo)', 550, 'Sibu Jaya area', 'HOUSE', 'SHARED', 'house'),
  listing('demo-listing-4', 'Listing Pending Review (Demo)', 720, 'Sibu Jaya area', 'HOUSE', 'SINGLE', 'room', 'PENDING_REVIEW'),
]
const profiles = new Map(users.map(user => [user.id, {
  displayName: user.name, name: user.name, email: user.email, phone: user.roles.includes('LANDLORD') ? '+60 12-345 6789' : null,
  university: user.roles.includes('STUDENT') ? 'University of Technology Sarawak' : '',
  bio: user.roles.includes('STUDENT') ? 'Looking for a quiet place with an easy commute to campus.' : '',
  preferredLocation: user.roles.includes('STUDENT') ? 'Sibu Jaya' : null,
  budgetMin: user.roles.includes('STUDENT') ? 500 : null,
  budgetMax: user.roles.includes('STUDENT') ? 1000 : null,
  preferredMoveInDate: user.roles.includes('STUDENT') ? '2026-11-01' : null,
  verificationStatus: user.verificationStatus || 'UNVERIFIED',
}]))
const blankAnswers = { smoking: 'NEVER', studySchedule: 'EVENING', sleepSchedule: 'FLEXIBLE', cleanliness: 'HIGH', noise: 'QUIET', guests: 'RARE', pets: 'NO_PETS' }
const roommateProfiles = new Map([
  ['student-demo', { displayName: 'Demo Student', university: 'University of Technology Sarawak', bio: 'Hoping to find a tidy roommate.', preferredLocation: 'Sibu Jaya', budgetMin: 500, budgetMax: 900, moveInDate: '2026-11-01', discoverable: true, lifestyle: { ...blankAnswers }, roommatePreferences: { ...blankAnswers }, importanceWeights: Object.fromEntries(Object.keys(blankAnswers).map(key => [key, 1])), visibility: { university: false, bio: true, preferredLocation: true, budget: true, moveInDate: true, lifestyle: true }, smokeFreeOnly: true, petFreeOnly: false }],
  ['student-candidate', { displayName: 'Demo Roommate', university: 'University of Technology Sarawak', bio: 'I enjoy quiet study time and a regular routine.', preferredLocation: 'Sibu Jaya', budgetMin: 550, budgetMax: 950, moveInDate: '2026-11-10', discoverable: true, lifestyle: { ...blankAnswers }, visibility: { university: false, bio: true, preferredLocation: true, budget: true, moveInDate: true, lifestyle: true } }],
])
const favorites = new Map([['student-demo', new Set(['demo-listing-1'])]])
const inquiries = [{ id: 'demo-inquiry-1', listingId: 'demo-listing-1', senderId: 'student-demo', recipientId: 'landlord-demo', sender: { id: 'student-demo', name: 'Demo Student' }, recipient: { id: 'landlord-demo', name: 'Demo Landlord' }, listing: { id: 'demo-listing-1', title: 'Room Near UTS (Demo)' }, message: 'Hello, when can I view this demo property?', status: 'OPEN', createdAt: seedDate }]
const roommateRequests = [{ id: 'demo-request-1', senderId: 'student-candidate', recipientId: 'student-demo', sender: { id: 'student-candidate', name: 'Demo Roommate' }, recipient: { id: 'student-demo', name: 'Demo Student' }, status: 'PENDING', createdAt: seedDate }]
const inquiryMessages = new Map([['demo-inquiry-1', [{ id: 'demo-inquiry-message-1', senderId: 'student-demo', body: inquiries[0].message, createdAt: seedDate }]]])
const roommateMessages = new Map()
const notifications = []
const auditLogs = []
const reviews = [{ id: 'demo-review-1', listingId: 'demo-listing-1', listing: { id: 'demo-listing-1', title: 'Room Near UTS (Demo)' }, authorId: 'student-candidate', author: { name: 'Demo Roommate' }, rating: 4, body: 'Demo review: A convenient location and a student-friendly room. This is not based on a real stay.', status: 'APPROVED', moderationStatus: 'APPROVED', createdAt: seedDate }]
const reports = [{ id: 'demo-report-1', targetType: 'LISTING', targetId: 'demo-listing-2', category: 'INACCURATE', reason: 'Demo report: Please check that the photos match the description.', reporter: { name: 'Demo Student' }, status: 'OPEN', createdAt: seedDate }]
const verifications = []
const deletionRequests = []
// These fictional records keep the pre-existing preview properties available.
// New applicants must complete the two independent review steps themselves.
const landlordVerifications = [{
  id: 'demo-landlord-identity-1', userId: 'landlord-demo', kind: 'INDIVIDUAL', status: 'APPROVED',
  landlord: { id: 'landlord-demo', name: 'Demo Landlord', email: 'landlord@demo.local', phone: '+60 12-345 6789' },
  reason: null, createdAt: seedDate, reviewedAt: seedDate, expiresAt: new Date(Date.now() + 365 * DAY_MS).toISOString(), revokedAt: null,
}]
const propertyAuthorizations = listings.map(item => ({
  id: `demo-property-auth-${item.id}`, listingId: item.id, userId: item.ownerId, requesterId: item.ownerId,
  listing: { id: item.id, title: item.title, address: item.address },
  owner: { id: item.ownerId, name: item.owner.name, email: 'landlord@demo.local' },
  address: item.address, kind: 'OWNER', status: 'APPROVED', reason: null,
  createdAt: seedDate, reviewedAt: seedDate, expiresAt: new Date(Date.now() + 180 * DAY_MS).toISOString(), revokedAt: null,
}))
const preferences = new Map()

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(status >= 400 ? { error: { code: value.code || 'DEMO_ERROR', message: value.message } } : { data: value }))
}
function fail(res, status, message, code) { json(res, status, { message, code }) }
function required(res, user, role) {
  if (!user) { fail(res, 401, 'Please sign in with a demo account.', 'UNAUTHORIZED'); return false }
  if (role && !user.roles.includes(role)) { fail(res, 403, 'This demo account cannot access this page.', 'FORBIDDEN'); return false }
  return true
}
function currentUser(req) {
  const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('demo_session='))
  const token = cookie?.slice('demo_session='.length)
  return users.find(user => user.id === sessions.get(token)?.userId) || null
}
function currentSession(req) {
  const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('demo_session='))
  const token = cookie?.slice('demo_session='.length)
  return token ? { token, ...sessions.get(token) } : null
}
async function bodyOf(req, max = 5_500_000) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > max) throw Object.assign(new Error('The demo upload or request exceeds the size limit.'), { status: 413 })
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)
  if (!buffer.length) return {}
  const type = req.headers['content-type'] || ''
  if (type.startsWith('application/json')) {
    try { return JSON.parse(buffer.toString('utf8')) }
    catch { throw Object.assign(new Error('The request contains invalid JSON.'), { status: 400 }) }
  }
  if (type.startsWith('multipart/form-data')) {
    try {
      // Parse the upload only for local validation. The preview never stores the document bytes.
      const form = await new Request('http://127.0.0.1/', { method: 'POST', headers: { 'Content-Type': type }, body: buffer }).formData()
      return Object.fromEntries(form.entries())
    } catch { throw Object.assign(new Error('The demo form upload is invalid.'), { status: 400 }) }
  }
  return { buffer }
}
async function validDemoProof(file, allowedTypes) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number' || file.size < 1 || file.size > 5_000_000) return false
  const bytes = Buffer.from(await file.arrayBuffer())
  const detected = bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-' ? 'application/pdf'
    : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
      : bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : ''
  return allowedTypes.includes(detected) && file.type === detected
}
function paginate(items, url, fallbackLimit = 20) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(fallbackLimit), 10) || fallbackLimit))
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, pages: Math.max(1, Math.ceil(items.length / limit)) }
}
function messagePage(messages, url) {
  const latestFirst = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const page = paginate(latestFirst, url)
  page.items.reverse()
  return page
}
function notify(userId, type, payload = {}) {
  notifications.unshift({ id: id('notification'), userId, type, payload, readAt: null, createdAt: now() })
}
function recordAudit(actor, action, targetType, targetId, before, after) {
  auditLogs.unshift({ id: id('audit'), actorId: actor.id, actor: { id: actor.id, name: actor.name, email: actor.email },
    action, targetType, targetId, before, after, createdAt: now() })
}
function ownerOf(item) { return users.find(user => user.id === item.ownerId) }
function latestIdentity(userId) { return landlordVerifications.find(item => item.userId === userId) || null }
function approvalIsCurrent(record) { return record?.status === 'APPROVED' && Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) > Date.now() }
function effectiveApprovalStatus(record) { return record?.status === 'APPROVED' && !approvalIsCurrent(record) ? 'EXPIRED' : record?.status || 'UNVERIFIED' }
function approvalExpiresAt(kind, validUntil) {
  const latest = Date.now() + (kind === 'identity' ? 365 : 180) * DAY_MS
  if (!validUntil) return new Date(latest).toISOString()
  if (typeof validUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return null
  const calendarDate = new Date(`${validUntil}T00:00:00.000Z`)
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== validUntil) return null
  const chosen = Date.parse(`${validUntil}T15:59:59.999Z`)
  return chosen > Date.now() && chosen <= latest ? new Date(chosen).toISOString() : null
}
function revokePropertyReviews(userId, reason) {
  for (const authorization of propertyAuthorizations) {
    if (authorization.userId !== userId || !['PENDING', 'APPROVED'].includes(authorization.status)) continue
    authorization.status = 'REJECTED'
    authorization.reason = reason
  }
  for (const listing of listings) {
    if (listing.ownerId === userId && ['PUBLISHED', 'PENDING_REVIEW'].includes(listing.status)) listing.status = 'PAUSED'
  }
}
function revokeApprovedPropertyReviews(userId, reason) {
  for (const authorization of propertyAuthorizations) {
    if (authorization.userId !== userId || authorization.status !== 'APPROVED') continue
    authorization.status = 'REVOKED'
    authorization.reason = reason
    authorization.revokedAt = now()
    authorization.expiresAt = null
  }
  for (const listing of listings) {
    if (listing.ownerId === userId && ['PUBLISHED', 'PENDING_REVIEW'].includes(listing.status)) {
      listing.status = 'PAUSED'
      listing.moderationReason = reason
    }
  }
}
function latestPropertyAuthorization(listingId) {
  const listing = listings.find(item => item.id === listingId)
  return propertyAuthorizations.find(item => item.listingId === listingId && item.address === listing?.address) || null
}
function approvedPropertyAuthorization(item) {
  const latest = latestPropertyAuthorization(item.id)
  return latest?.userId === item.ownerId && approvalIsCurrent(latest)
}
function publicListingCurrent(item) {
  const owner = ownerOf(item)
  return item.status === 'PUBLISHED' && owner?.status === 'ACTIVE' && owner.emailVerified &&
    (owner.roles.includes('LANDLORD') ? approvalIsCurrent(latestIdentity(owner.id)) : owner.roles.includes('STUDENT') && owner.studentVerified) &&
    approvedPropertyAuthorization(item)
}
function requiredListingProof(item) {
  const owner = ownerOf(item)
  if (!owner?.emailVerified) return 'Verify your account email before submitting a property.'
  if (owner.roles.includes('LANDLORD') && !approvalIsCurrent(latestIdentity(owner.id))) return 'Your landlord identity must be approved before this listing can be submitted or published.'
  if (owner.roles.includes('STUDENT') && !owner.studentVerified) return 'Student verification is required before submitting a sublet.'
  if (!approvedPropertyAuthorization(item)) return 'Approved authorization for this full property address is required before this listing can be submitted or published.'
  return null
}
function verificationSummary(record) {
  return { status: effectiveApprovalStatus(record), latest: record ? {
    id: record.id, kind: record.kind, status: effectiveApprovalStatus(record), reason: record.reason,
    createdAt: record.createdAt, reviewedAt: record.reviewedAt, expiresAt: record.expiresAt || null, revokedAt: record.revokedAt || null,
  } : null }
}
function landlordVerificationForAdmin(record, detail = false) {
  return { ...record, status: effectiveApprovalStatus(record), moderationReason: record.reason, landlord: { ...record.landlord, emailVerified: users.find(user => user.id === record.userId)?.emailVerified === true }, ...(detail && record.status !== 'REJECTED' ? {
    identityUrl: `/api/v1/admin/landlord-verifications/${record.id}/identity`,
    ...(record.kind === 'COMPANY' ? {
      companyUrl: `/api/v1/admin/landlord-verifications/${record.id}/company`,
      representativeUrl: `/api/v1/admin/landlord-verifications/${record.id}/representative`,
    } : {}),
  } : {}) }
}
function propertyAuthorizationForAdmin(record, detail = false) {
  return { ...record, status: effectiveApprovalStatus(record), requesterId: record.userId, addressSnapshot: record.address, moderationReason: record.reason, listing: {
    ...record.listing, status: listings.find(item => item.id === record.listingId)?.status || 'DRAFT',
  }, landlord: { ...record.owner }, ...(detail && record.status !== 'REJECTED' ? {
    proofUrl: `/api/v1/admin/property-authorizations/${record.id}/proof`,
    ...(record.kind !== 'OWNER' ? { supportingUrl: `/api/v1/admin/property-authorizations/${record.id}/supporting` } : {}),
  } : {}) }
}
function verificationForAdmin(item, detail = false) {
  const applicant = users.find(user => user.id === item.userId)
  return {
    ...item,
    student: { ...item.student, emailVerified: applicant?.emailVerified === true },
    ...(detail && item.method === 'DOCUMENTS' ? {
      studentIdUrl: `/api/v1/admin/verifications/${item.id}/student-id`,
      offerLetterUrl: `/api/v1/admin/verifications/${item.id}/offer-letter`,
    } : {}),
  }
}
function maySeeExactLocation(item, viewer) {
  return viewer?.id === item.ownerId || viewer?.roles.includes('ADMIN') || (item.showExactLocation === true && viewer?.roles.includes('STUDENT'))
}
function decorateListing(item, viewer) {
  const lastConfirmed = item.lastConfirmedAt ? Date.parse(item.lastConfirmedAt) : NaN
  const result = { ...item, availabilityStale: !Number.isFinite(lastConfirmed) || Date.now() - lastConfirmed > 30 * 24 * 60 * 60 * 1000,
    campusName: campuses.find(c => c.id === item.campusId)?.name || item.campusName, owner: item.owner || (ownerOf(item) ? { id: item.ownerId, name: ownerOf(item).name } : undefined) }
  if (!maySeeExactLocation(item, viewer)) {
    delete result.latitude
    delete result.longitude
    delete result.address
    result.showExactLocation = false
  }
  return result
}
function matchesFor(user) {
  const blocked = user?.blockedUsers || []
  return [...roommateProfiles.entries()].filter(([personId, profile]) => personId !== user.id && profile.discoverable && users.find(item => item.id === personId)?.studentVerified && !blocked.includes(personId)).map(([personId, profile]) => ({
    id: personId, publicProfile: { userId: personId, displayName: profile.displayName, bio: profile.visibility?.bio ? profile.bio : undefined, preferredLocation: profile.visibility?.preferredLocation ? profile.preferredLocation : undefined, budgetMin: profile.visibility?.budget ? profile.budgetMin : undefined, budgetMax: profile.visibility?.budget ? profile.budgetMax : undefined, moveInDate: profile.visibility?.moveInDate ? profile.moveInDate : undefined },
    compatibilityScore: 84, topFactors: ['You both prefer a quiet study environment', 'Your budgets are similar', 'Your move-in dates are close'], explanation: 'This is a demo match; the score is illustrative.',
    requestStatus: roommateRequests.find(request => request.senderId === user.id && request.recipientId === personId)?.status || '',
  }))
}

async function api(req, res, url) {
  const path = url.pathname.slice('/api/v1'.length)
  const method = req.method
  const user = currentUser(req)
  const proofRequest = path === '/verifications' || path === '/landlord-verifications/identity' || /^\/landlord-verifications\/listings\/[^/]+$/.test(path)
  const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !path.startsWith('/demo-uploads/') ? await bodyOf(req, proofRequest ? 16_000_000 : 5_500_000) : {}

  if (path === '/auth/me' && method === 'GET') return user ? json(res, 200, user) : fail(res, 401, 'You are not signed in to a demo account.', 'UNAUTHORIZED')
  if (path === '/auth/login' && method === 'POST') {
    const account = users.find(item => item.email.toLowerCase() === String(body.email || '').toLowerCase())
    if (!account || !validPassword(body.password, demoPasswordHashes.get(account.id)) || account.status !== 'ACTIVE') return fail(res, 401, 'Incorrect demo email or password. Use student@demo.local, verification-demo@student.uts.edu.my, landlord@demo.local, landlord-applicant@demo.local, or admin@demo.local. The password is Demo12345!', 'INVALID_CREDENTIALS')
    const token = randomUUID()
    sessions.set(token, { id: id('session'), userId: account.id, createdAt: now() })
    res.setHeader('Set-Cookie', `demo_session=${token}; HttpOnly; SameSite=Strict; Path=/`)
    return json(res, 200, { message: 'Signed in to the demo account.' })
  }
  if (path === '/auth/logout' && method === 'POST') {
    sessions.delete(currentSession(req)?.token)
    res.setHeader('Set-Cookie', 'demo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    return json(res, 200, { message: 'Signed out of the demo account.' })
  }
  if (path === '/auth/register' && method === 'POST') {
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const phone = String(body.phone || '').trim()
    if (!['LANDLORD', 'STUDENT'].includes(body.role)) return fail(res, 400, 'Choose a student or landlord account.', 'INVALID_ROLE')
    if (users.some(item => item.email.toLowerCase() === email)) return fail(res, 409, 'This demo email is already registered.', 'EMAIL_EXISTS')
    if (body.role === 'LANDLORD' && (name.length < 2 || name.length > 120 || !/^[a-z0-9._+-]+@demo\.local$/.test(email) || !/^\+?[0-9][0-9 ()-]*$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')) || body.password !== demoPassword || body.acceptTerms !== true)) return fail(res, 400, 'For this fictional local preview, use a name, an unused @demo.local email, a valid phone number, the password Demo12345!, and accept the terms.', 'DEMO_ONLY')
    if (body.role === 'STUDENT' && (name.length < 2 || name.length > 100 || !studentPreviewEmail.test(email) || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128 || body.acceptTerms !== true)) return fail(res, 400, 'For this fictional local preview, use a name, an unused demo-...@student.uts.edu.my email, a password of at least 8 characters, and accept the terms.', 'DEMO_ONLY')
    const account = { id: id(body.role.toLowerCase()), name, email, roles: [body.role], emailVerified: false, studentVerified: false, verificationStatus: 'UNVERIFIED', status: 'ACTIVE' }
    users.push(account)
    demoPasswordHashes.set(account.id, hashPassword(body.password))
    profiles.set(account.id, { displayName: name, name, email, phone: body.role === 'LANDLORD' ? phone : null,
      university: body.role === 'STUDENT' ? 'University of Technology Sarawak' : '', bio: '', verificationStatus: 'UNVERIFIED' })
    const token = createDemoToken(demoEmailTokens, account.id, 24 * 60 * 60 * 1000)
    return json(res, 201, { id: account.id, email, verificationRequired: true, demoVerificationToken: token })
  }
  if (path === '/auth/verify-email' && method === 'POST') {
    const account = consumeDemoToken(demoEmailTokens, String(body.token || ''))
    if (!account) return fail(res, 400, 'The demo email verification token is invalid or was already used.', 'INVALID_TOKEN')
    account.emailVerified = true
    return json(res, 200, { verified: true })
  }
  if (path === '/auth/resend-verification' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.', 'VALIDATION_ERROR')
    const account = users.find(item => item.email === email && item.status === 'ACTIVE' && !item.emailVerified)
    return json(res, 200, { accepted: true, ...(account ? { demoVerificationToken: createDemoToken(demoEmailTokens, account.id, 24 * 60 * 60 * 1000) } : {}) })
  }
  if (path === '/auth/forgot-password' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.', 'VALIDATION_ERROR')
    const account = users.find(item => item.email === email && item.status === 'ACTIVE')
    return json(res, 200, { accepted: true, ...(account ? { demoResetToken: createDemoToken(demoResetTokens, account.id, 60 * 60 * 1000) } : {}) })
  }
  if (path === '/auth/reset-password' && method === 'POST') {
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) return fail(res, 400, 'The new demo password must be 8 to 128 characters.', 'VALIDATION_ERROR')
    const account = consumeDemoToken(demoResetTokens, String(body.token || ''))
    if (!account) return fail(res, 400, 'The demo reset token is invalid or expired.', 'INVALID_TOKEN')
    demoPasswordHashes.set(account.id, hashPassword(body.password))
    for (const [token, session] of sessions) if (session.userId === account.id) sessions.delete(token)
    res.setHeader('Set-Cookie', 'demo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    return json(res, 200, { reset: true })
  }

  if (path === '/campuses' && method === 'GET') return json(res, 200, { items: campuses.filter(campus => campus.active).map(({ id, name, university }) => ({ id, name, university })) })
  if (path === '/amenities' && method === 'GET') return json(res, 200, { items: amenities })
  if (path === '/listings' && method === 'GET') {
    const mine = url.searchParams.get('mine') === 'true'
    if (mine && !required(res, user)) return
    if (url.searchParams.has('maxDistanceKm') || url.searchParams.get('sort') === 'distance') return fail(res, 400, 'Distance search is unavailable. Search by campus or area instead.', 'VALIDATION_ERROR')
    const search = name => (url.searchParams.get(name) || '').toLowerCase()
    let items = listings.filter(item => mine ? item.ownerId === user.id : publicListingCurrent(item))
    if (search('q')) items = items.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(search('q')))
    if (search('area')) items = items.filter(item => item.approximateArea.toLowerCase().includes(search('area')))
    if (search('university')) items = items.filter(item => (campuses.find(campus => campus.id === item.campusId)?.university || '').toLowerCase().includes(search('university')))
    if (search('campusId')) items = items.filter(item => item.campusId.toLowerCase() === search('campusId'))
    if (search('propertyType')) items = items.filter(item => item.propertyType.toLowerCase() === search('propertyType'))
    if (search('roomType')) items = items.filter(item => item.roomType.toLowerCase() === search('roomType'))
    if (search('furnished')) items = items.filter(item => String(item.furnished) === search('furnished'))
    if (search('minRent')) items = items.filter(item => Number(item.rent) >= Number(search('minRent')))
    if (search('maxRent')) items = items.filter(item => Number(item.rent) <= Number(search('maxRent')))
    if (search('minDeposit')) items = items.filter(item => Number(item.deposit) >= Number(search('minDeposit')))
    if (search('maxDeposit')) items = items.filter(item => Number(item.deposit) <= Number(search('maxDeposit')))
    if (search('availableBy')) items = items.filter(item => item.availableFrom <= search('availableBy'))
    if (search('amenities')) items = items.filter(item => search('amenities').split(',').every(term => item.amenities?.some(amenity => amenity.toLowerCase().includes(term.trim()))))
    if (search('sort') === 'rent_asc') items.sort((a, b) => Number(a.rent) - Number(b.rent))
    if (search('sort') === 'rent_desc') items.sort((a, b) => Number(b.rent) - Number(a.rent))
    if (search('sort') === 'newest' || !search('sort')) items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return json(res, 200, paginate(items.map(item => decorateListing(item, user)), url, 12))
  }
  if (path === '/listings' && method === 'POST') {
    if (!required(res, user)) return
    if (!user.roles.some(role => ['STUDENT', 'LANDLORD', 'ADMIN'].includes(role))) return fail(res, 403, 'This account cannot create listings.')
    if (typeof body.address !== 'string' || body.address.trim().length < 10 || body.address.trim().length > 250) return fail(res, 400, 'Enter a full property address between 10 and 250 characters.')
    const item = { ...listing(id('listing'), String(body.title || 'New Demo Listing'), Number(body.rent || 0), String(body.approximateArea || 'Demo area'), String(body.propertyType || 'APARTMENT'), String(body.roomType || 'SINGLE'), null, 'DRAFT'), ...body,
      id: id('listing'), ownerId: user.id, owner: { id: user.id, name: user.name }, address: body.address.trim(), latitude: null, longitude: null,
      showExactLocation: body.showExactLocation === true, status: 'DRAFT', createdAt: now(), updatedAt: now(), lastConfirmedAt: now(), photos: (body.photoKeys || []).map(key => ({ id: key, url: `/demo/uploads/${encodeURIComponent(key)}`, alt: 'Demo uploaded photo' })) }
    listings.unshift(item)
    return json(res, 201, item)
  }
  const ownerReplyMatch = path.match(/^\/listings\/([^/]+)\/reviews\/([^/]+)\/response$/)
  if (ownerReplyMatch && method === 'POST') {
    if (!required(res, user)) return
    const review = reviews.find(entry => entry.id === ownerReplyMatch[2] && entry.listingId === ownerReplyMatch[1])
    const ownedListing = listings.find(entry => entry.id === ownerReplyMatch[1] && entry.ownerId === user.id)
    if (!review || !ownedListing) return fail(res, 404, 'This review could not be found on your listing.')
    if (review.ownerResponse) return fail(res, 409, 'You have already replied to this review.')
    review.ownerResponse = String(body.body || '').trim()
    return json(res, 200, review)
  }
  const reviewEditMatch = path.match(/^\/listings\/([^/]+)\/reviews\/([^/]+)$/)
  if (reviewEditMatch && method === 'PATCH') {
    if (!required(res, user, 'STUDENT')) return
    const review = reviews.find(entry => entry.id === reviewEditMatch[2] && entry.listingId === reviewEditMatch[1] && entry.authorId === user.id)
    if (!review) return fail(res, 404, 'This demo review could not be found.')
    const proof = uploads.get(body.experienceProofKey)
    if (proof?.purpose !== 'REVIEW_EVIDENCE' || proof.ownerId !== user.id || !proof.uploaded) return fail(res, 400, 'Upload a new private rental proof before editing your review.')
    const text = String(body.body || '').trim()
    const experience = String(body.experienceDescription || '').trim()
    if (text.length < 20 || text.length > 2000 || experience.length < 10 || experience.length > 500 || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) return fail(res, 400, 'Check the review and rental experience details.')
    Object.assign(review, { rating: body.rating, body: text, experienceDescription: experience, status: 'PENDING', moderationStatus: 'PENDING', ownerResponse: null, revision: (review.revision || 1) + 1, updatedAt: now() })
    uploads.delete(body.experienceProofKey)
    return json(res, 200, review)
  }
  const listingMatch = path.match(/^\/listings\/([^/]+)(?:\/(reviews|inquiries|submit|availability))?$/)
  if (listingMatch) {
    const [, listingId, action] = listingMatch
    const item = listings.find(entry => entry.id === listingId)
    if (!item) return fail(res, 404, 'This demo listing could not be found.', 'NOT_FOUND')
    if (!action && method === 'GET') {
      if (!publicListingCurrent(item) && !(user && (user.id === item.ownerId || user.roles.includes('ADMIN')))) return fail(res, 404, 'This public listing could not be found.', 'NOT_FOUND')
      return json(res, 200, decorateListing(item, user))
    }
    if (action === 'reviews' && method === 'GET') return json(res, 200, paginate(reviews.filter(review => review.listingId === item.id && review.status === 'APPROVED'), url))
    if (action === 'reviews' && method === 'POST') {
      if (!required(res, user, 'STUDENT')) return
      if (!user.studentVerified) return fail(res, 403, 'Student verification is required.')
      const proof = uploads.get(body.experienceProofKey)
      if (proof?.purpose !== 'REVIEW_EVIDENCE' || proof.ownerId !== user.id || !proof.uploaded) return fail(res, 400, 'Upload a private rental-experience proof before submitting your review.')
      const experienceDescription = String(body.experienceDescription || '').trim()
      if (experienceDescription.length < 10 || experienceDescription.length > 500) return fail(res, 400, 'Describe your rental experience in 10 to 500 characters.')
      const record = { id: id('review'), listingId: item.id, listing: { id: item.id, title: item.title }, authorId: user.id, author: { name: user.name }, rating: Number(body.rating), body: String(body.body || ''), experienceDescription, status: 'PENDING', moderationStatus: 'PENDING', createdAt: now() }
      reviews.unshift(record)
      uploads.delete(body.experienceProofKey)
      notify(item.ownerId, 'REVIEW_SUBMITTED', { listingId: item.id, reviewId: record.id })
      return json(res, 201, record)
    }
    if (action === 'inquiries' && method === 'POST') {
      if (!required(res, user, 'STUDENT')) return
      if (!publicListingCurrent(item)) return fail(res, 404, 'This public listing could not be found.', 'NOT_FOUND')
      const record = { id: id('inquiry'), listingId: item.id, listing: { id: item.id, title: item.title }, senderId: user.id, recipientId: item.ownerId, sender: { id: user.id, name: user.name }, recipient: { id: item.ownerId, name: ownerOf(item)?.name || 'Demo Landlord' }, message: String(body.message || ''), status: 'OPEN', createdAt: now() }
      inquiries.unshift(record)
      inquiryMessages.set(record.id, [{ id: id('inquiry-message'), senderId: user.id, body: record.message, createdAt: now() }])
      notify(item.ownerId, 'INQUIRY_RECEIVED', { inquiryId: record.id, listingId: item.id })
      return json(res, 201, record)
    }
    if (!required(res, user)) return
    if (user.id !== item.ownerId && !user.roles.includes('ADMIN')) return fail(res, 403, 'You can only manage your own demo listings.', 'FORBIDDEN')
    if (!action && method === 'PATCH') {
      if (body.address !== undefined && (typeof body.address !== 'string' || body.address.trim().length < 10 || body.address.trim().length > 250)) return fail(res, 400, 'Enter a full property address between 10 and 250 characters.')
      const addressChanged = body.address !== undefined && body.address.trim() !== item.address
      const { id: ignoredId, ownerId: ignoredOwner, owner: ignoredOwnerObject, photoKeys: ignoredKeys, newPhotoKeys, removePhotoIds, ...changes } = body
      Object.assign(item, changes)
      if (body.address !== undefined) item.address = body.address.trim()
      if (addressChanged) {
        if (['PUBLISHED', 'PAUSED', 'PENDING_REVIEW'].includes(item.status)) item.status = 'DRAFT'
        for (const authorization of propertyAuthorizations) if (authorization.listingId === item.id && ['PENDING', 'APPROVED'].includes(authorization.status)) {
          authorization.status = 'REJECTED'
          authorization.reason = 'Property address changed; submit new proof.'
        }
      }
      item.latitude = null
      item.longitude = null
      if (Array.isArray(removePhotoIds)) item.photos = item.photos.filter(photo => !removePhotoIds.includes(photo.id))
      if (Array.isArray(newPhotoKeys)) item.photos.push(...newPhotoKeys.map(key => ({ id: key, url: `/demo/uploads/${encodeURIComponent(key)}`, alt: 'Demo uploaded photo' })))
      item.updatedAt = now()
      return json(res, 200, item)
    }
    if (!action && method === 'DELETE') { item.status = 'ARCHIVED'; item.updatedAt = now(); return json(res, 200, item) }
    if (action === 'submit' && method === 'POST') {
      if (!item.photos.length) return fail(res, 400, 'Add at least one demo photo before submitting for review.')
      const proofError = requiredListingProof(item)
      if (proofError) return fail(res, 403, proofError, 'VERIFICATION_REQUIRED')
      item.status = 'PENDING_REVIEW'; item.updatedAt = now(); return json(res, 200, item)
    }
    if (action === 'availability' && method === 'POST') { item.lastConfirmedAt = now(); return json(res, 200, item) }
  }

  if (path === '/uploads/sign' && method === 'POST') {
    if (!required(res, user)) return
    const purpose = body.purpose === 'REVIEW_EVIDENCE' ? 'REVIEW_EVIDENCE' : 'LISTING_PHOTO'
    const allowedTypes = purpose === 'REVIEW_EVIDENCE' ? ['application/pdf', 'image/jpeg', 'image/png'] : ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(body.contentType) || !Number.isInteger(body.size) || body.size < 1 || body.size > 5_000_000) return fail(res, 400, 'Choose an allowed file type up to 5 MB.')
    const key = id(purpose === 'REVIEW_EVIDENCE' ? 'evidence' : 'photo')
    uploads.set(key, { type: body.contentType, buffer: null, purpose, ownerId: user.id, uploaded: false })
    return json(res, 200, { uploadUrl: `/api/v1/demo-uploads/${key}`, objectKey: key, headers: {} })
  }
  if (path.startsWith('/demo-uploads/') && method === 'PUT') {
    if (!required(res, user)) return
    const key = path.split('/')[2]
    const upload = uploads.get(key)
    if (!upload || upload.ownerId !== user.id || upload.type !== req.headers['content-type']) return fail(res, 400, 'The demo upload URL or file type is invalid.')
    const input = await bodyOf(req, 5_000_000)
    if (!input.buffer) return fail(res, 400, 'No file content was received.')
    // Evidence is validated in this UI preview but never retained or served back.
    if (upload.purpose !== 'REVIEW_EVIDENCE') upload.buffer = input.buffer
    upload.uploaded = true
    return json(res, 200, { uploaded: true })
  }

  if (path === '/favorites' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, { items: listings.filter(item => favorites.get(user.id)?.has(item.id) && publicListingCurrent(item)).map(item => decorateListing(item, user)) }) }
  if (path === '/favorites' && ['POST', 'DELETE'].includes(method)) {
    if (!required(res, user)) return
    const listingId = String(body.listingId || '')
    if (method === 'POST' && !listings.some(item => item.id === listingId && publicListingCurrent(item))) return fail(res, 404, 'This property could not be found.', 'NOT_FOUND')
    if (!favorites.has(user.id)) favorites.set(user.id, new Set())
    if (method === 'POST') favorites.get(user.id).add(listingId)
    else favorites.get(user.id).delete(listingId)
    return json(res, 200, { saved: method === 'POST' })
  }
  if (path === '/inquiries' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, paginate(inquiries.filter(item => item.senderId === user.id || item.recipientId === user.id), url)) }
  const inquiryMessageMatch = path.match(/^\/inquiries\/([^/]+)\/messages$/)
  if (inquiryMessageMatch) {
    if (!required(res, user)) return
    const inquiry = inquiries.find(item => item.id === inquiryMessageMatch[1] && (item.senderId === user.id || item.recipientId === user.id))
    if (!inquiry) return fail(res, 404, 'This demo inquiry could not be found.')
    const messages = inquiryMessages.get(inquiry.id) || []
    if (method === 'GET') return json(res, 200, messagePage(messages, url))
    if (method === 'POST') {
      if (body.expectedSenderId !== user.id) return fail(res, 409, 'Your signed-in account changed. Reload this page before sending a message.', 'SESSION_CHANGED')
      const text = String(body.body || '').trim()
      if (!text || text.length > 2000) return fail(res, 400, 'Enter a reply up to 2,000 characters.')
      const message = { id: id('inquiry-message'), senderId: user.id, body: text, createdAt: now() }
      messages.push(message)
      inquiryMessages.set(inquiry.id, messages)
      notify(user.id === inquiry.senderId ? inquiry.recipientId : inquiry.senderId, 'INQUIRY_REPLY', { inquiryId: inquiry.id, messageId: message.id })
      return json(res, 201, message)
    }
  }
  if (path === '/reviews/mine' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, { items: reviews.filter(item => item.authorId === user.id) }) }
  if (path === '/reports' && method === 'POST') { if (!required(res, user)) return; const record = { id: id('report'), ...body, reporter: { id: user.id, name: user.name }, status: 'OPEN', createdAt: now() }; reports.unshift(record); return json(res, 201, record) }
  if (path === '/profile' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, profiles.get(user.id)) }
  if (path === '/profile' && method === 'PATCH') {
    if (!required(res, user)) return
    if (Object.hasOwn(body, 'phone')) {
      if (!user.roles.some(role => role === 'STUDENT' || role === 'LANDLORD')) return fail(res, 403, 'Only students and landlords can update a contact phone number.', 'FORBIDDEN')
      if (body.phone !== null && (typeof body.phone !== 'string' || !/^\+?[0-9][0-9 ()-]*$/.test(body.phone.trim()) || body.phone.trim().length > 25 || !/^\d{7,15}$/.test(body.phone.replace(/\D/g, '')))) return fail(res, 400, 'Enter a valid phone number with 7 to 15 digits.', 'VALIDATION_ERROR')
      body.phone = body.phone?.trim() || null
    }
    if (user.roles.includes('LANDLORD')) {
      if (body.phone === null) return fail(res, 400, 'Landlord accounts need a contact phone number.', 'PHONE_REQUIRED')
      const nameChanged = typeof body.displayName === 'string' && body.displayName.trim() !== user.name
      if (nameChanged) {
        const identity = latestIdentity(user.id)
        if (identity && ['PENDING', 'APPROVED'].includes(identity.status)) {
          identity.status = 'REJECTED'
          identity.reason = 'Legal name changed; submit new identity documents.'
        }
        revokePropertyReviews(user.id, 'Landlord legal name changed; submit new property proof.')
      }
    }
    const profile = { ...profiles.get(user.id), ...body, email: user.email, name: body.displayName || user.name }
    profiles.set(user.id, profile)
    user.name = body.displayName || user.name
    return json(res, 200, profile)
  }
  if (path === '/verifications' && method === 'POST') {
    if (!required(res, user, 'STUDENT')) return
    if (user.studentVerified) return fail(res, 409, 'Your student status is already verified.', 'ALREADY_VERIFIED')
    if (verifications.some(item => item.userId === user.id && item.status === 'PENDING')) return fail(res, 409, 'Your student verification request is already pending.', 'VERIFICATION_PENDING')
    if (body.method !== 'DOCUMENTS') return fail(res, 400, 'Submit both documents for administrator review.', 'INVALID_METHOD')
    if (!user.emailVerified) return fail(res, 403, 'Verify your school email before submitting documents.', 'EMAIL_UNVERIFIED')
    const domain = user.email.toLowerCase().split('@')[1]
    const campus = campuses.find(item => item.active && item.domains.some(allowed => allowed.toLowerCase() === domain))
    if (!campus) return fail(res, 403, 'Use a configured school email address for student verification.', 'STUDENT_EMAIL_REQUIRED')
    if (!await validDemoProof(body.studentId, ['image/jpeg', 'image/png'])) return fail(res, 400, 'Upload a valid student ID JPG or PNG image no larger than 5 MB.', 'INVALID_STUDENT_ID')
    if (!await validDemoProof(body.offerLetter, ['application/pdf', 'image/jpeg', 'image/png'])) return fail(res, 400, 'Upload a valid offer letter PDF, JPG or PNG no larger than 5 MB.', 'INVALID_OFFER_LETTER')
    const record = { id: id('verification'), userId: user.id, student: { name: user.name, email: user.email, emailVerified: true }, university: campus.university, method: 'DOCUMENTS', verificationMethod: 'DOCUMENTS', status: 'PENDING', note: 'Demo preview: uploaded files were checked and then discarded. Private documents are not stored here.', createdAt: now() }
    verifications.unshift(record)
    user.studentVerified = false; user.verificationStatus = 'PENDING'
    return json(res, 201, { id: record.id, method: record.method, status: record.status, createdAt: record.createdAt })
  }
  if (path === '/landlord-verifications/me' && method === 'GET') {
    if (!required(res, user, 'LANDLORD')) return
    return json(res, 200, verificationSummary(latestIdentity(user.id)))
  }
  if (path === '/landlord-verifications/identity' && method === 'POST') {
    if (!required(res, user, 'LANDLORD')) return
    if (!user.emailVerified) return fail(res, 403, 'Verify your email before uploading identity documents.', 'EMAIL_UNVERIFIED')
    if (!profiles.get(user.id)?.phone) return fail(res, 400, 'Add your contact phone number before applying.', 'PHONE_REQUIRED')
    const latest = latestIdentity(user.id)
    if (latest?.status === 'PENDING') return fail(res, 409, 'Your identity review is already pending.', 'VERIFICATION_PENDING')
    if (landlordVerifications.filter(item => item.userId === user.id && Date.now() - Date.parse(item.createdAt) < 86_400_000).length >= 3) return fail(res, 429, 'You can apply up to three times in 24 hours.', 'VERIFICATION_RATE_LIMITED')
    if (!['INDIVIDUAL', 'COMPANY'].includes(body.kind)) return fail(res, 400, 'Choose individual or company verification.', 'INVALID_KIND')
    if (!await validDemoProof(body.identity, ['image/jpeg', 'image/png'])) return fail(res, 400, 'Upload a valid identity JPG or PNG image no larger than 5 MB.', 'INVALID_PROOF')
    if (body.kind === 'COMPANY' && (!await validDemoProof(body.companyRegistration, ['application/pdf', 'image/jpeg', 'image/png']) || !await validDemoProof(body.representativeAuthority, ['application/pdf', 'image/jpeg', 'image/png']))) return fail(res, 400, 'Upload valid company registration and representative authority documents, each up to 5 MB.', 'INVALID_PROOF')
    if (body.kind === 'INDIVIDUAL' && (body.companyRegistration || body.representativeAuthority)) return fail(res, 400, 'Individual identity applications only accept the identity photo.', 'INVALID_PROOF')
    if (latest?.status === 'APPROVED') {
      latest.status = 'REJECTED'
      latest.reason = 'Superseded by a new identity application.'
      revokePropertyReviews(user.id, 'Landlord identity was resubmitted; submit new property proof.')
    }
    const record = {
      id: id('landlord-identity'), userId: user.id, kind: body.kind, status: 'PENDING',
      landlord: { id: user.id, name: user.name, email: user.email, phone: profiles.get(user.id)?.phone },
      reason: null, createdAt: now(), reviewedAt: null, expiresAt: null, revokedAt: null,
    }
    landlordVerifications.unshift(record)
    // The request's bytes are deliberately discarded; admin sees generic placeholders.
    notify('admin-demo', 'LANDLORD_VERIFICATION_SUBMITTED', { verificationId: record.id })
    return json(res, 201, { id: record.id, kind: record.kind, status: record.status, createdAt: record.createdAt })
  }
  const propertyVerificationMatch = path.match(/^\/landlord-verifications\/listings\/([^/]+)$/)
  if (propertyVerificationMatch && ['GET', 'POST'].includes(method)) {
    if (!required(res, user)) return
    if (!user.roles.some(role => role === 'LANDLORD' || role === 'STUDENT')) return fail(res, 403, 'Only a property owner or student subletter may use this form.', 'FORBIDDEN')
    const item = listings.find(entry => entry.id === propertyVerificationMatch[1] && entry.ownerId === user.id)
    if (!item) return fail(res, 404, 'Your demo listing could not be found.', 'NOT_FOUND')
    if (method === 'GET') return json(res, 200, verificationSummary(latestPropertyAuthorization(item.id)))
    if (!user.emailVerified) return fail(res, 403, 'Verify your account email before uploading property documents.', 'EMAIL_UNVERIFIED')
    if (user.roles.includes('LANDLORD') && !approvalIsCurrent(latestIdentity(user.id))) return fail(res, 403, 'Landlord identity approval is required before submitting property documents.', 'IDENTITY_REQUIRED')
    if (user.roles.includes('STUDENT') && !user.studentVerified) return fail(res, 403, 'Student verification is required before submitting subletting documents.', 'STUDENT_VERIFICATION_REQUIRED')
    const latest = latestPropertyAuthorization(item.id)
    if (latest?.status === 'PENDING' && latest.address === item.address) return fail(res, 409, 'Property authorization review is already pending.', 'VERIFICATION_PENDING')
    if (propertyAuthorizations.filter(record => record.listingId === item.id && Date.now() - Date.parse(record.createdAt) < 86_400_000).length >= 3) return fail(res, 429, 'You can apply up to three times in 24 hours.', 'VERIFICATION_RATE_LIMITED')
    if (!['OWNER', 'AGENT', 'SUBLETTING'].includes(body.kind) || (user.roles.includes('STUDENT') && body.kind !== 'SUBLETTING')) return fail(res, 400, 'Choose a valid property authority type.', 'INVALID_KIND')
    const documentTypes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!await validDemoProof(body.proof, documentTypes) || (body.kind !== 'OWNER' && !await validDemoProof(body.supporting, documentTypes)) || (body.kind === 'OWNER' && body.supporting)) return fail(res, 400, 'Upload the required property documents as PDF, JPG or PNG files up to 5 MB each.', 'INVALID_PROOF')
    if (latest?.status === 'APPROVED') {
      latest.status = 'REJECTED'
      latest.reason = 'Superseded by a new property authorization application.'
      if (item.status === 'PUBLISHED') item.status = 'PAUSED'
    }
    const record = {
      id: id('property-authorization'), listingId: item.id, userId: user.id, requesterId: user.id,
      listing: { id: item.id, title: item.title, address: item.address },
      owner: { id: user.id, name: user.name, email: user.email },
      address: item.address, kind: body.kind, status: 'PENDING', reason: null,
      createdAt: now(), reviewedAt: null, expiresAt: null, revokedAt: null,
    }
    propertyAuthorizations.unshift(record)
    notify('admin-demo', 'PROPERTY_AUTHORIZATION_SUBMITTED', { authorizationId: record.id, listingId: item.id })
    return json(res, 201, { id: record.id, kind: record.kind, status: record.status, createdAt: record.createdAt })
  }
  if (path === '/roommates/profile' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; return json(res, 200, roommateProfiles.get(user.id) || {}) }
  if (path === '/roommates/profile' && method === 'PATCH') { if (!required(res, user, 'STUDENT')) return; const current = roommateProfiles.get(user.id) || {}; const profile = { ...current, ...body, visibility: { ...current.visibility, ...body.visibility, university: false } }; roommateProfiles.set(user.id, profile); return json(res, 200, profile) }
  if (path === '/roommates/profile' && method === 'DELETE') { if (!required(res, user, 'STUDENT')) return; roommateProfiles.delete(user.id); return json(res, 200, { deleted: true }) }
  if (path === '/roommates/matches' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; if (!user.studentVerified) return fail(res, 403, 'Student verification is required.'); return json(res, 200, paginate(matchesFor(user), url)) }
  if (path === '/roommates/requests' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; return json(res, 200, paginate(roommateRequests.filter(item => item.senderId === user.id || item.recipientId === user.id), url)) }
  if (path === '/roommates/requests' && method === 'POST') {
    if (!required(res, user, 'STUDENT')) return
    const recipient = users.find(item => item.id === body.recipientId)
    if (!recipient) return fail(res, 404, 'This demo roommate could not be found.')
    const record = { id: id('request'), senderId: user.id, recipientId: recipient.id, sender: { id: user.id, name: user.name }, recipient: { id: recipient.id, name: recipient.name }, status: 'PENDING', createdAt: now() }
    roommateRequests.unshift(record); notify(recipient.id, 'ROOMMATE_CONNECTION_REQUEST', { requestId: record.id }); return json(res, 201, record)
  }
  const roommateMessageMatch = path.match(/^\/roommates\/requests\/([^/]+)\/messages$/)
  if (roommateMessageMatch) {
    if (!required(res, user, 'STUDENT')) return
    const request = roommateRequests.find(item => item.id === roommateMessageMatch[1] && item.status === 'ACCEPTED' && (item.senderId === user.id || item.recipientId === user.id))
    if (!request) return fail(res, 404, 'An accepted demo roommate connection is required.')
    const messages = roommateMessages.get(request.id) || []
    if (method === 'GET') return json(res, 200, messagePage(messages, url))
    if (method === 'POST') {
      if (body.expectedSenderId !== user.id) return fail(res, 409, 'Your signed-in account changed. Reload this page before sending a message.', 'SESSION_CHANGED')
      const text = String(body.body || '').trim()
      if (!text || text.length > 2000) return fail(res, 400, 'Enter a message up to 2,000 characters.')
      const message = { id: id('roommate-message'), senderId: user.id, body: text, createdAt: now() }
      messages.push(message)
      roommateMessages.set(request.id, messages)
      notify(user.id === request.senderId ? request.recipientId : request.senderId, 'ROOMMATE_MESSAGE', { requestId: request.id, messageId: message.id })
      return json(res, 201, message)
    }
  }
  const requestMatch = path.match(/^\/roommates\/requests\/([^/]+)$/)
  if (requestMatch && method === 'PATCH') {
    if (!required(res, user, 'STUDENT')) return
    const record = roommateRequests.find(item => item.id === requestMatch[1] && item.recipientId === user.id)
    if (!record) return fail(res, 404, 'The incoming request could not be found.')
    record.status = body.status; notify(record.senderId, 'ROOMMATE_CONNECTION_RESPONSE', { requestId: record.id, status: record.status }); return json(res, 200, record)
  }
  if (path === '/roommates/blocks' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; return json(res, 200, paginate((user.blockedUsers || []).map(personId => ({ userId: personId, displayName: roommateProfiles.get(personId)?.displayName || 'Student', blockedAt: now() })), url)) }
  if (path === '/roommates/blocks' && method === 'POST') { if (!required(res, user, 'STUDENT')) return; user.blockedUsers = [...new Set([...(user.blockedUsers || []), String(body.blockedUserId)])]; return json(res, 201, { blocked: true }) }
  const unblockMatch = path.match(/^\/roommates\/blocks\/([^/]+)$/)
  if (unblockMatch && method === 'DELETE') { if (!required(res, user, 'STUDENT')) return; user.blockedUsers = (user.blockedUsers || []).filter(personId => personId !== unblockMatch[1]); return json(res, 200, { unblocked: true }) }
  const roommateMatch = path.match(/^\/roommates\/([^/]+)$/)
  if (roommateMatch && method === 'GET') {
    if (!required(res, user, 'STUDENT')) return
    const person = matchesFor(user).find(item => item.id === roommateMatch[1])
    return person ? json(res, 200, person) : fail(res, 404, 'This demo roommate could not be found.')
  }

  if (path === '/notifications/preferences' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, preferences.get(user.id) || { emailInquiryUpdates: true, emailConnectionRequests: true, emailProductUpdates: false }) }
  if (path === '/notifications/preferences' && method === 'PATCH') { if (!required(res, user)) return; const next = { emailInquiryUpdates: true, emailConnectionRequests: true, emailProductUpdates: false, ...preferences.get(user.id), ...body }; preferences.set(user.id, next); return json(res, 200, next) }
  if (path === '/notifications' && method === 'GET') { if (!required(res, user)) return; const own = notifications.filter(item => item.userId === user.id); return json(res, 200, { ...paginate(own, url), unreadCount: own.filter(item => !item.readAt).length }) }
  if (path === '/notifications/read-all' && method === 'PATCH') { if (!required(res, user)) return; let updated = 0; for (const item of notifications) if (item.userId === user.id && !item.readAt) { item.readAt = now(); updated++ } return json(res, 200, { updated }) }
  const notificationMatch = path.match(/^\/notifications\/([^/]+)\/read$/)
  if (notificationMatch && method === 'PATCH') { if (!required(res, user)) return; const item = notifications.find(entry => entry.id === notificationMatch[1] && entry.userId === user.id); if (!item) return fail(res, 404, 'This demo notification could not be found.'); item.readAt ||= now(); return json(res, 200, item) }
  if (path === '/auth/sessions' && method === 'GET') { if (!required(res, user)) return; const current = currentSession(req); return json(res, 200, { items: [...sessions.values()].filter(item => item.userId === user.id).map(item => ({ id: item.id, device: 'Local Chrome demo session', createdAt: item.createdAt, lastActiveAt: now(), current: item.id === current?.id })) }) }
  const sessionMatch = path.match(/^\/auth\/sessions\/([^/]+)$/)
  if (sessionMatch && method === 'DELETE') { if (!required(res, user)) return; for (const [token, value] of sessions) if (value.id === sessionMatch[1] && value.userId === user.id) sessions.delete(token); return json(res, 200, { ended: true }) }
  if (path === '/account/deletion-requests' && method === 'POST') {
    if (!required(res, user)) return
    if (body.confirmation !== 'DELETE_ACCOUNT') return fail(res, 400, 'Confirm that you want to request account deletion.', 'VALIDATION_ERROR')
    let request = deletionRequests.find(item => item.userId === user.id && item.status === 'PENDING')
    if (!request) {
      request = { id: id('deletion'), userId: user.id, status: 'PENDING', requestedAt: now(), reason: null }
      deletionRequests.unshift(request)
    }
    return json(res, 200, { status: request.status, requestedAt: request.requestedAt })
  }

  if (path.startsWith('/admin/')) {
    if (!required(res, user, 'ADMIN')) return
    const landlordDocumentMatch = path.match(/^\/admin\/(landlord-verifications|property-authorizations)\/([^/]+)\/(identity|company|representative|proof|supporting)$/)
    if (landlordDocumentMatch && method === 'GET') {
      const [, kind, documentId, document] = landlordDocumentMatch
      const record = (kind === 'landlord-verifications' ? landlordVerifications : propertyAuthorizations).find(item => item.id === documentId)
      const allowed = kind === 'landlord-verifications' ? (document === 'identity' || record?.kind === 'COMPANY' && ['company', 'representative'].includes(document)) : (document === 'proof' || record?.kind !== 'OWNER' && document === 'supporting')
      if (!record || record.status === 'REJECTED' || !allowed) return fail(res, 404, 'The demo verification document is unavailable.', 'NOT_FOUND')
      const safeLabel = ({ identity: 'Identity', company: 'Company registration', representative: 'Representative authority', proof: 'Property proof', supporting: 'Supporting authority' })[document]
      const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><rect width="720" height="420" fill="#f4f7fb"/><rect x="42" y="42" width="636" height="336" rx="20" fill="#fff" stroke="#203569" stroke-width="3"/><text x="72" y="134" fill="#203569" font-family="Arial" font-size="34" font-weight="bold">${safeLabel} — DEMO ONLY</text><text x="72" y="200" fill="#374151" font-family="Arial" font-size="21">Uploaded files are checked, then discarded.</text><text x="72" y="242" fill="#374151" font-family="Arial" font-size="21">This placeholder contains no personal information.</text></svg>`
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Disposition': `attachment; filename="demo-${document}.svg"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      return res.end(sample)
    }
    const landlordQueueMatch = path.match(/^\/admin\/(landlord-verifications|property-authorizations)(?:\/([^/]+))?$/)
    if (landlordQueueMatch) {
      const [, kind, recordId] = landlordQueueMatch
      const isIdentity = kind === 'landlord-verifications'
      const collection = isIdentity ? landlordVerifications : propertyAuthorizations
      const format = isIdentity ? landlordVerificationForAdmin : propertyAuthorizationForAdmin
      if (!recordId && method === 'GET') return json(res, 200, paginate(collection.filter(item => !url.searchParams.get('status') || effectiveApprovalStatus(item) === url.searchParams.get('status')).map(item => format(item)), url))
      const record = collection.find(item => item.id === recordId)
      if (!record) return fail(res, 404, 'The demo verification request could not be found.', 'NOT_FOUND')
      if (method === 'GET') return json(res, 200, format(record, true))
      if (method === 'PATCH') {
        const reason = String(body.reason || '').trim()
        if (!['APPROVED', 'REJECTED', 'REVOKED'].includes(body.status) || (body.status === 'REJECTED' || body.status === 'REVOKED') && (reason.length < 3 || reason.length > 1000)) return fail(res, 400, 'Choose approve, reject or revoke and explain a rejection or revocation.', 'INVALID_DECISION')
        if (record.status !== (body.status === 'REVOKED' ? 'APPROVED' : 'PENDING')) return fail(res, 409, 'This request cannot be changed to that status.', 'ALREADY_REVIEWED')
        if (record.userId === user.id) return fail(res, 403, 'You cannot review your own request.', 'FORBIDDEN')
        const expiresAt = body.status === 'APPROVED' ? approvalExpiresAt(isIdentity ? 'identity' : 'property', body.validUntil) : null
        if (body.status === 'APPROVED' && !expiresAt) return fail(res, 400, 'Choose a valid expiry date within the configured maximum approval period.', 'INVALID_EXPIRY')
        if (body.status === 'APPROVED' && isIdentity) {
          const account = users.find(item => item.id === record.userId)
          if (!account?.emailVerified || !profiles.get(record.userId)?.phone) return fail(res, 400, 'The landlord needs a verified email and phone before identity approval.', 'ACCOUNT_INCOMPLETE')
        }
        if (body.status === 'APPROVED' && !isIdentity) {
          const item = listings.find(entry => entry.id === record.listingId)
          if (!item || item.ownerId !== record.userId || item.address !== record.address || item.status === 'ARCHIVED') return fail(res, 400, 'The property address or listing changed. Ask for a new authorization request.', 'LISTING_CHANGED')
          const owner = users.find(entry => entry.id === record.userId)
          if (!owner?.emailVerified || owner.roles.includes('LANDLORD') && !approvalIsCurrent(latestIdentity(owner.id)) || owner.roles.includes('STUDENT') && !owner.studentVerified) return fail(res, 400, 'Verify the property owner account before reviewing its authorization.', 'IDENTITY_REQUIRED')
        }
        const previousStatus = record.status
        record.status = body.status
        record.reason = reason || null
        record.reviewedAt = now()
        record.reviewedById = user.id
        record.expiresAt = expiresAt
        record.revokedAt = body.status === 'REVOKED' ? now() : null
        if (body.status === 'REVOKED') {
          if (isIdentity) revokeApprovedPropertyReviews(record.userId, 'Landlord identity approval was revoked.')
          else {
            const item = listings.find(entry => entry.id === record.listingId)
            if (item && ['PUBLISHED', 'PENDING_REVIEW'].includes(item.status)) { item.status = 'PAUSED'; item.moderationReason = 'Property authorization was revoked.' }
          }
        }
        recordAudit(user, `${isIdentity ? 'LANDLORD_VERIFICATION' : 'PROPERTY_AUTHORIZATION'}_${record.status}`, isIdentity ? 'LANDLORD_VERIFICATION' : 'PROPERTY_AUTHORIZATION', record.id, { status: previousStatus }, { status: record.status, reason: record.reason })
        notify(record.userId, isIdentity ? 'LANDLORD_IDENTITY' : 'PROPERTY_AUTHORIZATION', { status: record.status, requestId: record.id })
        return json(res, 200, format(record, true))
      }
    }
    const demoDocumentMatch = path.match(/^\/admin\/verifications\/([^/]+)\/(student-id|offer-letter)$/)
    if (demoDocumentMatch && method === 'GET') {
      const verification = verifications.find(item => item.id === demoDocumentMatch[1] && item.method === 'DOCUMENTS')
      if (!verification) return fail(res, 404, 'The demo verification document is unavailable.', 'NOT_FOUND')
      const label = demoDocumentMatch[2] === 'student-id' ? 'Student ID' : 'Offer Letter'
      const fictionalEmailId = /^demo-[a-z0-9._+-]+$|^verification-demo$/.test(verification.student.email.split('@')[0]) ? verification.student.email.split('@')[0] : 'DEMO-ID'
      const demoIdLine = demoDocumentMatch[2] === 'student-id' ? `Fictional ID for preview: ${fictionalEmailId}` : 'Fictional offer letter for preview.'
      const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><rect width="720" height="420" fill="#f4f7fb"/><rect x="42" y="42" width="636" height="336" rx="20" fill="#fff" stroke="#203569" stroke-width="3"/><text x="72" y="134" fill="#203569" font-family="Arial" font-size="34" font-weight="bold">${label} — DEMO ONLY</text><text x="72" y="200" fill="#374151" font-family="Arial" font-size="21">Uploaded documents are checked, then discarded.</text><text x="72" y="242" fill="#374151" font-family="Arial" font-size="21">${demoIdLine}</text><text x="72" y="290" fill="#374151" font-family="Arial" font-size="19">No actual student document is stored or shown.</text></svg>`
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Disposition': `attachment; filename="demo-${demoDocumentMatch[2]}.svg"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      return res.end(sample)
    }
    if (path === '/admin/overview' && method === 'GET') return json(res, 200, {
      pendingVerifications: verifications.filter(item => item.status === 'PENDING').length,
      pendingLandlordVerifications: landlordVerifications.filter(item => item.status === 'PENDING').length,
      pendingPropertyAuthorizations: propertyAuthorizations.filter(item => item.status === 'PENDING').length,
      pendingDeletionRequests: deletionRequests.filter(item => item.status === 'PENDING').length,
      landlordAccounts: users.filter(item => item.roles.includes('LANDLORD')).length,
      pendingListings: listings.filter(item => item.status === 'PENDING_REVIEW').length,
      pendingReviews: reviews.filter(item => item.status === 'PENDING').length,
      openReports: reports.filter(item => item.status === 'OPEN').length,
    })
    const deletionRequestMatch = path.match(/^\/admin\/deletion-requests(?:\/([^/]+))?$/)
    if (deletionRequestMatch) {
      const requestId = deletionRequestMatch[1]
      if (!requestId && method === 'GET') {
        const filtered = deletionRequests.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status'))
        return json(res, 200, paginate(filtered.map(item => ({ ...item, user: users.find(account => account.id === item.userId) })), url))
      }
      const request = deletionRequests.find(item => item.id === requestId)
      if (!request) return fail(res, 404, 'This demo deletion request could not be found.', 'NOT_FOUND')
      if (method === 'PATCH') {
        const reason = String(body.reason || '').trim()
        if (!['APPROVED', 'REJECTED'].includes(body.status) || reason.length < 3 || reason.length > 1000) return fail(res, 400, 'Choose a decision and enter a reason of at least 3 characters.', 'INVALID_DECISION')
        if (request.status !== 'PENDING') return fail(res, 409, 'This deletion request has already been reviewed.', 'ALREADY_REVIEWED')
        if (request.userId === user.id) return fail(res, 403, 'You cannot approve your own account deletion.', 'FORBIDDEN')
        const account = users.find(item => item.id === request.userId)
        if (body.status === 'APPROVED' && account?.roles.includes('ADMIN') && users.filter(item => item.roles.includes('ADMIN') && item.status === 'ACTIVE').length <= 1) return fail(res, 409, 'At least one active administrator must remain.', 'LAST_ADMIN')
        request.status = body.status
        request.reason = reason
        request.reviewedAt = now()
        request.reviewedById = user.id
        recordAudit(user, `DELETION_REQUEST_${request.status}`, 'DELETION_REQUEST', request.id, { status: 'PENDING' }, { status: request.status, reason })
        if (body.status === 'APPROVED' && account) {
          for (const [token, session] of sessions) if (session.userId === account.id) sessions.delete(token)
          for (const [token, record] of demoEmailTokens) if (record.userId === account.id) demoEmailTokens.delete(token)
          for (const [token, record] of demoResetTokens) if (record.userId === account.id) demoResetTokens.delete(token)
          demoPasswordHashes.delete(account.id)
          profiles.delete(account.id)
          roommateProfiles.delete(account.id)
          favorites.delete(account.id)
          for (const item of listings) if (item.ownerId === account.id) { item.status = 'ARCHIVED'; item.showExactLocation = false; delete item.address }
          for (let index = verifications.length - 1; index >= 0; index--) if (verifications[index].userId === account.id) verifications.splice(index, 1)
          for (let index = landlordVerifications.length - 1; index >= 0; index--) if (landlordVerifications[index].userId === account.id) landlordVerifications.splice(index, 1)
          for (let index = propertyAuthorizations.length - 1; index >= 0; index--) if (propertyAuthorizations[index].requesterId === account.id) propertyAuthorizations.splice(index, 1)
          account.status = 'DELETED'
          account.name = 'Deleted account'
          account.email = `deleted-${account.id}@invalid.local`
          account.emailVerified = false
          account.studentVerified = false
          account.verificationStatus = 'UNVERIFIED'
        } else if (account) {
          notify(account.id, 'DELETION_REQUEST', { status: 'REJECTED', reason })
        }
        return json(res, 200, { id: request.id, status: request.status, requestedAt: request.requestedAt })
      }
    }
    if (path === '/admin/campuses' && method === 'GET') return json(res, 200, { items: campuses })
    if (path === '/admin/campuses' && ['POST', 'PATCH'].includes(method)) {
      if (method === 'PATCH') {
        const campus = campuses.find(item => item.id === body.id)
        if (!campus) return fail(res, 404, 'The demo campus could not be found.')
        Object.assign(campus, body, { updatedAt: now(), updatedBy: { name: user.name } })
        return json(res, 200, campus)
      }
      const campus = { ...body, id: id('campus'), updatedAt: now(), updatedBy: { name: user.name } }
      campuses.push(campus); return json(res, 201, campus)
    }
    if (path === '/admin/audit-logs' && method === 'GET') {
      const targetType = String(url.searchParams.get('targetType') || '').trim().toUpperCase()
      const targetId = String(url.searchParams.get('targetId') || '').trim()
      const filtered = auditLogs.filter(item => (!targetType || item.targetType === targetType) && (!targetId || item.targetId === targetId))
      return json(res, 200, paginate(filtered, url))
    }
    const moderationMatch = path.match(/^\/admin\/(verifications|listings|reviews|reports|accounts)(?:\/([^/]+))?$/)
    if (moderationMatch) {
      const [, kind, itemId] = moderationMatch
      const collection = { verifications, listings, reviews, reports, accounts: users }[kind]
      if (!itemId && method === 'GET') return json(res, 200, paginate(collection.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status')).map(item => kind === 'listings' ? decorateListing(item, user) : kind === 'verifications' ? verificationForAdmin(item) : item), url))
      const item = collection.find(entry => entry.id === itemId)
      if (!item) return fail(res, 404, 'The demo moderation record could not be found.')
      if (itemId && method === 'GET') return json(res, 200, kind === 'listings' ? decorateListing(item, user) : kind === 'verifications' ? verificationForAdmin(item, true) : item)
      if (itemId && method === 'PATCH') {
        if (kind === 'verifications') {
          if (!['APPROVED', 'REJECTED'].includes(body.status)) return fail(res, 400, 'Choose approve or reject for student verification.', 'INVALID_STATUS')
          if (body.status === 'APPROVED' && body.studentIdMatchesEmail !== true) return fail(res, 400, 'Confirm that the Student ID on the card matches the school email before approval.', 'STUDENT_ID_MATCH_REQUIRED')
          if (item.status !== 'PENDING') return fail(res, 409, 'This verification has already been reviewed.', 'ALREADY_REVIEWED')
          const applicant = users.find(account => account.id === item.userId)
          const domain = applicant?.email.toLowerCase().split('@')[1]
          if (body.status === 'APPROVED' && (item.method !== 'DOCUMENTS' || !applicant?.emailVerified || !campuses.some(campus => campus.active && campus.domains.some(allowed => allowed.toLowerCase() === domain)))) return fail(res, 400, 'A verified school email and both demo document checks are required.', 'PROOF_REQUIRED')
        }
        if (kind === 'listings' && ['APPROVED', 'PUBLISHED'].includes(body.status)) {
          const proofError = requiredListingProof(item)
          if (proofError) return fail(res, 403, proofError, 'VERIFICATION_REQUIRED')
        }
        const previousStatus = item.status
        item.status = body.status; item.moderationReason = String(body.reason || ''); item.moderatedAt = now(); item.moderatedBy = { name: user.name }
        recordAudit(user, `${kind.toUpperCase()}_${item.status}`, kind.toUpperCase(), item.id, { status: previousStatus }, { status: item.status, reason: item.moderationReason })
        if (kind === 'verifications') {
          const student = users.find(account => account.id === item.userId)
          if (student) { student.verificationStatus = body.status; student.studentVerified = body.status === 'APPROVED' }
        }
        if (kind === 'reviews') item.moderationStatus = body.status
        return json(res, 200, kind === 'verifications' ? verificationForAdmin(item, true) : item)
      }
    }
  }
  return fail(res, 404, 'This endpoint is unavailable in the local preview.', 'DEMO_NOT_FOUND')
}

const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
function illustration(kind) {
  const themes = { room: ['#dbeafe', '#2563eb', 'Single room illustration'], apartment: ['#fef3c7', '#b45309', 'Apartment illustration'], house: ['#dcfce7', '#15803d', 'Shared house illustration'] }
  const [background, foreground, label] = themes[kind] || themes.room
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="${background}"/><rect x="95" y="90" width="610" height="300" rx="22" fill="white" opacity=".74"/><path d="M175 310h450M210 310V206h380v104M250 206v-60h300v60" stroke="${foreground}" stroke-width="18" fill="none" stroke-linecap="round"/><text x="400" y="360" text-anchor="middle" fill="${foreground}" font-size="32" font-family="sans-serif">${label} · DEMO</text></svg>`
}
async function staticFile(req, res, url) {
  if (url.pathname.startsWith('/demo/illustrations/')) {
    const kind = url.pathname.split('/').pop()?.replace(/\.svg$/, '')
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    return res.end(illustration(kind))
  }
  if (url.pathname.startsWith('/demo/uploads/')) {
    const key = url.pathname.split('/').pop()
    const upload = uploads.get(key)
    if (!upload?.buffer) return fail(res, 404, 'The demo photo could not be found.')
    res.writeHead(200, { 'Content-Type': upload.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    return res.end(upload.buffer)
  }
  let path
  try { path = decodeURIComponent(url.pathname) } catch { return fail(res, 400, 'Invalid path.') }
  if (path.includes('\0')) return fail(res, 400, 'Invalid path.')
  const target = resolve(dist, `.${path}`)
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) return fail(res, 403, 'This path is outside the preview directory.')
  let file = target
  try { if (!(await stat(file)).isFile()) file = resolve(dist, 'index.html') }
  catch {
    if (extname(path) || !req.headers.accept?.includes('text/html')) return fail(res, 404, 'The page or static file could not be found.')
    file = resolve(dist, 'index.html')
  }
  const content = await readFile(file)
  const type = mime[extname(file)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
  return res.end(content)
}

try { await stat(resolve(dist, 'index.html')) }
catch { console.error('Could not find dist/index.html. Run npm ci && npm run build in the frontend directory first.'); process.exit(1) }
const server = createServer(async (req, res) => {
  try {
    if (![`${host}:${port}`, `localhost:${port}`].includes(req.headers.host)) return fail(res, 403, 'This demo server only accepts local addresses.')
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && ![`http://${host}:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return fail(res, 403, 'Cross-origin request rejected.')
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) return await api(req, res, url)
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'This path only serves the demo website.')
    return await staticFile(req, res, url)
  } catch (error) {
    if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : 'The local preview server encountered an error. Check the terminal.')
    else res.end()
    console.error(error)
  }
})
server.listen(port, host, () => console.log(`Local preview started: http://${host}:${port}/  (press Ctrl+C to stop)`))
