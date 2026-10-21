/**
 * Local-only, in-memory UI preview. This is deliberately NOT a production API.
 * Start after `npm run build`: node preview/demo-server.mjs
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = 4173
const host = '127.0.0.1'
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const now = () => new Date().toISOString()
const id = prefix => `${prefix}-${randomUUID().slice(0, 8)}`
const seedDate = '2026-10-01T09:00:00.000Z'
const demoPassword = 'Demo12345!'
const users = [
  { id: 'student-demo', name: 'Demo Student', email: 'student@demo.local', roles: ['STUDENT'], emailVerified: true, studentVerified: true, verificationStatus: 'APPROVED', status: 'ACTIVE' },
  { id: 'landlord-demo', name: 'Demo Landlord', email: 'landlord@demo.local', roles: ['LANDLORD'], emailVerified: true, studentVerified: false, status: 'ACTIVE' },
  { id: 'admin-demo', name: 'Demo Admin', email: 'admin@demo.local', roles: ['ADMIN'], emailVerified: true, studentVerified: false, status: 'ACTIVE' },
  { id: 'student-candidate', name: 'Demo Roommate', email: 'candidate@demo.local', roles: ['STUDENT'], emailVerified: true, studentVerified: true, verificationStatus: 'APPROVED', status: 'ACTIVE' },
]
const sessions = new Map()
const uploads = new Map()
const campuses = [
  { id: 'uts-sibu', name: 'UTS Sibu Campus', university: 'University of Technology Sarawak', latitude: 2.286, longitude: 111.835, domains: ['uts.edu.my'], active: true },
  { id: 'sibu-center', name: 'Sibu City Centre', university: 'University of Technology Sarawak', latitude: 2.298, longitude: 111.829, domains: [], active: true },
]
const amenities = [
  { id: 'wifi', name: 'Wi-Fi', slug: 'wifi' }, { id: 'parking', name: 'Parking', slug: 'parking' },
  { id: 'aircon', name: 'Air Conditioning', slug: 'aircon' }, { id: 'laundry', name: 'Washing Machine', slug: 'laundry' },
]
const listing = (idValue, title, rent, area, type, room, photo, status = 'PUBLISHED') => ({
  id: idValue, title, description: `${title}. This fictional property is for preview use only and is not available to rent. Explore the layout, amenities, and in-app inquiry flow.`,
  rent, deposit: rent, currency: 'MYR', approximateArea: area, distanceKm: idValue === 'demo-listing-1' ? 1.3 : 3.1,
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
  displayName: user.name, university: user.roles.includes('STUDENT') ? 'University of Technology Sarawak' : '',
  bio: user.roles.includes('STUDENT') ? 'Looking for a quiet place with an easy commute to campus.' : '',
  preferredLocation: 'Sibu Jaya', budgetMin: 500, budgetMax: 1000, preferredMoveInDate: '2026-11-01',
  verificationStatus: user.verificationStatus || 'UNVERIFIED',
}]))
const blankAnswers = { smoking: 'NEVER', studySchedule: 'EVENING', sleepSchedule: 'FLEXIBLE', cleanliness: 'HIGH', noise: 'QUIET', guests: 'RARE', pets: 'NO_PETS' }
const roommateProfiles = new Map([
  ['student-demo', { displayName: 'Demo Student', university: 'University of Technology Sarawak', bio: 'Hoping to find a tidy roommate.', preferredLocation: 'Sibu Jaya', budgetMin: 500, budgetMax: 900, moveInDate: '2026-11-01', discoverable: true, lifestyle: { ...blankAnswers }, roommatePreferences: { ...blankAnswers }, importanceWeights: Object.fromEntries(Object.keys(blankAnswers).map(key => [key, 1])), visibility: { university: true, bio: true, preferredLocation: true, budget: true, moveInDate: true, lifestyle: true }, smokeFreeOnly: true, petFreeOnly: false }],
  ['student-candidate', { displayName: 'Demo Roommate', university: 'University of Technology Sarawak', bio: 'I enjoy quiet study time and a regular routine.', preferredLocation: 'Sibu Jaya', budgetMin: 550, budgetMax: 950, moveInDate: '2026-11-10', discoverable: true, lifestyle: { ...blankAnswers }, visibility: { university: true, bio: true, preferredLocation: true, budget: true, moveInDate: true, lifestyle: true } }],
])
const favorites = new Map([['student-demo', new Set(['demo-listing-1'])]])
const inquiries = [{ id: 'demo-inquiry-1', listingId: 'demo-listing-1', senderId: 'student-demo', recipientId: 'landlord-demo', sender: { id: 'student-demo', name: 'Demo Student' }, recipient: { id: 'landlord-demo', name: 'Demo Landlord' }, listing: { id: 'demo-listing-1', title: 'Room Near UTS (Demo)' }, message: 'Hello, when can I view this demo property?', status: 'OPEN', createdAt: seedDate }]
const roommateRequests = [{ id: 'demo-request-1', senderId: 'student-candidate', recipientId: 'student-demo', sender: { id: 'student-candidate', name: 'Demo Roommate' }, recipient: { id: 'student-demo', name: 'Demo Student' }, status: 'PENDING', createdAt: seedDate }]
const reviews = [{ id: 'demo-review-1', listingId: 'demo-listing-1', listing: { id: 'demo-listing-1', title: 'Room Near UTS (Demo)' }, authorId: 'student-candidate', author: { name: 'Demo Roommate' }, rating: 4, body: 'Demo review: A convenient location and a student-friendly room. This is not based on a real stay.', status: 'APPROVED', moderationStatus: 'APPROVED', createdAt: seedDate }]
const reports = [{ id: 'demo-report-1', targetType: 'LISTING', targetId: 'demo-listing-2', category: 'INACCURATE', reason: 'Demo report: Please check that the photos match the description.', reporter: { name: 'Demo Student' }, status: 'OPEN', createdAt: seedDate }]
const verifications = [{ id: 'demo-verification-1', userId: 'student-candidate', student: { name: 'Demo Roommate', email: 'candidate@demo.local' }, university: 'University of Technology Sarawak', verificationMethod: 'EMAIL_DOMAIN', status: 'PENDING', createdAt: seedDate }]
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
  // Proof files are ignored in this UI-only preview; no private file is stored.
  if (type.startsWith('multipart/form-data')) return { method: 'MANUAL', university: profiles.get(currentUser(req)?.id)?.university || '' }
  return { buffer }
}
function paginate(items, url, fallbackLimit = 20) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(fallbackLimit), 10) || fallbackLimit))
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, pages: Math.max(1, Math.ceil(items.length / limit)) }
}
function ownerOf(item) { return users.find(user => user.id === item.ownerId) }
function decorateListing(item) { return { ...item, campusName: campuses.find(c => c.id === item.campusId)?.name || item.campusName, owner: item.owner || (ownerOf(item) ? { id: item.ownerId, name: ownerOf(item).name } : undefined) } }
function matchesFor(user) {
  const blocked = user?.blockedUsers || []
  return [...roommateProfiles.entries()].filter(([personId, profile]) => personId !== user.id && profile.discoverable && users.find(item => item.id === personId)?.studentVerified && !blocked.includes(personId)).map(([personId, profile]) => ({
    id: personId, publicProfile: { userId: personId, displayName: profile.displayName, university: profile.visibility?.university ? profile.university : undefined, bio: profile.visibility?.bio ? profile.bio : undefined, preferredLocation: profile.visibility?.preferredLocation ? profile.preferredLocation : undefined, budgetMin: profile.visibility?.budget ? profile.budgetMin : undefined, budgetMax: profile.visibility?.budget ? profile.budgetMax : undefined, moveInDate: profile.visibility?.moveInDate ? profile.moveInDate : undefined },
    compatibilityScore: 84, topFactors: ['You both prefer a quiet study environment', 'Your budgets are similar', 'Your move-in dates are close'], explanation: 'This is a demo match; the score is illustrative.',
    requestStatus: roommateRequests.find(request => request.senderId === user.id && request.recipientId === personId)?.status || '',
  }))
}

async function api(req, res, url) {
  const path = url.pathname.slice('/api/v1'.length)
  const method = req.method
  const user = currentUser(req)
  const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !path.startsWith('/demo-uploads/') ? await bodyOf(req) : {}

  if (path === '/auth/me' && method === 'GET') return user ? json(res, 200, user) : fail(res, 401, 'You are not signed in to a demo account.', 'UNAUTHORIZED')
  if (path === '/auth/login' && method === 'POST') {
    const account = users.find(item => item.email.toLowerCase() === String(body.email || '').toLowerCase())
    if (!account || body.password !== demoPassword || account.status !== 'ACTIVE') return fail(res, 401, 'Incorrect demo email or password. Use student@demo.local, landlord@demo.local, or admin@demo.local. The password is Demo12345!', 'INVALID_CREDENTIALS')
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
  if (path === '/auth/register' && method === 'POST') return fail(res, 400, 'This local preview does not send verification emails. Use one of the preset demo accounts.', 'DEMO_ONLY')
  if (['/auth/verify-email', '/auth/forgot-password', '/auth/reset-password'].includes(path) && method === 'POST') return fail(res, 400, 'This local preview does not send email or reset real passwords. Use a preset demo account.', 'DEMO_ONLY')

  if (path === '/campuses' && method === 'GET') return json(res, 200, { items: campuses.filter(campus => campus.active) })
  if (path === '/amenities' && method === 'GET') return json(res, 200, { items: amenities })
  if (path === '/listings' && method === 'GET') {
    const mine = url.searchParams.get('mine') === 'true'
    if (mine && !required(res, user)) return
    const search = name => (url.searchParams.get(name) || '').toLowerCase()
    let items = listings.filter(item => mine ? item.ownerId === user.id : item.status === 'PUBLISHED')
    if (search('q')) items = items.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(search('q')))
    if (search('area')) items = items.filter(item => item.approximateArea.toLowerCase().includes(search('area')))
    if (search('university')) items = items.filter(item => (campuses.find(campus => campus.id === item.campusId)?.university || '').toLowerCase().includes(search('university')))
    if (search('campusId')) items = items.filter(item => item.campusId.toLowerCase() === search('campusId'))
    if (search('propertyType')) items = items.filter(item => item.propertyType.toLowerCase() === search('propertyType'))
    if (search('roomType')) items = items.filter(item => item.roomType.toLowerCase() === search('roomType'))
    if (search('furnished')) items = items.filter(item => String(item.furnished) === search('furnished'))
    if (search('minRent')) items = items.filter(item => Number(item.rent) >= Number(search('minRent')))
    if (search('maxRent')) items = items.filter(item => Number(item.rent) <= Number(search('maxRent')))
    if (search('maxDeposit')) items = items.filter(item => Number(item.deposit) <= Number(search('maxDeposit')))
    if (search('maxDistanceKm')) items = items.filter(item => Number(item.distanceKm || 0) <= Number(search('maxDistanceKm')))
    if (search('availableBy')) items = items.filter(item => item.availableFrom <= search('availableBy'))
    if (search('amenities')) items = items.filter(item => search('amenities').split(',').every(term => item.amenities?.some(amenity => amenity.toLowerCase().includes(term.trim()))))
    if (search('sort') === 'rent_asc') items.sort((a, b) => Number(a.rent) - Number(b.rent))
    if (search('sort') === 'rent_desc') items.sort((a, b) => Number(b.rent) - Number(a.rent))
    if (search('sort') === 'distance') items.sort((a, b) => Number(a.distanceKm || 0) - Number(b.distanceKm || 0))
    if (search('sort') === 'newest' || !search('sort')) items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return json(res, 200, paginate(items.map(decorateListing), url, 12))
  }
  if (path === '/listings' && method === 'POST') {
    if (!required(res, user)) return
    if (!user.roles.some(role => ['STUDENT', 'LANDLORD', 'ADMIN'].includes(role))) return fail(res, 403, 'This account cannot create listings.')
    const item = { ...listing(id('listing'), String(body.title || 'New Demo Listing'), Number(body.rent || 0), String(body.approximateArea || 'Demo area'), String(body.propertyType || 'APARTMENT'), String(body.roomType || 'SINGLE'), null, 'DRAFT'), ...body,
      id: id('listing'), ownerId: user.id, owner: { id: user.id, name: user.name }, status: 'DRAFT', createdAt: now(), updatedAt: now(), lastConfirmedAt: now(), photos: (body.photoKeys || []).map(key => ({ id: key, url: `/demo/uploads/${encodeURIComponent(key)}`, alt: 'Demo uploaded photo' })) }
    listings.unshift(item)
    return json(res, 201, item)
  }
  const listingMatch = path.match(/^\/listings\/([^/]+)(?:\/(reviews|inquiries|submit|availability))?$/)
  if (listingMatch) {
    const [, listingId, action] = listingMatch
    const item = listings.find(entry => entry.id === listingId)
    if (!item) return fail(res, 404, 'This demo listing could not be found.', 'NOT_FOUND')
    if (!action && method === 'GET') {
      if (item.status !== 'PUBLISHED' && !(user && (user.id === item.ownerId || user.roles.includes('ADMIN')))) return fail(res, 404, 'This public listing could not be found.', 'NOT_FOUND')
      return json(res, 200, decorateListing(item))
    }
    if (action === 'reviews' && method === 'GET') return json(res, 200, paginate(reviews.filter(review => review.listingId === item.id && review.status === 'APPROVED'), url))
    if (action === 'reviews' && method === 'POST') {
      if (!required(res, user, 'STUDENT')) return
      if (!user.studentVerified) return fail(res, 403, 'Student verification is required.')
      const record = { id: id('review'), listingId: item.id, listing: { id: item.id, title: item.title }, authorId: user.id, author: { name: user.name }, rating: Number(body.rating), body: String(body.body || ''), status: 'PENDING', moderationStatus: 'PENDING', createdAt: now() }
      reviews.unshift(record)
      return json(res, 201, record)
    }
    if (action === 'inquiries' && method === 'POST') {
      if (!required(res, user, 'STUDENT')) return
      const record = { id: id('inquiry'), listingId: item.id, listing: { id: item.id, title: item.title }, senderId: user.id, recipientId: item.ownerId, sender: { id: user.id, name: user.name }, recipient: { id: item.ownerId, name: ownerOf(item)?.name || 'Demo Landlord' }, message: String(body.message || ''), status: 'OPEN', createdAt: now() }
      inquiries.unshift(record)
      return json(res, 201, record)
    }
    if (!required(res, user)) return
    if (user.id !== item.ownerId && !user.roles.includes('ADMIN')) return fail(res, 403, 'You can only manage your own demo listings.', 'FORBIDDEN')
    if (!action && method === 'PATCH') {
      const { id: ignoredId, ownerId: ignoredOwner, owner: ignoredOwnerObject, photoKeys: ignoredKeys, newPhotoKeys, removePhotoIds, ...changes } = body
      Object.assign(item, changes)
      if (Array.isArray(removePhotoIds)) item.photos = item.photos.filter(photo => !removePhotoIds.includes(photo.id))
      if (Array.isArray(newPhotoKeys)) item.photos.push(...newPhotoKeys.map(key => ({ id: key, url: `/demo/uploads/${encodeURIComponent(key)}`, alt: 'Demo uploaded photo' })))
      item.updatedAt = now()
      return json(res, 200, item)
    }
    if (!action && method === 'DELETE') { item.status = 'ARCHIVED'; item.updatedAt = now(); return json(res, 200, item) }
    if (action === 'submit' && method === 'POST') {
      if (!item.photos.length) return fail(res, 400, 'Add at least one demo photo before submitting for review.')
      item.status = 'PENDING_REVIEW'; item.updatedAt = now(); return json(res, 200, item)
    }
    if (action === 'availability' && method === 'POST') { item.lastConfirmedAt = now(); return json(res, 200, item) }
  }

  if (path === '/uploads/sign' && method === 'POST') {
    if (!required(res, user)) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(body.contentType) || Number(body.size) > 5_000_000) return fail(res, 400, 'Only demo JPEG, PNG, or WebP images up to 5 MB are accepted.')
    const key = id('photo')
    uploads.set(key, { type: body.contentType, buffer: null })
    return json(res, 200, { uploadUrl: `/api/v1/demo-uploads/${key}`, objectKey: key, headers: {} })
  }
  if (path.startsWith('/demo-uploads/') && method === 'PUT') {
    if (!required(res, user)) return
    const key = path.split('/')[2]
    const upload = uploads.get(key)
    if (!upload || upload.type !== req.headers['content-type']) return fail(res, 400, 'The demo upload URL or file type is invalid.')
    const input = await bodyOf(req, 5_000_000)
    if (!input.buffer) return fail(res, 400, 'No image content was received.')
    upload.buffer = input.buffer
    return json(res, 200, { uploaded: true })
  }

  if (path === '/favorites' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, { items: listings.filter(item => favorites.get(user.id)?.has(item.id) && item.status === 'PUBLISHED').map(decorateListing) }) }
  if (path === '/favorites' && ['POST', 'DELETE'].includes(method)) {
    if (!required(res, user)) return
    if (!favorites.has(user.id)) favorites.set(user.id, new Set())
    if (method === 'POST') favorites.get(user.id).add(String(body.listingId))
    else favorites.get(user.id).delete(String(body.listingId))
    return json(res, 200, { saved: method === 'POST' })
  }
  if (path === '/inquiries' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, { items: inquiries.filter(item => item.senderId === user.id || item.recipientId === user.id) }) }
  if (path === '/reviews/mine' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, { items: reviews.filter(item => item.authorId === user.id) }) }
  if (path === '/reports' && method === 'POST') { if (!required(res, user)) return; const record = { id: id('report'), ...body, reporter: { id: user.id, name: user.name }, status: 'OPEN', createdAt: now() }; reports.unshift(record); return json(res, 201, record) }
  if (path === '/profile' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, profiles.get(user.id)) }
  if (path === '/profile' && method === 'PATCH') {
    if (!required(res, user)) return
    const profile = { ...profiles.get(user.id), ...body }
    profiles.set(user.id, profile)
    user.name = body.displayName || user.name
    return json(res, 200, profile)
  }
  if (path === '/verifications' && method === 'POST') {
    if (!required(res, user, 'STUDENT')) return
    const record = { id: id('verification'), userId: user.id, student: { name: user.name, email: user.email }, university: String(body.university || ''), verificationMethod: body.method || 'EMAIL_DOMAIN', status: 'PENDING', createdAt: now() }
    verifications.unshift(record)
    user.studentVerified = false; user.verificationStatus = 'PENDING'
    return json(res, 201, record)
  }
  if (path === '/roommates/profile' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; return json(res, 200, roommateProfiles.get(user.id) || {}) }
  if (path === '/roommates/profile' && method === 'PATCH') { if (!required(res, user, 'STUDENT')) return; const profile = { ...roommateProfiles.get(user.id), ...body }; roommateProfiles.set(user.id, profile); return json(res, 200, profile) }
  if (path === '/roommates/profile' && method === 'DELETE') { if (!required(res, user, 'STUDENT')) return; roommateProfiles.delete(user.id); return json(res, 200, { deleted: true }) }
  if (path === '/roommates/matches' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; if (!user.studentVerified) return fail(res, 403, 'Student verification is required.'); return json(res, 200, { items: matchesFor(user) }) }
  if (path === '/roommates/requests' && method === 'GET') { if (!required(res, user, 'STUDENT')) return; return json(res, 200, { items: roommateRequests.filter(item => item.senderId === user.id || item.recipientId === user.id) }) }
  if (path === '/roommates/requests' && method === 'POST') {
    if (!required(res, user, 'STUDENT')) return
    const recipient = users.find(item => item.id === body.recipientId)
    if (!recipient) return fail(res, 404, 'This demo roommate could not be found.')
    const record = { id: id('request'), senderId: user.id, recipientId: recipient.id, sender: { id: user.id, name: user.name }, recipient: { id: recipient.id, name: recipient.name }, status: 'PENDING', createdAt: now() }
    roommateRequests.unshift(record); return json(res, 201, record)
  }
  const requestMatch = path.match(/^\/roommates\/requests\/([^/]+)$/)
  if (requestMatch && method === 'PATCH') {
    if (!required(res, user, 'STUDENT')) return
    const record = roommateRequests.find(item => item.id === requestMatch[1] && item.recipientId === user.id)
    if (!record) return fail(res, 404, 'The incoming request could not be found.')
    record.status = body.status; return json(res, 200, record)
  }
  if (path === '/roommates/blocks' && method === 'POST') { if (!required(res, user, 'STUDENT')) return; user.blockedUsers = [...new Set([...(user.blockedUsers || []), String(body.blockedUserId)])]; return json(res, 201, { blocked: true }) }
  const roommateMatch = path.match(/^\/roommates\/([^/]+)$/)
  if (roommateMatch && method === 'GET') {
    if (!required(res, user, 'STUDENT')) return
    const person = matchesFor(user).find(item => item.id === roommateMatch[1])
    return person ? json(res, 200, person) : fail(res, 404, 'This demo roommate could not be found.')
  }

  if (path === '/notifications/preferences' && method === 'GET') { if (!required(res, user)) return; return json(res, 200, preferences.get(user.id) || { emailInquiryUpdates: true, emailConnectionRequests: true, emailProductUpdates: false }) }
  if (path === '/notifications/preferences' && method === 'PATCH') { if (!required(res, user)) return; const next = { emailInquiryUpdates: true, emailConnectionRequests: true, emailProductUpdates: false, ...preferences.get(user.id), ...body }; preferences.set(user.id, next); return json(res, 200, next) }
  if (path === '/auth/sessions' && method === 'GET') { if (!required(res, user)) return; const current = currentSession(req); return json(res, 200, { items: [...sessions.values()].filter(item => item.userId === user.id).map(item => ({ id: item.id, device: 'Local Chrome demo session', createdAt: item.createdAt, lastActiveAt: now(), current: item.id === current?.id })) }) }
  const sessionMatch = path.match(/^\/auth\/sessions\/([^/]+)$/)
  if (sessionMatch && method === 'DELETE') { if (!required(res, user)) return; for (const [token, value] of sessions) if (value.id === sessionMatch[1] && value.userId === user.id) sessions.delete(token); return json(res, 200, { ended: true }) }
  if (path === '/account/deletion-requests' && method === 'POST') { if (!required(res, user)) return; return fail(res, 400, 'This local preview does not process real account deletion requests.', 'DEMO_ONLY') }

  if (path.startsWith('/admin/')) {
    if (!required(res, user, 'ADMIN')) return
    if (path === '/admin/overview' && method === 'GET') return json(res, 200, {
      pendingVerifications: verifications.filter(item => item.status === 'PENDING').length,
      landlordAccounts: users.filter(item => item.roles.includes('LANDLORD')).length,
      pendingListings: listings.filter(item => item.status === 'PENDING_REVIEW').length,
      pendingReviews: reviews.filter(item => item.status === 'PENDING').length,
      openReports: reports.filter(item => item.status === 'OPEN').length,
    })
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
    const moderationMatch = path.match(/^\/admin\/(verifications|listings|reviews|reports|accounts)(?:\/([^/]+))?$/)
    if (moderationMatch) {
      const [, kind, itemId] = moderationMatch
      const collection = { verifications, listings, reviews, reports, accounts: users }[kind]
      if (!itemId && method === 'GET') return json(res, 200, paginate(collection.filter(item => !url.searchParams.get('status') || item.status === url.searchParams.get('status')).map(item => kind === 'listings' ? decorateListing(item) : item), url))
      const item = collection.find(entry => entry.id === itemId)
      if (!item) return fail(res, 404, 'The demo moderation record could not be found.')
      if (itemId && method === 'GET') return json(res, 200, kind === 'listings' ? decorateListing(item) : item)
      if (itemId && method === 'PATCH') {
        item.status = body.status; item.moderationReason = String(body.reason || ''); item.moderatedAt = now(); item.moderatedBy = { name: user.name }
        if (kind === 'verifications') {
          const student = users.find(account => account.id === item.userId)
          if (student) { student.verificationStatus = body.status; student.studentVerified = body.status === 'APPROVED' }
        }
        if (kind === 'reviews') item.moderationStatus = body.status
        return json(res, 200, item)
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
    if (!['127.0.0.1:4173', 'localhost:4173'].includes(req.headers.host)) return fail(res, 403, 'This demo server only accepts local addresses.')
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && !['http://127.0.0.1:4173', 'http://localhost:4173'].includes(req.headers.origin)) return fail(res, 403, 'Cross-origin request rejected.')
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
