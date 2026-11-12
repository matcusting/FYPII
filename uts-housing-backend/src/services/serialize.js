import { config } from '../config.js';
import { approximate, mapsLinks } from './geo.js';

const num = (d) => (d == null ? null : Number(d));
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export const photoUrl = (objectKey) => `/uploads/${objectKey}`;

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';

/** The logged-in user's own account (never includes the password hash). */
export function serializeMe(user) {
  return {
    id: user.id,
    name: user.name,
    initials: initials(user.name),
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    studentId: user.studentId,
    major: user.major,
    academicYear: user.academicYear,
    studentVerified: Boolean(user.studentVerifiedAt),
    phone: user.phone,
    landlordVerified: Boolean(user.landlordVerifiedAt),
    bio: user.bio,
    createdAt: user.createdAt,
  };
}

/** What other users may see about a person. */
export function serializePublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    initials: initials(user.name),
    role: user.role,
    verified: user.role === 'STUDENT' ? Boolean(user.studentVerifiedAt) : Boolean(user.landlordVerifiedAt),
    major: user.role === 'STUDENT' ? user.major : undefined,
    academicYear: user.role === 'STUDENT' ? user.academicYear : undefined,
  };
}

export function isStale(listing) {
  return Date.now() - new Date(listing.lastConfirmedAt).getTime() > config.staleListingDays * 86400000;
}

/**
 * @param listing  Listing including owner, photos, amenities(amenity) and optionally campus
 * @param opts     { viewer, savedIds:Set, ratings: Map(listingId -> {avg,count}), includePrivate }
 */
export function serializeListing(listing, opts = {}) {
  const { savedIds, ratings, includePrivate } = opts;
  const rating = ratings?.get(listing.id) || { average: null, count: 0 };
  const out = {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    roomType: listing.roomType,
    rent: num(listing.rent),
    deposit: num(listing.deposit),
    currency: listing.currency,
    distanceKm: num(listing.distanceKm),
    approximateArea: listing.approximateArea,
    furnished: listing.furnished,
    houseRules: listing.houseRules,
    availableFrom: dateOnly(listing.availableFrom),
    status: listing.status,
    lastConfirmedAt: listing.lastConfirmedAt,
    isStale: isStale(listing),
    publishedAt: listing.publishedAt,
    photos: (listing.photos || []).sort((a, b) => a.sortOrder - b.sortOrder).map((p) => ({ id: p.id, url: photoUrl(p.objectKey) })),
    facilities: (listing.amenities || []).map((a) => a.amenity.name).sort(),
    landlord: serializePublicUser(listing.owner),
    campus: listing.campus ? { id: listing.campus.id, name: listing.campus.name } : undefined,
    rating,
    isSaved: savedIds ? savedIds.has(listing.id) : false,
  };
  out.location = locationFor(listing, includePrivate);
  if (includePrivate) {
    out.rejectionReason = listing.rejectionReason;
    out.viewCount = listing.viewCount;
    out.createdAt = listing.createdAt;
    out.updatedAt = listing.updatedAt;
  }
  return out;
}

/**
 * Map location of a listing. The public sees coordinates rounded to ~110 m
 * (neighbourhood level); the owner and admins see the exact pin and original link.
 */
export function locationFor(listing, exact = false) {
  if (listing.latitude == null || listing.longitude == null) return null;
  const lat = exact ? Number(listing.latitude) : approximate(listing.latitude);
  const lng = exact ? Number(listing.longitude) : approximate(listing.longitude);
  return {
    latitude: lat,
    longitude: lng,
    approximate: !exact,
    mapUrl: exact ? listing.mapUrl : undefined,
    links: mapsLinks(lat, lng, listing.campus),
  };
}

export const listingInclude = {
  owner: true,
  photos: true,
  amenities: { include: { amenity: true } },
  campus: true,
};

/** Review as shown publicly (proof of stay is admin-only). */
export function serializeReview(r, { includeModeration = false } = {}) {
  const out = {
    id: r.id,
    rating: r.rating,
    body: r.body,
    stayFrom: dateOnly(r.stayFrom),
    stayTo: dateOnly(r.stayTo),
    reply: r.reply,
    repliedAt: r.repliedAt,
    createdAt: r.createdAt,
    edited: Array.isArray(r.editHistory) && r.editHistory.length > 0,
    author: r.author ? serializePublicUser(r.author) : undefined,
    listing: r.listing ? { id: r.listing.id, title: r.listing.title } : undefined,
    landlord: r.landlord ? serializePublicUser(r.landlord) : undefined,
    moderationStatus: r.moderationStatus,
  };
  if (includeModeration) {
    out.proofNote = r.proofNote;
    out.moderationNote = r.moderationNote;
    out.editHistory = r.editHistory;
  }
  return out;
}
