import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, requireVerifiedStudent } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/security.js';
import { badRequest, forbidden, notFound, ok, parse, uuid } from '../utils/http.js';
import { serializeReview } from '../services/serialize.js';
import { notify, notifyAdmins } from '../services/notify.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const reviewSchema = z
  .object({
    rating: z.coerce.number().int().min(1, 'Rating must be 1–5.').max(5, 'Rating must be 1–5.'),
    body: z.string().trim().min(20, 'Please write at least 20 characters.').max(2000),
    stayFrom: date,
    stayTo: date.nullable().optional(),
    proofNote: z
      .string()
      .trim()
      .min(10, 'Describe how the admin can confirm you rented here (at least 10 characters).')
      .max(1000),
  })
  .refine((d) => !d.stayTo || d.stayTo >= d.stayFrom, { path: ['stayTo'], message: 'End date must be after the start date.' })
  .refine((d) => new Date(d.stayFrom) <= new Date(), { path: ['stayFrom'], message: 'You can only review a stay that has started.' });

const include = { author: true, listing: true, landlord: true };

function summary(reviews) {
  if (!reviews.length) return { average: null, count: 0, distribution: [0, 0, 0, 0, 0] };
  const distribution = [0, 0, 0, 0, 0];
  for (const r of reviews) distribution[r.rating - 1]++;
  const average = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
  return { average, count: reviews.length, distribution };
}

/* ------------------------------------------ /listings/:id/reviews (nested) */

export const listingReviewsRouter = Router({ mergeParams: true });

listingReviewsRouter.get('/', async (req, res) => {
  const listingId = parse(uuid, req.params.id);
  const listing = await prisma.listing.findFirst({ where: { id: listingId, deletedAt: null } });
  if (!listing) throw notFound('Listing not found.');
  const reviews = await prisma.review.findMany({
    where: { listingId, moderationStatus: 'APPROVED' },
    include,
    orderBy: { createdAt: 'desc' },
  });
  let mine = null;
  let canReview = false;
  let reason = 'Log in as a verified UTS student to write a review.';
  if (req.user) {
    const own = await prisma.review.findUnique({ where: { listingId_authorId: { listingId, authorId: req.user.id } }, include });
    mine = own ? serializeReview(own) : null;
    if (req.user.role !== 'STUDENT') reason = 'Only students can review properties.';
    else if (!req.user.studentVerifiedAt) reason = 'Your student status must be verified before you can write reviews.';
    else if (listing.ownerId === req.user.id) reason = 'You cannot review your own listing.';
    else if (own) reason = 'You have already reviewed this property.';
    else { canReview = true; reason = null; }
  }
  ok(res, { summary: summary(reviews), reviews: reviews.map((r) => serializeReview(r)), mine, canReview, reason });
});

listingReviewsRouter.post('/', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const listingId = parse(uuid, req.params.id);
  const d = parse(reviewSchema, req.body);
  const listing = await prisma.listing.findFirst({ where: { id: listingId, deletedAt: null, publishedAt: { not: null } } });
  if (!listing) throw notFound('Listing not found.');
  if (listing.ownerId === req.user.id) throw forbidden('You cannot review your own listing.');
  const exists = await prisma.review.findUnique({ where: { listingId_authorId: { listingId, authorId: req.user.id } } });
  if (exists) throw badRequest('You have already reviewed this property. You can edit your existing review instead.');
  const review = await prisma.review.create({
    data: {
      listingId,
      landlordId: listing.ownerId,
      authorId: req.user.id,
      rating: d.rating,
      body: d.body,
      stayFrom: new Date(d.stayFrom),
      stayTo: d.stayTo ? new Date(d.stayTo) : null,
      proofNote: d.proofNote,
    },
    include,
  });
  await notifyAdmins({ type: 'REVIEW_PENDING', title: 'Review waiting for moderation', body: `${req.user.name} reviewed "${listing.title}".`, link: '/admin/reviews' });
  ok(res, serializeReview(review), undefined, 201);
});

/* -------------------------------------------------------------- /reviews */

const router = Router();
router.use(requireAuth);

router.get('/mine', requireRole('STUDENT'), async (req, res) => {
  const rows = await prisma.review.findMany({ where: { authorId: req.user.id }, include, orderBy: { createdAt: 'desc' } });
  ok(res, rows.map((r) => serializeReview(r, { includeModeration: false })));
});

// Landlord: approved reviews about my properties
router.get('/landlord', requireRole('LANDLORD', 'ADMIN'), async (req, res) => {
  const rows = await prisma.review.findMany({
    where: { landlordId: req.user.id, moderationStatus: 'APPROVED' },
    include,
    orderBy: { createdAt: 'desc' },
  });
  ok(res, { summary: summary(rows), reviews: rows.map((r) => serializeReview(r)) });
});

router.patch('/:id', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || review.authorId !== req.user.id) throw notFound('Review not found.');
  const d = parse(reviewSchema, req.body);
  const history = Array.isArray(review.editHistory) ? review.editHistory : [];
  history.push({ rating: review.rating, body: review.body, editedAt: new Date().toISOString() });
  const updated = await prisma.review.update({
    where: { id },
    data: {
      rating: d.rating,
      body: d.body,
      stayFrom: new Date(d.stayFrom),
      stayTo: d.stayTo ? new Date(d.stayTo) : null,
      proofNote: d.proofNote,
      editHistory: history,
      moderationStatus: 'PENDING', // edits are moderated again
      moderationNote: null,
    },
    include,
  });
  await notifyAdmins({ type: 'REVIEW_PENDING', title: 'Edited review waiting for moderation', body: `${req.user.name} edited a review.`, link: '/admin/reviews' });
  ok(res, serializeReview(updated));
});

router.delete('/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || (review.authorId !== req.user.id && req.user.role !== 'ADMIN')) throw notFound('Review not found.');
  await prisma.review.delete({ where: { id } });
  ok(res, { deleted: true });
});

// The landlord can respond publicly but can never change the review itself.
router.post('/:id/reply', requireRole('LANDLORD', 'ADMIN'), writeLimiter, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { reply } = parse(z.object({ reply: z.string().trim().min(2).max(1000) }), req.body);
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || review.landlordId !== req.user.id || review.moderationStatus !== 'APPROVED') throw notFound('Review not found.');
  const updated = await prisma.review.update({ where: { id }, data: { reply, repliedAt: new Date() }, include });
  await notify(review.authorId, { type: 'REVIEW_REPLY', title: 'The landlord replied to your review', body: reply.slice(0, 100), link: '/student/housing' });
  ok(res, serializeReview(updated));
});

export default router;
