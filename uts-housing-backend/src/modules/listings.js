import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/security.js';
import { badRequest, forbidden, notFound, ok, parse, uuid } from '../utils/http.js';
import { listingInclude, serializeListing } from '../services/serialize.js';
import { notifyAdmins } from '../services/notify.js';
import { ROOM_TYPES } from './constants.js';

const router = Router();

/* ------------------------------------------------------------------ helpers */

export async function ratingsFor(listingIds) {
  const map = new Map();
  if (!listingIds.length) return map;
  const rows = await prisma.review.groupBy({
    by: ['listingId'],
    where: { listingId: { in: listingIds }, moderationStatus: 'APPROVED' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const r of rows) map.set(r.listingId, { average: Math.round(r._avg.rating * 10) / 10, count: r._count._all });
  return map;
}

async function savedSet(userId, listingIds) {
  if (!userId || !listingIds.length) return new Set();
  const favs = await prisma.favorite.findMany({ where: { userId, listingId: { in: listingIds } }, select: { listingId: true } });
  return new Set(favs.map((f) => f.listingId));
}

async function defaultCampusId() {
  const campus = await prisma.campus.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!campus) throw badRequest('No campus is configured yet. Ask an administrator to add one.');
  return campus.id;
}

/** Load a listing the current user owns (or any listing for admins). 404 otherwise — no leakage. */
async function ownedListing(req) {
  const id = parse(uuid, req.params.id);
  const listing = await prisma.listing.findFirst({ where: { id, deletedAt: null }, include: listingInclude });
  if (!listing) throw notFound('Listing not found.');
  if (listing.ownerId !== req.user.id && req.user.role !== 'ADMIN') throw notFound('Listing not found.');
  return listing;
}

async function setAmenities(tx, listingId, names) {
  await tx.listingAmenity.deleteMany({ where: { listingId } });
  if (!names?.length) return;
  const amenities = await tx.amenity.findMany({ where: { name: { in: names } } });
  if (amenities.length !== new Set(names).size) throw badRequest('Unknown facility selected.');
  await tx.listingAmenity.createMany({ data: amenities.map((a) => ({ listingId, amenityId: a.id })) });
}

const canPost = (user) => ['LANDLORD', 'ADMIN', 'STUDENT'].includes(user.role);

function assertCanSubmit(user) {
  if (!user.emailVerifiedAt) throw forbidden('Please verify your e-mail address before submitting a listing.');
  if (user.role === 'STUDENT' && !user.studentVerifiedAt)
    throw forbidden('Only verified students can post sublets. Your verification is still pending.');
}

/* ------------------------------------------------------------ public search */

const csv = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []));
const boolish = z.enum(['true', 'false']).optional().transform((v) => (v == null ? undefined : v === 'true'));

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  minRent: z.coerce.number().min(0).optional(),
  maxRent: z.coerce.number().min(0).optional(),
  maxDeposit: z.coerce.number().min(0).optional(),
  maxDistance: z.coerce.number().min(0).optional(),
  roomType: csv,
  amenities: csv,
  furnished: boolish,
  saved: boolish,
  availableBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  campusId: uuid.optional(),
  sort: z.enum(['newest', 'rent_asc', 'rent_desc', 'distance']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const SORTS = {
  newest: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  rent_asc: [{ rent: 'asc' }],
  rent_desc: [{ rent: 'desc' }],
  distance: [{ distanceKm: 'asc' }],
};

router.get('/', async (req, res) => {
  const f = parse(searchSchema, req.query);
  const where = { status: 'PUBLISHED', deletedAt: null, owner: { status: 'ACTIVE' } };
  if (f.q) {
    where.OR = [
      { title: { contains: f.q, mode: 'insensitive' } },
      { description: { contains: f.q, mode: 'insensitive' } },
      { approximateArea: { contains: f.q, mode: 'insensitive' } },
    ];
  }
  if (f.minRent != null || f.maxRent != null) where.rent = { gte: f.minRent, lte: f.maxRent };
  if (f.maxDeposit != null) where.deposit = { lte: f.maxDeposit };
  if (f.maxDistance != null) where.distanceKm = { lte: f.maxDistance };
  if (f.roomType.length) where.roomType = { in: f.roomType };
  if (f.furnished != null) where.furnished = f.furnished;
  if (f.campusId) where.campusId = f.campusId;
  if (f.availableBy) where.AND = [{ OR: [{ availableFrom: null }, { availableFrom: { lte: new Date(f.availableBy) } }] }];
  const and = where.AND || [];
  for (const name of f.amenities) and.push({ amenities: { some: { amenity: { name } } } });
  if (f.saved) {
    if (!req.user) return ok(res, [], { page: 1, limit: f.limit, total: 0, totalPages: 0 });
    and.push({ favorites: { some: { userId: req.user.id } } });
  }
  if (and.length) where.AND = and;

  const [total, rows] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      include: listingInclude,
      orderBy: SORTS[f.sort],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const [ratings, savedIds] = await Promise.all([ratingsFor(ids), savedSet(req.user?.id, ids)]);
  ok(res, rows.map((l) => serializeListing(l, { ratings, savedIds, showAddress: Boolean(req.user) })), {
    page: f.page,
    limit: f.limit,
    total,
    totalPages: Math.ceil(total / f.limit),
  });
});

/* ------------------------------------------------------- owner: my listings */

router.get('/mine', requireAuth, async (req, res) => {
  const rows = await prisma.listing.findMany({
    where: { ownerId: req.user.id, deletedAt: null },
    include: listingInclude,
    orderBy: { createdAt: 'desc' },
  });
  const ratings = await ratingsFor(rows.map((r) => r.id));
  ok(res, rows.map((l) => serializeListing(l, { ratings, includePrivate: true })));
});

router.get('/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const listing = await prisma.listing.findFirst({ where: { id, deletedAt: null }, include: listingInclude });
  const isOwner = req.user && listing && (listing.ownerId === req.user.id || req.user.role === 'ADMIN');
  if (!listing || (listing.status !== 'PUBLISHED' && !isOwner)) throw notFound('Listing not found.');
  if (!isOwner) await prisma.listing.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  const [ratings, savedIds] = await Promise.all([ratingsFor([id]), savedSet(req.user?.id, [id])]);
  ok(res, serializeListing(listing, { ratings, savedIds, includePrivate: isOwner, showAddress: Boolean(req.user) }));
});

/* --------------------------------------------------------------- mutations */

const money = z.coerce.number().min(0, 'Must be 0 or more.').max(100000);
const listingSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters.').max(120),
  description: z.string().trim().max(3000).default(''),
  roomType: z.enum(ROOM_TYPES, { message: 'Choose a room type.' }),
  rent: money.refine((v) => v > 0, 'Monthly rent must be more than 0.'),
  deposit: money.default(0),
  distanceKm: z.coerce.number().min(0).max(100, 'Distance looks too large.'),
  address: z.string().trim().min(5, 'Enter the property address.').max(200).nullable().optional(),
  // Optional exact pin from Google Maps (Share → Copy link). Only Google Maps https links are accepted.
  mapUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || isGoogleMapsUrl(v), 'Paste a Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…).')
    .nullable()
    .optional(),
  approximateArea: z.string().trim().max(120).nullable().optional(),
  furnished: z.boolean().default(false),
  houseRules: z.string().trim().max(1000).nullable().optional(),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').nullable().optional(),
  facilities: z.array(z.string().max(60)).max(30).default([]),
  campusId: uuid.optional(),
});

/** True for https links on Google Maps hosts (blocks javascript: and other sites). */
export function isGoogleMapsUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    if (h === 'maps.app.goo.gl') return true;
    if (h === 'goo.gl') return u.pathname.startsWith('/maps');
    const google = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
    return google && (h.startsWith('maps.') || u.pathname.startsWith('/maps'));
  } catch {
    return false;
  }
}

const toData = (d) => ({
  title: d.title,
  description: d.description,
  roomType: d.roomType,
  rent: d.rent,
  deposit: d.deposit,
  distanceKm: d.distanceKm,
  address: d.address || null,
  mapUrl: d.mapUrl || null,
  approximateArea: d.approximateArea ?? null,
  furnished: d.furnished,
  houseRules: d.houseRules ?? null,
  availableFrom: d.availableFrom ? new Date(d.availableFrom) : null,
});

router.post('/', requireAuth, writeLimiter, async (req, res) => {
  if (!canPost(req.user)) throw forbidden();
  const d = parse(listingSchema, req.body);
  if (!d.address) throw badRequest('address: Enter the property address.', { address: 'Enter the property address.' });
  const campusId = d.campusId || (await defaultCampusId());
  const listing = await prisma.$transaction(async (tx) => {
    const l = await tx.listing.create({ data: { ...toData(d), ownerId: req.user.id, campusId, status: 'DRAFT' } });
    await setAmenities(tx, l.id, d.facilities);
    return tx.listing.findUnique({ where: { id: l.id }, include: listingInclude });
  });
  ok(res, serializeListing(listing, { includePrivate: true }), undefined, 201);
});

router.patch('/:id', requireAuth, writeLimiter, async (req, res) => {
  const existing = await ownedListing(req);
  const d = parse(listingSchema.partial(), req.body);
  const merged = parse(listingSchema, {
    title: existing.title,
    description: existing.description,
    roomType: existing.roomType,
    rent: Number(existing.rent),
    deposit: Number(existing.deposit),
    distanceKm: Number(existing.distanceKm),
    address: existing.address,
    mapUrl: existing.mapUrl,
    approximateArea: existing.approximateArea,
    furnished: existing.furnished,
    houseRules: existing.houseRules,
    availableFrom: existing.availableFrom ? existing.availableFrom.toISOString().slice(0, 10) : null,
    facilities: existing.amenities.map((a) => a.amenity.name),
    ...d,
  });
  // Changing a live listing sends it back to moderation (admins edit freely).
  const needsReview = req.user.role !== 'ADMIN' && ['PUBLISHED', 'REJECTED'].includes(existing.status);
  const listing = await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: existing.id },
      data: { ...toData(merged), ...(needsReview ? { status: 'PENDING_REVIEW', rejectionReason: null } : {}), lastConfirmedAt: new Date() },
    });
    if (d.facilities) await setAmenities(tx, existing.id, merged.facilities);
    return tx.listing.findUnique({ where: { id: existing.id }, include: listingInclude });
  });
  if (needsReview) {
    await notifyAdmins({ type: 'LISTING_PENDING', title: 'Edited listing needs review', body: `"${listing.title}" was edited and is waiting for approval.`, link: '/admin/listings' });
  }
  ok(res, serializeListing(listing, { includePrivate: true }));
});

router.delete('/:id', requireAuth, async (req, res) => {
  const listing = await ownedListing(req);
  await prisma.listing.update({ where: { id: listing.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
  ok(res, { deleted: true });
});

router.post('/:id/submit', requireAuth, writeLimiter, async (req, res) => {
  const listing = await ownedListing(req);
  assertCanSubmit(req.user);
  if (!['DRAFT', 'REJECTED', 'PAUSED'].includes(listing.status))
    throw badRequest(`A listing that is ${listing.status.toLowerCase().replace('_', ' ')} cannot be submitted.`);
  if (!listing.photos.length) throw badRequest('Add at least one photo before submitting your listing.');
  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status: 'PENDING_REVIEW', rejectionReason: null, lastConfirmedAt: new Date() },
    include: listingInclude,
  });
  await notifyAdmins({ type: 'LISTING_PENDING', title: 'New listing waiting for approval', body: `"${listing.title}" by ${req.user.name}.`, link: '/admin/listings' });
  ok(res, serializeListing(updated, { includePrivate: true }));
});

const OWNER_TRANSITIONS = {
  RENTED: ['PUBLISHED', 'PAUSED'],
  PAUSED: ['PUBLISHED'],
  PUBLISHED: ['RENTED', 'PAUSED'], // re-list without re-review if it was approved before
};

router.post('/:id/status', requireAuth, async (req, res) => {
  const listing = await ownedListing(req);
  const { status } = parse(z.object({ status: z.enum(['PUBLISHED', 'PAUSED', 'RENTED']) }), req.body);
  if (!(OWNER_TRANSITIONS[status] || []).includes(listing.status))
    throw badRequest(`Cannot change a ${listing.status.toLowerCase()} listing to ${status.toLowerCase()}.`);
  if (status === 'PUBLISHED' && !listing.publishedAt) throw badRequest('This listing has not been approved yet — submit it for review.');
  if (status === 'PUBLISHED' && listing.status === 'PAUSED' && listing.rejectionReason)
    throw badRequest('This listing was suspended. Edit it and submit it for review again.');
  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status, ...(status === 'PUBLISHED' ? { lastConfirmedAt: new Date() } : {}) },
    include: listingInclude,
  });
  ok(res, serializeListing(updated, { includePrivate: true }));
});

router.post('/:id/availability', requireAuth, async (req, res) => {
  const listing = await ownedListing(req);
  const updated = await prisma.listing.update({ where: { id: listing.id }, data: { lastConfirmedAt: new Date() }, include: listingInclude });
  ok(res, serializeListing(updated, { includePrivate: true }));
});

/* ------------------------------------------------------------------ photos */

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${MIME_EXT[file.mimetype] || ''}`),
  }),
  limits: { fileSize: config.maxPhotoBytes, files: config.maxPhotosPerListing },
  fileFilter: (_req, file, cb) =>
    MIME_EXT[file.mimetype] ? cb(null, true) : cb(badRequest('Only JPG, PNG or WEBP images are allowed.')),
});

/** Check the file's real signature — the browser-supplied MIME type can be spoofed. */
function hasImageSignature(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return jpg || png || webp;
}

const removeFiles = (files) => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));

router.post('/:id/photos', requireAuth, writeLimiter, async (req, res) => {
  const listing = await ownedListing(req);
  await new Promise((resolve, reject) => upload.array('photos', config.maxPhotosPerListing)(req, res, (e) => (e ? reject(e) : resolve())));
  const files = req.files || [];
  if (!files.length) throw badRequest('Choose at least one photo.');
  if (listing.photos.length + files.length > config.maxPhotosPerListing) {
    removeFiles(files);
    throw badRequest(`A listing can have at most ${config.maxPhotosPerListing} photos.`);
  }
  if (!files.every((f) => hasImageSignature(f.path))) {
    removeFiles(files);
    throw badRequest('One of the files is not a valid image.');
  }
  const start = listing.photos.length;
  await prisma.listingPhoto.createMany({
    data: files.map((f, i) => ({ listingId: listing.id, objectKey: path.basename(f.path), sortOrder: start + i })),
  });
  const updated = await prisma.listing.findUnique({ where: { id: listing.id }, include: listingInclude });
  ok(res, serializeListing(updated, { includePrivate: true }), undefined, 201);
});

router.delete('/:id/photos/:photoId', requireAuth, async (req, res) => {
  const listing = await ownedListing(req);
  const photo = listing.photos.find((p) => p.id === req.params.photoId);
  if (!photo) throw notFound('Photo not found.');
  if (listing.status === 'PUBLISHED' && listing.photos.length === 1) throw badRequest('A published listing needs at least one photo.');
  await prisma.listingPhoto.delete({ where: { id: photo.id } });
  fs.rm(path.join(config.uploadDir, photo.objectKey), { force: true }, () => {});
  const updated = await prisma.listing.findUnique({ where: { id: listing.id }, include: listingInclude });
  ok(res, serializeListing(updated, { includePrivate: true }));
});

/* --------------------------------------------------------------- favorites */

export const favoritesRouter = Router();
favoritesRouter.use(requireAuth);

favoritesRouter.get('/', async (req, res) => {
  const favs = await prisma.favorite.findMany({
    where: { userId: req.user.id, listing: { status: 'PUBLISHED', deletedAt: null } },
    include: { listing: { include: listingInclude } },
    orderBy: { createdAt: 'desc' },
  });
  const ratings = await ratingsFor(favs.map((f) => f.listingId));
  const savedIds = new Set(favs.map((f) => f.listingId));
  ok(res, favs.map((f) => serializeListing(f.listing, { ratings, savedIds, showAddress: true })));
});

favoritesRouter.post('/:listingId', async (req, res) => {
  const listingId = parse(uuid, req.params.listingId);
  const listing = await prisma.listing.findFirst({ where: { id: listingId, status: 'PUBLISHED', deletedAt: null } });
  if (!listing) throw notFound('Listing not found.');
  await prisma.favorite.upsert({
    where: { userId_listingId: { userId: req.user.id, listingId } },
    create: { userId: req.user.id, listingId },
    update: {},
  });
  ok(res, { saved: true });
});

favoritesRouter.delete('/:listingId', async (req, res) => {
  const listingId = parse(uuid, req.params.listingId);
  await prisma.favorite.deleteMany({ where: { userId: req.user.id, listingId } });
  ok(res, { saved: false });
});

export default router;
